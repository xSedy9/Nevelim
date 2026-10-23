//! Overlay window management: creation, cursor positioning, show/hide/toggle
//! and the cursor hit-test loop that drives click pass-through.

use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow};

use crate::focus;
use crate::state::AppState;

/// Logical (CSS px) width of the overlay canvas. Must match the frontend layout.
pub const OVERLAY_W: f64 = 820.0;
/// Logical (CSS px) height of the overlay canvas. Must match the frontend layout.
pub const OVERLAY_H: f64 = 580.0;
/// Logical X of the hub circle center inside the canvas.
pub const HUB_X: f64 = 75.0;
/// Logical Y of the hub circle center inside the canvas.
pub const HUB_Y: f64 = 290.0;
/// Margin (physical px) kept from monitor edges when clamping the window.
pub const EDGE_MARGIN: f64 = 10.0;

/// Creates the overlay window once; subsequent calls return the existing one.
pub fn create_overlay(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(existing) = app.get_webview_window("overlay") {
        return Ok(existing);
    }
    let win =
        tauri::WebviewWindowBuilder::new(app, "overlay", WebviewUrl::App("overlay.html".into()))
            .title("QuickSnippetsOverlay")
            .inner_size(OVERLAY_W, OVERLAY_H)
            .transparent(true)
            .decorations(false)
            .shadow(false)
            .skip_taskbar(true)
            .always_on_top(true)
            .resizable(false)
            .visible(false)
            .build()?;

    // Losing focus closes the overlay through the frontend (animated), exactly
    // like the legacy WM_ACTIVATE behaviour.
    let handle = app.clone();
    win.on_window_event(move |event| {
        if let tauri::WindowEvent::Focused(false) = event {
            let _ = handle.emit_to("overlay", "request-close", ());
        }
    });
    Ok(win)
}

/// Monitor descriptor subset used for window clamping.
struct MonitorBounds {
    position: (i32, i32),
    size: (u32, u32),
    scale: f64,
}

/// Picks the monitor that contains `point`, falling back to the first one.
fn monitor_at(app: &AppHandle, point: (f64, f64)) -> Option<MonitorBounds> {
    let monitors = app.available_monitors().ok()?;
    let to_bounds = |m: &tauri::Monitor| MonitorBounds {
        position: (m.position().x, m.position().y),
        size: (m.size().width, m.size().height),
        scale: m.scale_factor(),
    };
    for m in &monitors {
        let b = to_bounds(m);
        let inside = point.0 >= b.position.0 as f64
            && point.1 >= b.position.1 as f64
            && point.0 < (b.position.0 + b.size.0 as i32) as f64
            && point.1 < (b.position.1 + b.size.1 as i32) as f64;
        if inside {
            return Some(b);
        }
    }
    monitors.first().map(to_bounds)
}

/// Positions the overlay so the hub circle is centered on the cursor,
/// clamped to the work area of the monitor under the cursor.
pub fn position_at_cursor(app: &AppHandle, win: &WebviewWindow) {
    let Ok(cursor) = app.cursor_position() else {
        return;
    };
    let Some(monitor) = monitor_at(app, (cursor.x, cursor.y)) else {
        return;
    };
    let scale = monitor.scale;
    let win_w = OVERLAY_W * scale;
    let win_h = OVERLAY_H * scale;

    // Center the hub circle on the cursor (offset by half the hub radius so the
    // hub hugs the cursor the same way the legacy overlay did).
    let mut x = cursor.x - (HUB_X + 14.0) * scale;
    let mut y = cursor.y - HUB_Y * scale;

    let min_x = monitor.position.0 as f64 + EDGE_MARGIN;
    let min_y = monitor.position.1 as f64 + EDGE_MARGIN;
    let max_x = (monitor.position.0 + monitor.size.0 as i32) as f64 - win_w - EDGE_MARGIN;
    let max_y = (monitor.position.1 + monitor.size.1 as i32) as f64 - win_h - EDGE_MARGIN;
    x = x.clamp(min_x, max_x.max(min_x));
    y = y.clamp(min_y, max_y.max(min_y));

    let _ = win.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
}

