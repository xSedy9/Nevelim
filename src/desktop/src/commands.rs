//! IPC commands exposed to the web frontend.
//!
//! Every system interaction (clipboard, dialogs, AI calls, paste, file access)
//! goes through this module so the frontend stays platform-free and the API
//! keys never leave the Rust side.

use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager, State, WebviewUrl};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use quick_snippets_core::ai::{self, ChatMessage};
use quick_snippets_core::config::{self, Config};
use quick_snippets_core::error::CoreError;
use quick_snippets_core::history;
use quick_snippets_core::spec::{self, FoundSpec};
use quick_snippets_core::templates::{self, TemplateEntry};

use crate::focus;
use crate::overlay;
use crate::state::{AppState, ModalInit};

/// Base directory for user data (config, templates, history): the executable
/// directory, falling back to the CWD in dev mode.
fn base_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .filter(|d| d.join("config.json").exists() || d.join("templates").exists())
        .unwrap_or_else(|| PathBuf::from("."))
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
        "Таймаут ответа нейросети. Попробуйте еще раз.".to_string()
    } else {
        msg
    }
}

/// Copies text to the system clipboard.
#[tauri::command]
pub fn copy_text(app: AppHandle, text: String) -> Result<(), String> {
    app.clipboard().write_text(&text).map_err(|e| e.to_string())
}

/// Copies `text` to the clipboard and pastes it into the previously focused window.
#[tauri::command]
pub async fn paste_snippet(
    app: AppHandle,
    state: State<'_, AppState>,
    text: String,
) -> Result<(), String> {
    let prev = *state.prev_focus.lock().unwrap();
    let _ = app.clipboard().write_text(&text);
    if let Some(prev) = prev {
        focus::restore_focus(prev);
        tokio::time::sleep(Duration::from_millis(
            quick_snippets_core::paste::PASTE_SETTLE_MS,
        ))
        .await;
    }
    quick_snippets_core::paste::send_paste_keystroke().map_err(|e| e.to_string())
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
                "Документы спецификаций",
                &["md", "txt", "json", "yaml", "yml"],
            )
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
    /// Human-readable failure reason (None on success).
    pub error: Option<String>,
}

/// Searches a project folder for a specification file.
#[tauri::command]
pub fn load_spec_from_folder(folder: String) -> SpecDto {
    match spec::find_specification(std::path::Path::new(&folder)) {
        Some(FoundSpec { path, content }) => SpecDto {
            found: true,
            path: Some(path.to_string_lossy().to_string()),
            content,
            error: None,
        },
        None => SpecDto {
            found: false,
            path: None,
            content: String::new(),
            error: Some(
                "Файл спецификации (docs/SPECIFICATION.md / spec.md) не найден или пуст.".into(),
            ),
        },
    }
}

/// Loads and validates a spec file chosen directly.
#[tauri::command]
pub fn load_spec_from_file(file: String) -> SpecDto {
    let path = std::path::Path::new(&file);
    if !path.is_file() {
        return SpecDto {
            found: false,
            path: None,
            content: String::new(),
            error: Some("Файл не существует.".into()),
        };
    }
    match std::fs::read_to_string(path) {
        Ok(content) if !content.trim().is_empty() => SpecDto {
            found: true,
            path: Some(file),
            content,
            error: None,
        },
        Ok(_) => SpecDto {
            found: false,
            path: None,
            content: String::new(),
            error: Some("Файл не содержит текста.".into()),
        },
        Err(e) => SpecDto {
            found: false,
            path: None,
            content: String::new(),
            error: Some(format!("Ошибка чтения файла: {e}")),
        },
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
#[tauri::command]
pub fn open_modal(
    app: AppHandle,
    state: State<'_, AppState>,
    snippet_name: String,
    snippet_content: String,
) {
    *state.modal_init.lock().unwrap() = Some(ModalInit {
        snippet_name,
        snippet_content,
    });
    if let Some(existing) = app.get_webview_window("modal") {
        let _ = existing.show();
        let _ = existing.set_focus();
        return;
    }
    let _ = tauri::WebviewWindowBuilder::new(&app, "modal", WebviewUrl::App("modal.html".into()))
        .title("Quick Snippets")
        .inner_size(476.0, 371.0)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .resizable(false)
        .center()
        .build();
}

/// Closes the adaptation modal window.
#[tauri::command]
pub fn close_modal(app: AppHandle) {
    if let Some(win) = app.get_webview_window("modal") {
        let _ = win.close();
    }
}
