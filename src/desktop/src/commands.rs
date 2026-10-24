//! IPC commands exposed to the web frontend.
//!
//! Every system interaction (clipboard, dialogs, AI calls, paste, file access)
//! goes through this module so the frontend stays platform-free and the API
//! keys never leave the Rust side.

use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use quick_snippets_core::ai::{self, ChatMessage};
use quick_snippets_core::config::{self, Config, Provider};
use quick_snippets_core::error::CoreError;
use quick_snippets_core::export;
use quick_snippets_core::history;
use quick_snippets_core::spec::{self, FoundSpec};
use quick_snippets_core::templates::{self, TemplateEntry};

use crate::focus;
use crate::logging;
use crate::overlay;
use crate::state::{AppState, ModalInit};

/// Base directory for user data (config, templates, history) — resolved by
/// the core crate (exe dir -> workspace root -> cwd).
pub(crate) fn base_dir() -> PathBuf {
    quick_snippets_core::config::resolve_base_dir()
}

/// Logs an operation failure before it is surfaced to the frontend.
fn log_err(scope: &str, error: &str) {
    logging::error(&format!("{scope}: {error}"));
}

/// Sanitized configuration snapshot for the frontend (API keys stripped).
#[derive(Debug, Clone, Serialize)]
pub struct AppStateDto {
    /// Global hotkey string.
    pub hotkey: String,
    /// Selected provider (`gemini` | `openai` | `openrouter`).
    pub provider: String,
    /// Gemini model id.
    pub gemini_model: String,
    /// OpenAI model id.
    pub openai_model: String,
    /// OpenRouter model id.
    pub openrouter_model: String,
    /// Auto-paste behaviour flag.
    pub paste_automatically: bool,
    /// Snippet templates loaded from the templates directory.
    pub templates: Vec<TemplateEntry>,
    /// Resolved templates directory (for the "edit" action fallback UI).
    pub templates_dir: String,
}

/// Sanitizes a config for frontend consumption: no API keys leave the backend.
fn sanitize(config: &Config) -> AppStateDto {
    AppStateDto {
        hotkey: config.hotkey.clone(),
        provider: format!("{:?}", config.provider).to_lowercase(),
        gemini_model: config.gemini_model.clone(),
        openai_model: config.openai_model.clone(),
        openrouter_model: config.openrouter_model.clone(),
        paste_automatically: config.paste_automatically,
        templates: Vec::new(),
        templates_dir: String::new(),
    }
}

/// Returns the sanitized app state: config (without keys) plus all templates.
#[tauri::command]
pub fn get_app_state() -> AppStateDto {
    let config = config::load_or_default(&config::resolve_config_path());
    let templates_dir = base_dir().join("templates");
    let mut dto = sanitize(&config);
    dto.templates = templates::scan_templates(&templates_dir).unwrap_or_default();
    dto.templates_dir = templates_dir.to_string_lossy().to_string();
    dto
}

/// Returns the pending modal payload (snippet name + content), if any.
#[tauri::command]
pub fn get_modal_init(state: State<'_, AppState>) -> Option<ModalInit> {
    state.modal_init.lock().unwrap().clone()
}

/// Returns the full configuration for the settings window.
///
/// Unlike [`get_app_state`], API keys are included: the settings window is the
/// one place where the user edits them (local desktop app, no web context).
#[tauri::command]
pub fn get_settings() -> Config {
    config::load_or_default(&config::resolve_config_path())
}

/// Saves the configuration and re-registers the global hotkey.
#[tauri::command]
pub fn save_settings(app: AppHandle, config: Config) -> Result<(), String> {
    if quick_snippets_core::hotkey::parse_hotkey(&config.hotkey).is_none() {
        let message = "Invalid hotkey format. Example: alt+shift+v".to_string();
        log_err("save_settings", &message);
        return Err(message);
    }
    if let Err(e) = config.save_to(&config::resolve_config_path()) {
        log_err("save_settings", &e.to_string());
        return Err(e.to_string());
    }
    crate::register_hotkey_from_config(&app);
    Ok(())
}

/// Opens (or focuses) the settings window.
///
/// Async on purpose: window creation from a sync command deadlocks the event
/// loop on Windows (same as [`open_modal`]).
#[tauri::command]
pub async fn open_settings(app: AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("settings") {
        let _ = existing.show();
        let _ = existing.set_focus();
        // The form must reflect config.json edits made while the window was
        // closed or edited by hand.
        let _ = app.emit_to("settings", "settings-shown", ());
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App("settings.html".into()))
        .title("Nevelim — Settings")
        .inner_size(480.0, 560.0)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .skip_taskbar(true)
        .resizable(false)
        .center()
        .build()
        .map(|_| ())
        .map_err(|e| {
            eprintln!("[settings] failed to open: {e}");
            e.to_string()
        })
}

