//! Paste injection: emulates the paste keystroke in the currently focused window.
//!
//! Cross-platform via `enigo` (Ctrl+V on Windows/Linux, Cmd+V on macOS).
//! Restoring focus to the *previous* window is the desktop shell's job —
//! it owns the platform window handles.

use crate::error::{CoreError, CoreResult};

/// Delay (ms) that the desktop shell should sleep between focusing the target
/// window and injecting the keystroke.
///
/// `SetForegroundWindow` is asynchronous and heavy chat apps (Electron/Qt)
/// need a moment to process activation before they accept synthetic input;
/// 150 ms is empirically reliable where the legacy 80 ms sometimes lost the
/// keystroke.
pub const PASTE_SETTLE_MS: u64 = 150;

/// Sends the paste keystroke (Ctrl+V, or Cmd+V on macOS) using `enigo`.
pub fn send_paste_keystroke() -> CoreResult<()> {
    use enigo::{Direction, Enigo, Keyboard, Settings};

    let mut enigo =
        Enigo::new(&Settings::default()).map_err(|e| CoreError::Input(e.to_string()))?;

    #[cfg(target_os = "macos")]
    let modifier = enigo::Key::Meta;
    #[cfg(not(target_os = "macos"))]
    let modifier = enigo::Key::Control;

    enigo
        .key(modifier, Direction::Press)
        .map_err(|e| CoreError::Input(e.to_string()))?;
    enigo
        .key(enigo::Key::Unicode('v'), Direction::Click)
        .map_err(|e| CoreError::Input(e.to_string()))?;
    enigo
        .key(modifier, Direction::Release)
        .map_err(|e| CoreError::Input(e.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settle_delay_is_robust_for_heavy_apps() {
        assert_eq!(PASTE_SETTLE_MS, 150);
    }
}
