//! Discovery of the project specification file.
//!
//! Search order (mirrors the legacy implementation):
//! 1. Preferred names inside `docs/` (`SPECIFICATION.md`, `specification.md`,
//!    `SPEC.md`, `spec.md`, `README.md`);
//! 2. The same preferred names in the project root;
//! 3. The first non-empty `*.md` file in `docs/`, then in the root (sorted).

use std::path::{Path, PathBuf};

/// Preferred specification file names, in priority order.
pub const PREFERRED_NAMES: [&str; 5] = [
    "SPECIFICATION.md",
    "specification.md",
    "SPEC.md",
    "spec.md",
    "README.md",
];

/// Result of a specification lookup: absolute path plus non-empty content.
#[derive(Debug, Clone, PartialEq)]
pub struct FoundSpec {
    /// Path of the discovered specification file.
    pub path: PathBuf,
    /// File content (guaranteed non-empty).
    pub content: String,
}

/// Reads a file and returns its content if it parses and is non-blank.
fn read_non_empty(path: &Path) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
    let trimmed = content.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(content)
    }
}

/// Checks `base` for the preferred spec names, returning the first non-empty hit.
///
/// Matching is case-insensitive (Windows/macOS filesystems), and the returned
/// path keeps the actual on-disk file name spelling.
fn scan_preferred(base: &Path) -> Option<(PathBuf, String)> {
    let mut names: Vec<String> = std::fs::read_dir(base)
        .ok()?
        .filter_map(|e| e.ok().and_then(|e| e.file_name().into_string().ok()))
        .collect();
    names.sort_by_key(|n| {
        PREFERRED_NAMES
            .iter()
            .position(|p| p.eq_ignore_ascii_case(n))
            .unwrap_or(usize::MAX)
    });
    names
        .into_iter()
        .filter(|n| PREFERRED_NAMES.iter().any(|p| p.eq_ignore_ascii_case(n)))
        .find_map(|n| {
            let path = base.join(&n);
            read_non_empty(&path).map(|c| (path, c))
        })
}

/// Finds the first non-empty `*.md` file directly inside `base` (sorted by name).
fn scan_any_md(base: &Path) -> Option<(PathBuf, String)> {
    let mut paths: Vec<PathBuf> = std::fs::read_dir(base)
        .ok()?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("md"))
        .collect();
    paths.sort();
    paths
        .into_iter()
        .find_map(|path| read_non_empty(&path).map(|c| (path, c)))
}

/// Looks for a project specification starting from `root`.
///
/// Returns `None` when nothing suitable is found (callers usually surface
/// a validation error in that case).
pub fn find_specification(root: &Path) -> Option<FoundSpec> {
    let docs = root.join("docs");
    let search_dirs = [docs, root.to_path_buf()]
        .into_iter()
        .filter(|d| d.is_dir());

    for dir in search_dirs {
        if let Some((path, content)) = scan_preferred(&dir).or_else(|| scan_any_md(&dir)) {
            return Some(FoundSpec { path, content });
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_docs_specification_over_root_readme() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("docs")).unwrap();
        std::fs::write(dir.path().join("README.md"), "# root readme").unwrap();
        let spec_path = dir.path().join("docs").join("SPECIFICATION.md");
        std::fs::write(&spec_path, "# spec").unwrap();

        let found = find_specification(dir.path()).unwrap();
        assert_eq!(found.path, spec_path);
        assert_eq!(found.content, "# spec");
    }

    #[test]
    fn falls_back_to_first_md_in_docs() {
        let dir = tempfile::tempdir().unwrap();
        let docs = dir.path().join("docs");
        std::fs::create_dir(&docs).unwrap();
        std::fs::write(docs.join("z_notes.md"), "z").unwrap();
        std::fs::write(docs.join("a_notes.md"), "a").unwrap();

        let found = find_specification(dir.path()).unwrap();
        assert_eq!(found.path, docs.join("a_notes.md"));
    }

    #[test]
    fn skips_empty_and_uses_root_when_docs_missing() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("spec.md"), "   ").unwrap();
        std::fs::write(dir.path().join("specification.md"), "root spec").unwrap();

        let found = find_specification(dir.path()).unwrap();
        assert_eq!(found.path, dir.path().join("specification.md"));
    }

    #[test]
    fn none_when_nothing_found() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("only.txt"), "text").unwrap();
        assert!(find_specification(dir.path()).is_none());
    }
}