/// Closes the settings window.
#[tauri::command]
pub fn close_settings(app: AppHandle) {
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.close();
    }
}

/// Resolves the export folder: the configured one, or the system Downloads.
fn resolve_export_dir(cfg: &Config) -> PathBuf {
    let configured = cfg.export_dir.trim();
    if configured.is_empty() {
        dirs::download_dir().unwrap_or_else(base_dir)
    } else {
        PathBuf::from(configured)
    }
}

/// Default export folder (system Downloads) with the home directory
/// abbreviated to `~` and forward slashes, for display in the settings UI.
#[tauri::command]
pub fn default_export_dir() -> String {
    let folder = dirs::download_dir().unwrap_or_else(base_dir);
    let text = match dirs::home_dir() {
        Some(home) if folder.starts_with(&home) => {
            let rest = folder
                .strip_prefix(&home)
                .unwrap_or(&folder)
                .to_string_lossy()
                .trim_start_matches(['/', '\\'])
                .to_string();
            format!("~/{rest}")
        }
        _ => folder.to_string_lossy().to_string(),
    };
    text.replace('\\', "/")
}

/// Sends a minimal chat request to the given provider credentials and reports
/// whether it answers.
///
/// Uses the provider/key/model passed from the settings form (not the saved
/// config), so the check reflects unsaved edits.
#[tauri::command]
pub async fn test_provider(provider: String, key: String, model: String) -> Result<String, String> {
    // Trim the form values: stray whitespace is invisible in password fields
    // and turns into provider 401s.
    let key = key.trim().to_string();
    let model = model.trim().to_string();
    let mut config = config::load_or_default(&config::resolve_config_path());
    config.provider = match provider.as_str() {
        "gemini" => Provider::Gemini,
        "openai" => Provider::OpenAi,
        "openrouter" => Provider::OpenRouter,
        _ => return Err("Unknown provider.".to_string()),
    };
    match config.provider {
        Provider::Gemini => {
            config.gemini_api_key = key;
            config.gemini_model = model;
        }
        Provider::OpenAi => {
            config.openai_api_key = key;
            config.openai_model = model;
        }
        Provider::OpenRouter => {
            config.openrouter_api_key = key;
            config.openrouter_model = model;
        }
    }
    let messages = vec![ChatMessage::new("user", "ping")];
    match ai::call_llm_chat(&config, &messages).await {
        Ok(_) => {
            logging::info(&format!("provider check ok: {provider}"));
            Ok("ok".to_string())
        }
        Err(e) => {
            log_err("provider_check", &e.to_string());
            Err(e.to_string())
        }
    }
}

/// Copies every template into the export folder.
///
/// Packs the config and all templates into a timestamped zip archive
/// (`config.json` + `templates/`) inside the export folder, then opens that
/// folder. Returns the archive path.
#[tauri::command]
pub fn export_templates(app: AppHandle) -> Result<String, String> {
    let cfg_path = config::resolve_config_path();
    let cfg = config::load_or_default(&cfg_path);
    let folder = resolve_export_dir(&cfg);
    let zip_path = match export::export_backup(&cfg_path, &base_dir().join("templates"), &folder) {
        Ok(path) => path,
        Err(e) => {
            log_err("export", &e.to_string());
            return Err(e.to_string());
        }
    };
    if let Err(e) = app
        .opener()
        .open_path(folder.to_string_lossy().into_owned(), None::<&str>)
    {
        log_err("export", &e.to_string());
        return Err(e.to_string());
    }
    logging::info(&format!("export backup: {}", zip_path.display()));
    Ok(zip_path.to_string_lossy().into_owned())
}

/// Validation result for a candidate import file.
#[derive(Debug, Clone, Serialize)]
pub struct ImportCheckDto {
    /// Whether the file is a valid snippet import.
    pub ok: bool,
    /// Suggested template name (file stem).
    pub name: String,
    /// File size in bytes (0 on failure).
    pub size_bytes: u64,
    /// Human-readable failure reason (None on success).
    pub error: Option<String>,
}

/// Builds a failing import check DTO.
fn import_error(error: &str) -> ImportCheckDto {
    ImportCheckDto {
        ok: false,
        name: String::new(),
        size_bytes: 0,
        error: Some(error.to_string()),
    }
}

