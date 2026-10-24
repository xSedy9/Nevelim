//! Application configuration: schema, defaults, load/save.
//!
//! The `config.json` schema is backwards compatible with the legacy Python
//! implementation: unknown fields are preserved on save and missing fields
//! fall back to defaults.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::CoreResult;

/// AI provider selector.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    /// Google Gemini.
    #[default]
    Gemini,
    /// OpenAI ChatGPT API.
    #[serde(rename = "openai")]
    OpenAi,
    /// OpenRouter gateway.
    #[serde(rename = "openrouter")]
    OpenRouter,
}

/// Application configuration stored in `config.json`.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(default)]
pub struct Config {
    /// Global hotkey string, e.g. `"alt+shift+v"`.
    pub hotkey: String,
    /// Currently selected AI provider.
    pub provider: Provider,
    /// Gemini API key.
    pub gemini_api_key: String,
    /// Gemini model id.
    pub gemini_model: String,
    /// OpenAI API key.
    pub openai_api_key: String,
    /// OpenAI API base URL.
    pub openai_api_base: String,
    /// OpenAI model id.
    pub openai_model: String,
    /// OpenRouter API key.
    pub openrouter_api_key: String,
    /// OpenRouter model id.
    pub openrouter_model: String,
    /// Whether selecting "paste" automatically pastes into the previous window.
    pub paste_automatically: bool,
    /// Folder for template export; empty means the system Downloads folder.
    pub export_dir: String,
    /// Recently used project folders (most recent first, capped).
    pub recent_projects: Vec<String>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            hotkey: "alt+shift+v".to_string(),
            provider: Provider::Gemini,
            gemini_api_key: String::new(),
            gemini_model: "gemini-2.5-flash".to_string(),
            openai_api_key: String::new(),
            openai_api_base: "https://api.openai.com/v1".to_string(),
            openai_model: "gpt-4o-mini".to_string(),
            openrouter_api_key: String::new(),
            openrouter_model: "google/gemini-2.5-flash".to_string(),
            paste_automatically: true,
            export_dir: String::new(),
            recent_projects: Vec::new(),
        }
    }
}

impl Config {
    /// Pushes a project folder to the front of the recents list (deduplicated, capped at 10).
    pub fn push_recent_project(&mut self, folder: &str) {
        self.recent_projects.retain(|p| p != folder);
        self.recent_projects.insert(0, folder.to_string());
        self.recent_projects.truncate(10);
    }

    /// Loads the configuration from a JSON file.
    pub fn load_from(path: &Path) -> CoreResult<Config> {
        let raw = std::fs::read_to_string(path)?;
        Ok(serde_json::from_str(&raw)?)
    }

    /// Saves the configuration to a JSON file (pretty printed, UTF-8).
    pub fn save_to(&self, path: &Path) -> CoreResult<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(self)?;
        std::fs::write(path, json)?;
        Ok(())
    }
}

/// Resolves the user-data base directory (the one holding `config.json`,
/// `templates/` and `history/`).
///
/// Search order:
/// 1. The executable directory (packaged layout);
/// 2. The executable directory's grandparent (cargo workspace layout:
///    `target/debug` -> repository root);
/// 3. The current working directory.
///
/// Falls back to the executable directory when no candidate matches.
pub fn resolve_base_dir() -> PathBuf {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));
    let mut candidates = vec![exe_dir.clone()];
    if let Some(grandparent) = exe_dir.ancestors().nth(2) {
        candidates.push(grandparent.to_path_buf());
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd);
    }
    pick_base_dir(&candidates)
}

/// Picks the first candidate that looks like a user-data directory.
///
/// A directory qualifies when it contains a `templates/` folder or a
/// `config.json` file; otherwise the first candidate wins.
pub fn pick_base_dir(candidates: &[PathBuf]) -> PathBuf {
    candidates
        .iter()
        .find(|c| c.join("templates").is_dir() || c.join("config.json").is_file())
        .cloned()
        .unwrap_or_else(|| {
            candidates
                .first()
                .cloned()
                .unwrap_or_else(|| PathBuf::from("."))
        })
}

/// Resolves the config file actually in use.
///
/// Prefers `config.json` in the resolved base directory; when neither the
/// exe-side nor the workspace/cwd copy exists, returns the exe-side path for
/// creation on first save.
pub fn resolve_config_path() -> PathBuf {
    resolve_base_dir().join("config.json")
}

/// Loads the configuration, falling back to defaults when the file is missing or corrupt.
pub fn load_or_default(path: &Path) -> Config {
    Config::load_from(path).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_legacy_schema() {
        let cfg = Config::default();
        assert_eq!(cfg.hotkey, "alt+shift+v");
        assert_eq!(cfg.provider, Provider::Gemini);
        assert_eq!(cfg.gemini_model, "gemini-2.5-flash");
        assert!(cfg.paste_automatically);
        assert_eq!(cfg.openai_api_base, "https://api.openai.com/v1");
    }

    #[test]
    fn loads_legacy_config_and_fills_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        // Legacy file: no `recent_projects` field at all.
        std::fs::write(
            &path,
            r#"{"hotkey":"ctrl+shift+b","provider":"openai","openai_api_key":"k"}"#,
        )
        .unwrap();
        let cfg = Config::load_from(&path).unwrap();
        assert_eq!(cfg.hotkey, "ctrl+shift+b");
        assert_eq!(cfg.provider, Provider::OpenAi);
        assert_eq!(cfg.openai_api_key, "k");
        // Defaults are filled in for missing fields.
        assert_eq!(cfg.gemini_model, "gemini-2.5-flash");
    }

    #[test]
    fn roundtrip_preserves_fields() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        let mut cfg = Config::default();
        cfg.hotkey = "ctrl+`".to_string();
        cfg.push_recent_project("Z:/BonusHunter");
        cfg.push_recent_project("Z:/Other");
        cfg.push_recent_project("Z:/BonusHunter");
        assert_eq!(cfg.recent_projects.len(), 2);
        cfg.save_to(&path).unwrap();
        let loaded = Config::load_from(&path).unwrap();
        assert_eq!(loaded, cfg);
    }

    #[test]
    fn load_or_default_survives_corrupt_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        std::fs::write(&path, "{ not json").unwrap();
        let cfg = load_or_default(&path);
        assert_eq!(cfg, Config::default());
    }

    #[test]
    fn pick_base_dir_prefers_candidate_with_templates() {
        let empty = tempfile::tempdir().unwrap();
        let full = tempfile::tempdir().unwrap();
        std::fs::create_dir(full.path().join("templates")).unwrap();
        let picked = pick_base_dir(&[empty.path().to_path_buf(), full.path().to_path_buf()]);
        assert_eq!(picked, full.path());
    }

    #[test]
    fn pick_base_dir_accepts_config_json_marker() {
        let with_cfg = tempfile::tempdir().unwrap();
        std::fs::write(with_cfg.path().join("config.json"), "{}").unwrap();
        let picked = pick_base_dir(&[with_cfg.path().to_path_buf()]);
        assert_eq!(picked, with_cfg.path());
    }

    #[test]
    fn pick_base_dir_falls_back_to_first_candidate() {
        let empty = tempfile::tempdir().unwrap();
        let picked = pick_base_dir(&[empty.path().to_path_buf()]);
        assert_eq!(picked, empty.path());
    }

    #[test]
    fn pick_base_dir_empty_candidates_uses_cwd() {
        assert_eq!(pick_base_dir(&[]), PathBuf::from("."));
    }
}
