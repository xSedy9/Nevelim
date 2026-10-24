//! Nevelim desktop shell.
//!
//! Wires the Tauri runtime together: creates the overlay window, registers the
//! global hotkey, enforces single-instance behaviour and exposes the IPC
//! commands consumed by the web frontend.

pub mod commands;
pub mod focus;
pub mod logging;
pub mod overlay;
pub mod state;
pub mod tray;

use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Application entry point: builds the Tauri runtime and blocks until exit.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // A second launch just wakes the existing overlay.
            overlay::toggle(app);
        }))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|_app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        overlay::toggle(_app);
                    }
                })
                .build(),
        )
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_app_state,
            commands::get_modal_init,
            commands::get_settings,
            commands::save_settings,
            commands::default_export_dir,
            commands::test_provider,
            commands::open_settings,
            commands::close_settings,
            commands::export_templates,
            commands::check_import_file,
            commands::import_template,
            commands::open_import,
            commands::close_import,
            commands::adapt_template,
            commands::refine_result,
            commands::copy_text,
            commands::paste_snippet,
            commands::save_history_file,
            commands::open_path,
            commands::pick_folder,
            commands::pick_file,
            commands::pick_import_file,
            commands::load_spec_from_folder,
            commands::load_spec_from_file,
            commands::set_overlay_input,
            commands::hide_overlay,
            commands::log_frontend,
            commands::open_modal,
            commands::close_modal,
        ])
        .setup(|app| {
            logging::init(logging::log_path(&commands::base_dir()));
            overlay::create_overlay(app.handle())?;
            overlay::start_cursor_hit_test(app.handle());
            register_hotkey_from_config(app.handle());
            tray::create_tray(app.handle())?;
            logging::info("app started");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Nevelim");
}

/// Loads configuration from the resolved path, falling back to defaults.
pub(crate) fn load_config() -> nevelim_core::config::Config {
    nevelim_core::config::load_or_default(&nevelim_core::config::resolve_config_path())
}

/// (Re-)registers the global shortcut using the hotkey from the current config.
pub(crate) fn register_hotkey_from_config(app: &tauri::AppHandle) {
    let hotkey = load_config().hotkey;
    if let Err(e) = app.global_shortcut().unregister_all() {
        logging::warn(&format!("hotkey unregister_all failed: {e}"));
    }
    match app
        .global_shortcut()
        .on_shortcut(hotkey.as_str(), |app, _sc, event| {
            if event.state() == ShortcutState::Pressed {
                overlay::toggle(app);
            }
        }) {
        Ok(()) => logging::info(&format!("hotkey registered: {hotkey}")),
        Err(e) => logging::error(&format!("hotkey failed to register '{hotkey}': {e}")),
    }
}
