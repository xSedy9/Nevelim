//! Cross-platform focus capture/restore.
//!
//! On Windows the previously focused `HWND` is remembered so a snippet can be
//! pasted back into the window the user came from. Other platforms currently
//! degrade to a no-op (documented limitation of the Tier 2 targets).

/// Platform-specific previous-focus handle.
#[cfg(windows)]
pub type FocusHandle = isize;

/// Platform-specific previous-focus handle (no-op placeholder).
#[cfg(not(windows))]
pub type FocusHandle = ();

/// Captures the handle of the currently focused window.
#[cfg(windows)]
pub fn capture_foreground() -> FocusHandle {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    unsafe { GetForegroundWindow().0 as isize }
}

/// Captures the handle of the currently focused window (no-op on this platform).
#[cfg(not(windows))]
pub fn capture_foreground() -> FocusHandle {}

/// Restores focus to a previously captured window.
#[cfg(windows)]
pub fn restore_focus(handle: FocusHandle) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::SetForegroundWindow;
    if handle != 0 {
        unsafe {
            let _ = SetForegroundWindow(HWND(handle as _));
        }
    }
}

/// Restores focus to a previously captured window (no-op on this platform).
#[cfg(not(windows))]
pub fn restore_focus(_handle: FocusHandle) {}
