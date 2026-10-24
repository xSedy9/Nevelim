/**
 * Typed wrappers around Tauri IPC commands.
 *
 * The frontend never touches system APIs directly - everything goes through
 * the commands defined in `src/desktop/src/commands.rs`.
 */

import { invoke } from "@tauri-apps/api/core";

/** Snippet template descriptor (matches core::templates::TemplateEntry). */
export interface TemplateDto {
  /** Display name (file stem with underscores replaced). */
  name: string;
  /** Absolute file path. */
  path: string;
  /** Full text content. */
  content: string;
}

/** Sanitized application state (no API keys cross the IPC boundary). */
export interface AppStateDto {
  /** Global hotkey string. */
  hotkey: string;
  /** Selected provider id: gemini | openai | openrouter. */
  provider: string;
  /** Gemini model id. */
  gemini_model: string;
  /** OpenAI model id. */
  openai_model: string;
  /** OpenRouter model id. */
  openrouter_model: string;
  /** Auto-paste behaviour flag. */
  paste_automatically: boolean;
  /** Snippet templates. */
  templates: TemplateDto[];
  /** Resolved templates directory. */
  templates_dir: string;
}

/** Specification lookup result for the adaptation modal. */
export interface SpecDto {
  /** Whether a usable spec was found. */
  found: boolean;
  /** Absolute spec path, when found. */
  path: string | null;
  /** Spec content (empty on failure). */
  content: string;
  /** Spec size in bytes (0 on failure). */
  size_bytes: number;
  /** Human-readable failure reason. */
  error: string | null;
}

/** Chat message exchanged with the AI provider. */
export interface ChatMessage {
  /** One of system | user | assistant. */
  role: string;
  /** Message text. */
  content: string;
}

/** Payload injected into a freshly opened adaptation modal. */
export interface ModalInit {
  /** Display name of the snippet. */
  snippet_name: string;
  /** Snippet template content. */
  snippet_content: string;
}

/** AI provider selector (matches core::config::Provider). */
export type ProviderId = "gemini" | "openai" | "openrouter";

/** Validation result for a candidate import file. */
export interface ImportCheckDto {
  /** Whether the file is a valid snippet import. */
  ok: boolean;
  /** Suggested template name (file stem). */
  name: string;
  /** File size in bytes (0 on failure). */
  size_bytes: number;
  /** Human-readable failure reason (None on success). */
  error: string | null;
}

/** Full application configuration (settings window reads and edits it). */
export interface AppConfig {
  /** Global hotkey string, e.g. "alt+shift+v". */
  hotkey: string;
  /** Selected AI provider. */
  provider: ProviderId;
  /** Gemini API key. */
  gemini_api_key: string;
  /** Gemini model id. */
  gemini_model: string;
  /** OpenAI API key. */
  openai_api_key: string;
  /** OpenAI API base URL. */
  openai_api_base: string;
  /** OpenAI model id. */
  openai_model: string;
  /** OpenRouter API key. */
  openrouter_api_key: string;
  /** OpenRouter model id. */
  openrouter_model: string;
  /** Auto-paste behaviour flag. */
  paste_automatically: boolean;
  /** Folder for template export; empty means the system Downloads folder. */
  export_dir: string;
  /** Recently used project folders. */
  recent_projects: string[];
}

/** All backend commands used by the UI. */
export const api = {
  /** Loads the sanitized app state (config + templates). */
  getAppState: (): Promise<AppStateDto> => invoke("get_app_state"),
  /** Adapts a template against a specification via the configured provider. */
  adaptTemplate: (specContent: string, templateContent: string): Promise<string> =>
    invoke("adapt_template", { specContent, templateContent }),
  /** Sends a refinement follow-up with the accumulated chat history. */
  refineResult: (chatHistory: ChatMessage[]): Promise<string> =>
    invoke("refine_result", { chatHistory }),
  /** Copies text to the system clipboard. */
  copyText: (text: string): Promise<void> => invoke("copy_text", { text }),
  /** Copies text and pastes it into the previously focused window. */
  pasteSnippet: (text: string): Promise<void> => invoke("paste_snippet", { text }),
  /** Saves adapted content to the local history directory. */
  saveHistory: (snippetName: string, content: string): Promise<string> =>
    invoke("save_history_file", { snippetName, content }),
  /** Opens a path with the OS default application. */
  openPath: (path: string): Promise<void> => invoke("open_path", { path }),
  /** Opens the native folder picker. */
  pickFolder: (): Promise<string | null> => invoke("pick_folder"),
  /** Opens the native file picker filtered to spec extensions. */
  pickFile: (): Promise<string | null> => invoke("pick_file"),
  /** Searches a project folder for a specification file. */
  loadSpecFromFolder: (folder: string): Promise<SpecDto> =>
    invoke("load_spec_from_folder", { folder }),
  /** Loads and validates a spec file chosen directly. */
  loadSpecFromFile: (file: string): Promise<SpecDto> => invoke("load_spec_from_file", { file }),
  /** Enables/disables native input for the overlay (click pass-through control). */
  setOverlayInput: (enabled: boolean): Promise<void> =>
    invoke("set_overlay_input", { enabled }),
  /** Hides the overlay window. */
  hideOverlay: (): Promise<void> => invoke("hide_overlay"),
  /** Opens the adaptation modal for a snippet. */
  openModal: (snippetName: string, snippetContent: string): Promise<void> =>
    invoke("open_modal", { snippetName, snippetContent }),
  /** Closes the adaptation modal. */
  closeModal: (): Promise<void> => invoke("close_modal"),
  /** Loads the pending modal payload, if any. */
  getModalInit: (): Promise<ModalInit | null> => invoke("get_modal_init"),
  /** Loads the full configuration for the settings window. */
  getSettings: (): Promise<AppConfig> => invoke("get_settings"),
  /** Saves the configuration and re-registers the global hotkey. */
  saveSettings: (config: AppConfig): Promise<void> => invoke("save_settings", { config }),
  /** Opens the settings window. */
  openSettings: (): Promise<void> => invoke("open_settings"),
  /** Closes the settings window. */
  closeSettings: (): Promise<void> => invoke("close_settings"),
  /** Copies all templates into the configured export folder. */
  exportTemplates: (): Promise<string> => invoke("export_templates"),
  /** Validates a candidate import file. */
  checkImportFile: (file: string): Promise<ImportCheckDto> =>
    invoke("check_import_file", { file }),
  /** Copies a validated file into the templates directory. */
  importTemplate: (file: string): Promise<string> => invoke("import_template", { file }),
  /** Opens the import wizard window. */
  openImport: (): Promise<void> => invoke("open_import"),
  /** Closes the import wizard window. */
  closeImport: (): Promise<void> => invoke("close_import"),
};
