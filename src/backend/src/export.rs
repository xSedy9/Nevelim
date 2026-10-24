//! Backup export and import: packs the user configuration and all templates
//! into a timestamped zip archive (config.json + templates/ at the archive
//! root) and restores archives created this way.

use std::fs;
use std::io::{Read as _, Write as _};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use zip::write::SimpleFileOptions;
use zip::CompressionMethod;

use crate::config::Config;
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

/// Quick summary of a backup archive contents.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BackupInfo {
    /// Whether the archive contains a `config.json` entry.
    pub has_config: bool,
    /// Number of template files under `templates/`.
    pub templates: usize,
}

/// Opens a backup archive for reading.
fn open_archive(zip_path: &Path) -> CoreResult<zip::ZipArchive<fs::File>> {
    let file = fs::File::open(zip_path)?;
    Ok(zip::ZipArchive::new(file)?)
}

/// Collects safe template file names (`templates/<name>`, no directories,
/// no path traversal) stored in the archive.
fn template_names<R: std::io::Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
) -> CoreResult<Vec<String>> {
    let mut names = Vec::new();
    for i in 0..archive.len() {
        let name = archive.by_index(i)?.name().to_string();
        if let Some(rest) = name.strip_prefix("templates/") {
            let safe = !rest.is_empty()
                && !rest.contains('/')
                && !rest.contains('\\')
                && !rest.contains("..");
            if safe {
                names.push(rest.to_string());
            }
        }
    }
    Ok(names)
}

/// Validates a candidate backup archive without extracting anything.
///
/// Returns [`BackupInfo`] describing the contents; an unreadable or corrupted
/// archive yields an error.
pub fn validate_backup(zip_path: &Path) -> CoreResult<BackupInfo> {
    let mut archive = open_archive(zip_path)?;
    let has_config = archive.by_name("config.json").is_ok();
    let templates = template_names(&mut archive)?.len();
    Ok(BackupInfo {
        has_config,
        templates,
    })
}

/// Picks a non-existing destination path inside `dir` for `file_name`,
/// appending a numeric suffix before the extension when needed.
fn unique_destination(dir: &Path, file_name: &str) -> PathBuf {
    let path = dir.join(file_name);
    if !path.exists() {
        return path;
    }
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(file_name)
        .to_string();
    let ext = Path::new(file_name)
        .extension()
        .and_then(|s| s.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_default();
    let mut n = 1;
    loop {
        let candidate = dir.join(format!("{stem} ({n}){ext}"));
        if !candidate.exists() {
            return candidate;
        }
        n += 1;
    }
}

/// Restores a backup archive created by [`export_backup`].
///
/// When the archive contains `config.json`, it replaces the user
/// configuration (missing fields fall back to defaults). Every template file
/// is copied into `templates_dir`; existing files are never overwritten (a
/// numeric suffix is added instead). Returns the number of imported templates.
pub fn import_backup(
    zip_path: &Path,
    templates_dir: &Path,
    config_path: &Path,
) -> CoreResult<usize> {
    let mut archive = open_archive(zip_path)?;

    // Configuration first: a malformed config aborts before any template is
    // written.
    if archive.by_name("config.json").is_ok() {
        let mut json = String::new();
        archive.by_name("config.json")?.read_to_string(&mut json)?;
        let cfg: Config = serde_json::from_str(&json)?;
        cfg.save_to(config_path)?;
    }

    fs::create_dir_all(templates_dir)?;
    let mut imported = 0usize;
    for name in template_names(&mut archive)? {
        let mut bytes = Vec::new();
        archive
            .by_name(&format!("templates/{name}"))?
            .read_to_end(&mut bytes)?;
        fs::write(unique_destination(templates_dir, &name), &bytes)?;
        imported += 1;
    }
    Ok(imported)
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

    #[test]
    fn validate_reports_config_and_template_counts() {
        let tmp = tempfile::tempdir().unwrap();
        let cfg_path = tmp.path().join("config.json");
        fs::write(&cfg_path, r#"{"hotkey":"ctrl+shift+k"}"#).unwrap();
        let tdir = tmp.path().join("templates");
        fs::create_dir_all(&tdir).unwrap();
        fs::write(tdir.join("a.md"), "a").unwrap();
        fs::write(tdir.join("b.md"), "b").unwrap();

        let zip_path = export_backup(&cfg_path, &tdir, &tmp.path().join("out")).unwrap();
        let info = validate_backup(&zip_path).unwrap();
        assert!(info.has_config);
        assert_eq!(info.templates, 2);

        // A foreign zip without backup entries validates as empty.
        let foreign = tmp.path().join("foreign.zip");
        let f = fs::File::create(&foreign).unwrap();
        let mut zw = zip::ZipWriter::new(f);
        zw.start_file("readme.txt", SimpleFileOptions::default())
            .unwrap();
        zw.write_all(b"hi").unwrap();
        zw.finish().unwrap();
        let info = validate_backup(&foreign).unwrap();
        assert!(!info.has_config);
        assert_eq!(info.templates, 0);
    }

    #[test]
    fn import_restores_config_and_templates_without_overwrites() {
        let tmp = tempfile::tempdir().unwrap();
        let cfg_path = tmp.path().join("config.json");
        fs::write(&cfg_path, r#"{"hotkey":"ctrl+shift+k"}"#).unwrap();
        let tdir = tmp.path().join("templates");
        fs::create_dir_all(&tdir).unwrap();
        fs::write(tdir.join("a.md"), "v1").unwrap();
        fs::write(tdir.join("b.md"), "b").unwrap();

        let zip_path = export_backup(&cfg_path, &tdir, &tmp.path().join("out")).unwrap();

        // Target state: different config, "a.md" already exists with other content.
        let dest_cfg = tmp.path().join("target-config.json");
        fs::write(&dest_cfg, r#"{"hotkey":"alt+shift+v"}"#).unwrap();
        let dest_templates = tmp.path().join("target-templates");
        fs::create_dir_all(&dest_templates).unwrap();
        fs::write(dest_templates.join("a.md"), "old").unwrap();

        let imported = import_backup(&zip_path, &dest_templates, &dest_cfg).unwrap();
        assert_eq!(imported, 2);
        let restored: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&dest_cfg).unwrap()).unwrap();
        assert_eq!(restored["hotkey"], "ctrl+shift+k");
        assert_eq!(
            fs::read_to_string(dest_templates.join("a.md")).unwrap(),
            "old"
        );
        assert_eq!(
            fs::read_to_string(dest_templates.join("a (1).md")).unwrap(),
            "v1"
        );
        assert_eq!(
            fs::read_to_string(dest_templates.join("b.md")).unwrap(),
            "b"
        );
    }

    #[test]
    fn import_of_corrupted_archive_fails() {
        let tmp = tempfile::tempdir().unwrap();
        let bad = tmp.path().join("bad.zip");
        fs::write(&bad, b"not a zip").unwrap();
        let result = import_backup(&bad, &tmp.path().join("t"), &tmp.path().join("c.json"));
        assert!(result.is_err());
    }
}
