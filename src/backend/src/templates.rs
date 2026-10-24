//! Scanning of the snippet template directory (`templates/*.md`, `*.txt`).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::CoreResult;

/// A single snippet template loaded from disk.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct TemplateEntry {
    /// Human-readable display name (file stem, underscores replaced by spaces).
    pub name: String,
    /// Absolute path of the source file.
    pub path: PathBuf,
    /// Full text content of the file.
    pub content: String,
}

/// Converts a file stem into a display name (`01_Style_names` -> `01 Style names`).
pub fn display_name(file_stem: &str) -> String {
    file_stem.replace('_', " ")
}

/// Scans `dir` for `*.md` and `*.txt` templates, sorted by file name.
///
/// Files that cannot be decoded as UTF-8 are read lossily instead of failing the scan.
pub fn scan_templates(dir: &Path) -> CoreResult<Vec<TemplateEntry>> {
    let mut entries = Vec::new();
    let mut paths: Vec<PathBuf> = std::fs::read_dir(dir)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            matches!(
                p.extension().and_then(|e| e.to_str()),
                Some("md") | Some("txt")
            )
        })
        .collect();
    paths.sort();
    for path in paths {
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string();
        let content = std::fs::read_to_string(&path).unwrap_or_default();
        entries.push(TemplateEntry {
            name: display_name(&stem),
            path,
            content,
        });
    }
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_name_replaces_underscores() {
        assert_eq!(display_name("01_Style_names"), "01 Style names");
        assert_eq!(display_name("plain"), "plain");
    }

    #[test]
    fn scan_returns_sorted_md_and_txt() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("02_b.md"), "b").unwrap();
        std::fs::write(dir.path().join("01_a.md"), "a").unwrap();
        std::fs::write(dir.path().join("03_c.txt"), "c").unwrap();
        std::fs::write(dir.path().join("ignored.json"), "{}").unwrap();

        let entries = scan_templates(dir.path()).unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["01 a", "02 b", "03 c"]);
        assert_eq!(entries[0].content, "a");
    }

    #[test]
    fn scan_missing_dir_is_error() {
        assert!(scan_templates(Path::new("Z:/definitely/missing/dir")).is_err());
    }
}