/// Shows the overlay at the current cursor position and remembers the window
/// that had focus before, so snippets can be pasted back into it.
pub fn show_at_cursor(app: &AppHandle) {
    let Ok(win) = create_overlay(app) else {
        return;
    };
    {
        let state = app.state::<AppState>();
        *state.prev_focus.lock().unwrap() = Some(focus::capture_foreground());
        *state.overlay_visible.lock().unwrap() = true;
        *state.overlay_input_enabled.lock().unwrap() = false;
    }
    let _ = win.set_ignore_cursor_events(true);
    position_at_cursor(app, &win);
    let _ = win.show();
    let _ = win.set_focus();
    // Deterministic "now visible" signal for the frontend (WebView2 focus
    // events are not always delivered reliably for hidden->shown windows).
    let _ = app.emit_to("overlay", "overlay-shown", ());
}

/// Hides the overlay immediately (no animation; the frontend animates first).
pub fn hide(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("overlay") {
        let _ = win.set_ignore_cursor_events(true);
        let _ = win.hide();
    }
    let state = app.state::<AppState>();
    *state.overlay_visible.lock().unwrap() = false;
    *state.overlay_input_enabled.lock().unwrap() = false;
}

/// Debounce window for the hotkey toggle: keyboard auto-repeat re-fires the
/// global shortcut while the combo is held, which must not close the overlay
/// right after it opened (mirrors the legacy 450 ms debounce).
pub const TOGGLE_DEBOUNCE_MS: u64 = 450;

/// Hotkey entry point: hides a visible overlay (via animated frontend close)
/// or shows it at the cursor. Auto-repeat presses within
/// [`TOGGLE_DEBOUNCE_MS`] are ignored.
pub fn toggle(app: &AppHandle) {
    let state = app.state::<AppState>();
    let now = std::time::Instant::now();
    {
        let mut last = state.last_toggle.lock().unwrap();
        if let Some(t) = *last {
            if now.duration_since(t) < std::time::Duration::from_millis(TOGGLE_DEBOUNCE_MS) {
                return;
            }
        }
        *last = Some(now);
    }
    let visible = *state.overlay_visible.lock().unwrap();
    if visible {
        let _ = app.emit_to("overlay", "request-close", ());
        // Fallback: if the frontend never animates+hides (dead webview),
        // force-hide so the hotkey always recovers.
        let handle = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(700));
            let still_visible = *handle.state::<AppState>().overlay_visible.lock().unwrap();
            if still_visible {
                eprintln!("[overlay] frontend did not hide in time, force-hiding");
                hide(&handle);
            }
        });
    } else {
        show_at_cursor(app);
    }
}

/// Background loop (30 ms): while the overlay is visible, reports the cursor
/// position (logical px relative to the window) to the frontend, which answers
/// with a hit-test through [`crate::commands::set_overlay_input`].
pub fn start_cursor_hit_test(app: &AppHandle) {
    let handle = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(30));
        let visible = handle
            .try_state::<AppState>()
            .map(|s| *s.overlay_visible.lock().unwrap())
            .unwrap_or(false);
        if !visible {
            continue;
        }
        let Some(win) = handle.get_webview_window("overlay") else {
            continue;
        };
        let (Ok(cursor), Ok(pos), Ok(size)) = (
            handle.cursor_position(),
            win.outer_position(),
            win.outer_size(),
        ) else {
            continue;
        };
        let rel_x = cursor.x - pos.x as f64;
        let rel_y = cursor.y - pos.y as f64;
        if rel_x < 0.0 || rel_y < 0.0 || rel_x >= size.width as f64 || rel_y >= size.height as f64 {
            continue;
        }
        let scale = win.scale_factor().unwrap_or(1.0);
        let _ = win.emit_to(
            "overlay",
            "cursor-pos",
            serde_json::json!({ "x": rel_x / scale, "y": rel_y / scale }),
        );
    });
}
