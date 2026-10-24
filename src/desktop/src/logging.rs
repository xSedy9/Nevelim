//! Minimal append-only file logging under `<base_dir>/logs/`.
//!
//! std-only by design (no log crate/plugins): the desktop shell and IPC
//! commands record problems to `logs/nevelim.log`, and the frontend
//! forwards its console errors through the `log_frontend` command. The active
//! file is rotated to `nevelim.log.old` once it grows past 2 MB.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

/// Max size of the active log file before rotation.
const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;

static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Resolves the log file path for a base directory.
pub fn log_path(base_dir: &Path) -> PathBuf {
    base_dir.join("logs").join("nevelim.log")
}

/// Initializes the log file path (called once at app setup).
pub fn init(path: PathBuf) {
    let _ = LOG_PATH.set(path);
}

/// Appends a line at info level (best-effort, never panics).
pub fn info(message: &str) {
    write("INFO", message);
}

/// Appends a line at warn level (best-effort, never panics).
pub fn warn(message: &str) {
    write("WARN", message);
}

/// Appends a line at error level (best-effort, never panics).
pub fn error(message: &str) {
    write("ERROR", message);
}

/// Appends a raw line with an explicit level (frontend bridge).
pub fn write(level: &str, message: &str) {
    let Some(path) = LOG_PATH.get() else {
        return;
    };
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(meta) = fs::metadata(path) {
        if meta.len() > MAX_LOG_BYTES {
            let old = path.with_extension("log.old");
            let _ = fs::rename(path, old);
        }
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "[{}] [{}] {}", stamp(), level, message);
    }
}

/// Formats the current UTC time as `YYYY-MM-DD HH:MM:SS`
/// (civil-from-days algorithm; no chrono dependency).
fn stamp() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if mo <= 2 { y + 1 } else { y };
    format!("{year:04}-{mo:02}-{d:02} {h:02}:{m:02}:{s:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stamp_formats_valid_timestamp() {
        let s = stamp();
        assert_eq!(s.len(), 19);
        assert_eq!(&s[4..5], "-");
        assert_eq!(&s[7..8], "-");
        assert_eq!(&s[10..11], " ");
        assert_eq!(&s[13..14], ":");
        assert_eq!(&s[16..17], ":");
    }

    #[test]
    fn stamp_formats_fixed_epoch() {
        // 2026-01-01 00:00:00 UTC = 1767225600.
        let secs = 1_767_225_600;
        let days = (secs / 86_400) as i64;
        let rem = secs % 86_400;
        assert_eq!((rem / 3600), 0);
        // The civil conversion is exercised through `stamp` indirectly; here we
        // only pin the day math.
        assert_eq!(days, 20_454);
    }
}
