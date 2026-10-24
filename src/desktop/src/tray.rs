//! System tray integration.
//!
//! Exposes the application in the OS notification area (tray) with a context
//! menu providing access to Settings and an action to quit the app.

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::AppHandle;

/// Menu item ID for opening the Settings window.
pub const TRAY_MENU_SETTINGS: &str = "settings";

/// Menu item ID for terminating the application.
pub const TRAY_MENU_QUIT: &str = "quit";

/// Tray menu actions supported by the context menu.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayAction {
    /// Open the settings dialog.
    Settings,
    /// Terminate the application.
    Quit,
    /// Unrecognized action identifier.
    Unknown,
}

impl TrayAction {
    /// Resolves a menu item ID string into a typed [`TrayAction`].
    pub fn from_id(id: &str) -> Self {
        match id {
            TRAY_MENU_SETTINGS => Self::Settings,
            TRAY_MENU_QUIT => Self::Quit,
            _ => Self::Unknown,
        }
    }

    /// Returns the canonical menu item ID.
    pub fn as_id(&self) -> &'static str {
        match self {
            Self::Settings => TRAY_MENU_SETTINGS,
            Self::Quit => TRAY_MENU_QUIT,
            Self::Unknown => "",
        }
    }

    /// Returns the user-facing label for the menu item.
    pub fn title(&self) -> &'static str {
        match self {
            Self::Settings => "Настройки",
            Self::Quit => "Выйти",
            Self::Unknown => "",
        }
    }
}

/// Handles a tray menu action by ID.
pub fn handle_menu_action(app: &AppHandle, id: &str) {
    match TrayAction::from_id(id) {
        TrayAction::Settings => {
            let app_handle = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = crate::commands::open_settings(app_handle).await {
                    crate::logging::error(&format!("failed to open settings from tray: {e}"));
                }
            });
        }
        TrayAction::Quit => {
            crate::logging::info("app quit requested via tray");
            app.exit(0);
        }
        TrayAction::Unknown => {
            crate::logging::warn(&format!("unknown tray menu action: {id}"));
        }
    }
}

/// Builds and mounts the system tray icon and context menu.
pub fn create_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let settings_item = MenuItem::with_id(
        app,
        TrayAction::Settings.as_id(),
        TrayAction::Settings.title(),
        true,
        None::<&str>,
    )?;
    let quit_item = MenuItem::with_id(
        app,
        TrayAction::Quit.as_id(),
        TrayAction::Quit.title(),
        true,
        None::<&str>,
    )?;
    let menu = Menu::with_items(app, &[&settings_item, &quit_item])?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Nevelim")
        .on_menu_event(|app, event| {
            handle_menu_action(app, event.id().as_ref());
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                crate::overlay::toggle(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    crate::logging::info("system tray registered");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tray_menu_constants() {
        assert_eq!(TRAY_MENU_SETTINGS, "settings");
        assert_eq!(TRAY_MENU_QUIT, "quit");
    }

    #[test]
    fn tray_action_from_id() {
        assert_eq!(TrayAction::from_id("settings"), TrayAction::Settings);
        assert_eq!(TrayAction::from_id("quit"), TrayAction::Quit);
        assert_eq!(TrayAction::from_id("other"), TrayAction::Unknown);
        assert_eq!(TrayAction::from_id(""), TrayAction::Unknown);
    }

    #[test]
    fn tray_action_as_id() {
        assert_eq!(TrayAction::Settings.as_id(), "settings");
        assert_eq!(TrayAction::Quit.as_id(), "quit");
        assert_eq!(TrayAction::Unknown.as_id(), "");
    }

    #[test]
    fn tray_action_title() {
        assert_eq!(TrayAction::Settings.title(), "Настройки");
        assert_eq!(TrayAction::Quit.title(), "Выйти");
        assert_eq!(TrayAction::Unknown.title(), "");
    }
}