/// Quick validation of a candidate backup archive (extension, readability).
#[tauri::command]
pub fn check_import_file(file: String) -> ImportCheckDto {
    let path = std::path::Path::new(&file);
    if !path.is_file() {
        return import_error("File does not exist.");
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    if ext != "zip" {
        return import_error("Only export archives (.zip) are supported.");
    }
    match export::validate_backup(path) {
        Ok(info) if info.has_config || info.templates > 0 => ImportCheckDto {
            ok: true,
            name: path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default(),
            size_bytes: std::fs::metadata(path).map(|m| m.len()).unwrap_or(0),
            error: None,
        },
        Ok(_) => import_error("Archive contains no settings or templates."),
        Err(e) => import_error(&format!("Archive is corrupted: {e}")),
    }
}

/// Restores a validated backup archive into templates and config.
#[tauri::command]
pub fn import_template(file: String) -> Result<String, String> {
    let src = std::path::Path::new(&file);
    if !src.is_file() {
        return Err("File does not exist.".to_string());
    }
    let imported = match export::import_backup(
        src,
        &base_dir().join("templates"),
        &config::resolve_config_path(),
    ) {
        Ok(count) => count,
        Err(e) => {
            log_err("import", &e.to_string());
            return Err(e.to_string());
        }
    };
    logging::info(&format!("import backup: {imported} template(s)"));
    Ok(format!("Templates imported: {imported}"))
}

/// Opens (or focuses) the import wizard window.
#[tauri::command]
pub async fn open_import(app: AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("import") {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(&app, "import", WebviewUrl::App("import.html".into()))
        .title("Import Templates")
        .inner_size(440.0, 380.0)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .skip_taskbar(true)
        .resizable(false)
        .center()
        .build()
        .map(|_| ())
        .map_err(|e| {
            eprintln!("[import] failed to open: {e}");
            e.to_string()
        })
}

/// Closes the import wizard window.
#[tauri::command]
pub fn close_import(app: AppHandle) {
    if let Some(win) = app.get_webview_window("import") {
        let _ = win.close();
    }
}

/// Runs the AI adaptation of a template against a specification.
#[tauri::command]
pub async fn adapt_template(
    spec_content: String,
    template_content: String,
) -> Result<String, String> {
    let config = config::load_or_default(&config::resolve_config_path());
    let messages = ai::build_adaptation_messages(&spec_content, &template_content);
    ai::call_llm_chat(&config, &messages)
        .await
        .map_err(err_to_string)
}

/// Sends a refinement follow-up using the accumulated chat history.
#[tauri::command]
pub async fn refine_result(chat_history: Vec<ChatMessage>) -> Result<String, String> {
    let config = config::load_or_default(&config::resolve_config_path());
    ai::call_llm_chat(&config, &chat_history)
        .await
        .map_err(err_to_string)
}

/// Maps core errors to stable frontend-facing message strings.
fn err_to_string(e: CoreError) -> String {
    let msg = e.to_string();
    if matches!(e, CoreError::Http(_)) && msg.to_lowercase().contains("timed out") {
        "AI response timed out. Please try again.".to_string()
    } else {
        msg
    }
}

/// Copies text to the system clipboard.
#[tauri::command]
pub fn copy_text(app: AppHandle, text: String) -> Result<(), String> {
    app.clipboard().write_text(&text).map_err(|e| e.to_string())
}

/// Persists a frontend log line (console errors forwarded to the file log).
#[tauri::command]
pub fn log_frontend(level: String, message: String) {
    logging::write(&level, &message);
}

/// Copies `text` to the clipboard and, unless auto-paste is disabled in the
/// config, pastes it into the previously focused window.
#[tauri::command]
pub async fn paste_snippet(
    app: AppHandle,
    state: State<'_, AppState>,
    text: String,
) -> Result<(), String> {
    let prev = *state.prev_focus.lock().unwrap();
    let _ = app.clipboard().write_text(&text);
    // Auto-paste off: the snippet stays in the clipboard only.
    if !crate::load_config().paste_automatically {
        return Ok(());
    }
    if let Some(prev) = prev {
        focus::restore_focus(prev);
        tokio::time::sleep(Duration::from_millis(
            quick_snippets_core::paste::PASTE_SETTLE_MS,
        ))
        .await;
    }
    if let Err(e) = quick_snippets_core::paste::send_paste_keystroke() {
        log_err("paste", &e.to_string());
        return Err(e.to_string());
    }
    Ok(())
}

/// Saves adapted content into the local history directory.
#[tauri::command]
pub fn save_history_file(snippet_name: String, content: String) -> Result<String, String> {
    let dir = base_dir().join("history");
    history::save_history(&dir, &snippet_name, &content)
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

/// Opens a path with the OS default application.
#[tauri::command]
pub fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| e.to_string())
}

/// Opens the native folder picker and returns the selected path.
#[tauri::command]
pub async fn pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    // Runs on the async runtime thread: the blocking dialog API must leave the main thread.
    tauri::async_runtime::spawn_blocking(move || {
        Ok(app
            .dialog()
            .file()
            .blocking_pick_folder()
            .and_then(|fp| fp.as_path().map(|p| p.to_string_lossy().to_string())))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Opens the native file picker filtered to spec file extensions.
#[tauri::command]
pub async fn pick_file(app: AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(app
            .dialog()
            .file()
            .add_filter(
                "Specification documents",
                &["md", "txt", "json", "yaml", "yml"],
            )
            .blocking_pick_file()
            .and_then(|fp| fp.as_path().map(|p| p.to_string_lossy().to_string())))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Opens the native file picker filtered to backup archives (.zip).
#[tauri::command]
pub async fn pick_import_file(app: AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(app
            .dialog()
            .file()
            .add_filter("Export archive", &["zip"])
            .blocking_pick_file()
            .and_then(|fp| fp.as_path().map(|p| p.to_string_lossy().to_string())))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Result of a specification lookup for the modal status card.
#[derive(Debug, Clone, Serialize)]
pub struct SpecDto {
    /// Whether a usable spec was found.
    pub found: bool,
    /// Absolute spec path (None on failure).
    pub path: Option<String>,
    /// Spec content (empty on failure).
    pub content: String,
    /// Spec size in bytes (0 on failure).
    pub size_bytes: u64,
    /// Human-readable failure reason (None on success).
    pub error: Option<String>,
}

/// Builds a failing DTO with a reason and no content.
fn spec_error(error: &str) -> SpecDto {
    SpecDto {
        found: false,
        path: None,
        content: String::new(),
        size_bytes: 0,
        error: Some(error.to_string()),
    }
}

/// Converts a discovered spec into a DTO, enforcing the size limit.
fn spec_from_found(found: FoundSpec) -> SpecDto {
    if let Err(msg) = quick_snippets_core::spec::check_size(&found.content) {
        return spec_error(&msg);
    }
    let size_bytes = found.content.len() as u64;
    SpecDto {
        found: true,
        path: Some(found.path.to_string_lossy().to_string()),
        content: found.content,
        size_bytes,
        error: None,
    }
}

/// Searches a project folder for a specification file.
#[tauri::command]
pub fn load_spec_from_folder(folder: String) -> SpecDto {
    match spec::find_specification(std::path::Path::new(&folder)) {
        Some(found) => spec_from_found(found),
        None => {
            spec_error("Specification file (docs/SPECIFICATION.md / spec.md) not found or empty.")
        }
    }
}

/// Loads and validates a spec file chosen directly.
#[tauri::command]
pub fn load_spec_from_file(file: String) -> SpecDto {
    let path = std::path::Path::new(&file);
    if !path.is_file() {
        return spec_error("File does not exist.");
    }
    match std::fs::read_to_string(path) {
        Ok(content) if !content.trim().is_empty() => spec_from_found(FoundSpec {
            path: path.to_path_buf(),
            content,
        }),
        Ok(_) => spec_error("File contains no text."),
        Err(e) => spec_error(&format!("Error reading file: {e}")),
    }
}

/// Enables or disables native input events for the overlay window.
///
/// Called by the frontend after every cursor hit-test: `false` lets clicks
/// fall through transparent regions to the window below.
#[tauri::command]
pub fn set_overlay_input(app: AppHandle, state: State<'_, AppState>, enabled: bool) {
    let changed = {
        let mut s = state.overlay_input_enabled.lock().unwrap();
        if *s == enabled {
            false
        } else {
            *s = enabled;
            true
        }
    };
    if changed {
        if let Some(win) = app.get_webview_window("overlay") {
            let _ = win.set_ignore_cursor_events(!enabled);
        }
    }
}

/// Hides the overlay (called by the frontend after the close animation).
#[tauri::command]
pub fn hide_overlay(app: AppHandle) {
    overlay::hide(&app);
}

/// Opens (or focuses) the adaptation modal for the given snippet.
///
/// Async on purpose: window creation from a *sync* command runs on the main
/// thread and deadlocks the whole event loop on Windows.
#[tauri::command]
pub async fn open_modal(
    app: AppHandle,
    state: State<'_, AppState>,
    snippet_name: String,
    snippet_content: String,
) -> Result<(), String> {
    *state.modal_init.lock().unwrap() = Some(ModalInit {
        snippet_name,
        snippet_content,
    });
    if let Some(existing) = app.get_webview_window("modal") {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(&app, "modal", WebviewUrl::App("modal.html".into()))
        .title("Nevelim")
        .inner_size(476.0, 371.0)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .resizable(false)
        .center()
        .build()
        .map(|_| ())
        .map_err(|e| {
            eprintln!("[modal] failed to open: {e}");
            e.to_string()
        })
}

/// Closes the adaptation modal window.
#[tauri::command]
pub fn close_modal(app: AppHandle) {
    if let Some(win) = app.get_webview_window("modal") {
        let _ = win.close();
    }
}
