//! Global hotkey string parsing and validation.
//!
//! The canonical format is `mod+mod+key` (case-insensitive), e.g.
//! `"alt+shift+v"`, `"ctrl+`"`, `"f5"`. Parsing here is pure logic so the
//! desktop layer can map it onto the Tauri global-shortcut plugin.

use serde::{Deserialize, Serialize};

/// A parsed hotkey: held modifiers plus the main key.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct HotkeySpec {
    /// Hold Ctrl.
    pub ctrl: bool,
    /// Hold Alt.
    pub alt: bool,
    /// Hold Shift.
    pub shift: bool,
    /// Hold Win / Meta.
    pub meta: bool,
    /// Main key, normalized lowercase (`"v"`, `"f5"`, `` "`" ``, `"space"`).
    pub key: String,
}

impl HotkeySpec {
    /// Re-renders the spec into the canonical `mod+mod+key` string.
    pub fn to_string_canonical(&self) -> String {
        let mut parts = Vec::new();
        if self.ctrl {
            parts.push("ctrl");
        }
        if self.alt {
            parts.push("alt");
        }
        if self.shift {
            parts.push("shift");
        }
        if self.meta {
            parts.push("meta");
        }
        parts.push(self.key.as_str());
        parts.join("+")
    }
}

/// Parses a hotkey string like `"alt+shift+v"` into a [`HotkeySpec`].
///
/// Returns `None` when the string is empty or contains an unknown token.
pub fn parse_hotkey(input: &str) -> Option<HotkeySpec> {
    let mut spec = HotkeySpec {
        ctrl: false,
        alt: false,
        shift: false,
        meta: false,
        key: String::new(),
    };
    for raw in input.split('+') {
        let token = raw.trim().to_lowercase();
        if token.is_empty() {
            return None;
        }
        match token.as_str() {
            "ctrl" | "control" => spec.ctrl = true,
            "alt" | "menu" => spec.alt = true,
            "shift" => spec.shift = true,
            "meta" | "win" | "windows" | "cmd" | "command" => spec.meta = true,
            _ => {
                if spec.key.is_empty() {
                    spec.key = token;
                } else {
                    return None; // two main keys
                }
            }
        }
    }
    if spec.key.is_empty() {
        None
    } else {
        Some(spec)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_mods_and_key() {
        let hk = parse_hotkey("Alt+Shift+V").unwrap();
        assert!(hk.alt && hk.shift && !hk.ctrl && !hk.meta);
        assert_eq!(hk.key, "v");
        assert_eq!(hk.to_string_canonical(), "alt+shift+v");
    }

    #[test]
    fn parses_aliases_and_fkeys() {
        assert_eq!(parse_hotkey("control+F5").unwrap().key, "f5");
        assert!(parse_hotkey("win+space").unwrap().meta);
        assert!(parse_hotkey("cmd+k").unwrap().meta);
    }

    #[test]
    fn rejects_garbage() {
        assert!(parse_hotkey("").is_none());
        assert!(parse_hotkey("alt+").is_none());
        assert!(parse_hotkey("alt+shift").is_none()); // no key
        assert!(parse_hotkey("v+b").is_none()); // two keys
    }
}
