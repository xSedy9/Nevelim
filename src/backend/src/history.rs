//! History storage: adapted results are saved as timestamped markdown files.

use std::path::{Path, PathBuf};

use crate::error::CoreResult;

/// Sanitizes a snippet name for safe use inside a file name.
pub fn sanitize_name(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// Formats the current local time as `YYYY-MM-DD_HH-MM-SS`.
pub fn timestamp_now() -> String {
    // Cheap local timestamp without pulling chrono: seconds since epoch decoded
    // manually as UTC (close enough for unique history file names).
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = secs / 86_400;
    let rem = secs % 86_400;
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // Civil-from-days algorithm (Howard Hinnant) for a UTC Y-M-D.
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mth = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mth <= 2 { y + 1 } else { y };
    format!("{y:04}-{mth:02}-{d:02}_{h:02}-{m:02}-{s:02}")
}

/// Saves `content` into `history_dir` as `<timestamp>_<sanitized name>.md`.
///
/// Returns the path of the written file. Missing directories are created.
pub fn save_history(history_dir: &Path, snippet_name: &str, content: &str) -> CoreResult<PathBuf> {
    std::fs::create_dir_all(history_dir)?;
    let file_name = format!("{}_{}.md", timestamp_now(), sanitize_name(snippet_name));
    let path = history_dir.join(file_name);
    std::fs::write(&path, content)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_replaces_special_chars() {
        // Alphanumerics (including Cyrillic) and -_ survive; everything else collapses.
        assert_eq!(
            sanitize_name("01 Стиль: названий/2"),
            "01_Стиль__названий_2"
        );
        assert_eq!(sanitize_name("ok-name_2.md"), "ok-name_2_md");
    }

    #[test]
    fn timestamp_has_expected_shape() {
        let ts = timestamp_now();
        assert_eq!(ts.len(), 19);
        let bytes = ts.as_bytes();
        assert_eq!(bytes[4], b'-');
        assert_eq!(bytes[7], b'-');
        assert_eq!(bytes[10], b'_');
        assert_eq!(bytes[13], b'-');
        assert_eq!(bytes[16], b'-');
    }

    #[test]
    fn save_creates_dir_and_file() {
        let dir = tempfile::tempdir().unwrap();
        let history = dir.path().join("nested").join("history");
        let path = save_history(&history, "01 Стиль", "# result").unwrap();
        assert!(path.is_file());
        assert!(path.extension().and_then(|e| e.to_str()) == Some("md"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "# result");
    }
}
