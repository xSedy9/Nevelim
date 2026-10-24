//! Backup export: packs the user configuration and all templates into a
//! timestamped zip archive (config.json + templates/ at the archive root).

use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use zip::write::SimpleFileOptions;
use zip::CompressionMethod;

use crate::error::CoreResult;
use crate::templates;

/// Builds the timestamped archive file name (one-second resolution).
fn backup_name(now: SystemTime) -> String {
    let secs = now
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("quick-snippets-backup-{secs}.zip")
}

/// Creates a backup zip in `dest_dir` and returns its full path.
///
/// The archive contains:
/// - `config.json` — the raw user configuration file, or a serialized default
///   config when the file does not exist yet;
/// - `templates/<file>` — every scanned template file.
///
/// An empty or missing templates directory is valid and yields a config-only
/// archive.
pub fn export_backup(
    config_path: &Path,
    templates_dir: &Path,
    dest_dir: &Path,
) -> CoreResult<PathBuf> {
    fs::create_dir_all(dest_dir)?;

    let config_json = match fs::read_to_string(config_path) {
        Ok(json) => json,
        Err(_) => serde_json::to_string_pretty(&crate::config::Config::default())?,
    };

    let zip_path = dest_dir.join(backup_name(SystemTime::now()));
    let file = fs::File::create(&zip_path)?;
    let mut zip = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    zip.start_file("config.json", options)?;
    zip.write_all(config_json.as_bytes())?;

    if templates_dir.is_dir() {
        for t in templates::scan_templates(templates_dir)? {
            let Some(name) = t.path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            zip.start_file(format!("templates/{name}"), options)?;
            zip.write_all(&fs::read(&t.path)?)?;
        }
    }

    zip.finish()?;
    Ok(zip_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    /// Reads the sorted list of entry names stored in a zip file.
    fn entry_names(path: &Path) -> Vec<String> {
        let mut zip = zip::ZipArchive::new(fs::File::open(path).unwrap()).unwrap();
        (0..zip.len())
            .map(|i| zip.by_index(i).unwrap().name().to_string())
            .collect::<Vec<_>>()
            .into_iter()
            .collect::<Vec<_>>()
    }

    #[test]
    fn packs_config_and_templates() {
        let tmp = tempfile::tempdir().unwrap();
        let cfg_path = tmp.path().join("config.json");
        fs::write(&cfg_path, r#"{"hotkey":"alt+shift+v"}"#).unwrap();
        let tdir = tmp.path().join("templates");
        fs::create_dir_all(&tdir).unwrap();
        fs::write(tdir.join("hello_world.md"), "hello").unwrap();
        fs::write(tdir.join("note.txt"), "world").unwrap();

        let out = tmp.path().join("out");
        let zip_path = export_backup(&cfg_path, &tdir, &out).unwrap();

        assert_eq!(zip_path.parent().unwrap(), out);
        assert_eq!(zip_path.extension().unwrap(), "zip");
        let mut names = entry_names(&zip_path);
        names.sort();
        assert_eq!(
            names,
            vec![
                "config.json",
                "templates/hello_world.md",
                "templates/note.txt"
            ]
        );

        let mut zip = zip::ZipArchive::new(fs::File::open(&zip_path).unwrap()).unwrap();
        let mut cfg = String::new();
        zip.by_name("config.json")
            .unwrap()
            .read_to_string(&mut cfg)
            .unwrap();
        assert!(cfg.contains("alt+shift+v"));
        let mut body = String::new();
        zip.by_name("templates/hello_world.md")
            .unwrap()
            .read_to_string(&mut body)
            .unwrap();
        assert_eq!(body, "hello");
    }

    #[test]
    fn missing_config_and_templates_yield_config_only_archive() {
        let tmp = tempfile::tempdir().unwrap();
        let zip_path = export_backup(
            &tmp.path().join("absent.json"),
            &tmp.path().join("absent-templates"),
            &tmp.path().join("out"),
        )
        .unwrap();
        let names = entry_names(&zip_path);
        assert_eq!(names, vec!["config.json"]);

        let mut zip = zip::ZipArchive::new(fs::File::open(&zip_path).unwrap()).unwrap();
        let mut cfg = String::new();
        zip.by_name("config.json")
            .unwrap()
            .read_to_string(&mut cfg)
            .unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&cfg).unwrap();
        assert_eq!(parsed["hotkey"], "alt+shift+v");
    }
}
