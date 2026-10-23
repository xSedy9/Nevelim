//! Shared managed state of the desktop shell.

use std::sync::Mutex;

use crate::focus::FocusHandle;

/// Payload passed from the overlay to a freshly opened adaptation modal.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ModalInit {
    /// Display name of the snippet being adapted.
    pub snippet_name: String,
    /// Full content of the snippet template.
    pub snippet_content: String,
}

/// Global application state. Fields are individually mutex-guarded because
/// they are touched from commands, the hotkey handler and background threads.
#[derive(Default)]
pub struct AppState {
    /// Whether the overlay window is currently visible.
    pub overlay_visible: Mutex<bool>,
    /// Window that had focus right before the overlay was shown (for paste-back).
    pub prev_focus: Mutex<Option<FocusHandle>>,
    /// Pending initialization data for the adaptation modal, if opening.
    pub modal_init: Mutex<Option<ModalInit>>,
    /// Last input-enabled flag sent to the OS, to avoid redundant syscall churn.
    pub overlay_input_enabled: Mutex<bool>,
}
