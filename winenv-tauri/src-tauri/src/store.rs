//! 本地数据存储：配置 / 元数据 / 快照 / 备份 / 日志

use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};

/// 从 HKLM\SOFTWARE\WinEnvManager 读取安装包写入的 UserDataRoot（用户数据目录）。
/// 读取走 PowerShell -EncodedCommand + UTF-8 输出，规避中文路径乱码。
fn registry_userdata_root() -> Option<PathBuf> {
    let script = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; \
$v=(Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\WinEnvManager' -ErrorAction SilentlyContinue).UserDataRoot; \
if ($v) { Write-Output $v }";
    let encoded: String = script
        .encode_utf16()
        .flat_map(|u| u.to_le_bytes())
        .map(|b| format!("{:02X}", b))
        .collect();
    let out = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-EncodedCommand", &encoded])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() || Path::new(&s).is_file() {
        return None;
    }
    Some(PathBuf::from(s))
}

/// 应用数据根目录：优先安装包注册表中的 UserDataRoot，回退 %APPDATA%\win-env-manager
pub fn app_data_dir() -> PathBuf {
    if let Some(dir) = registry_userdata_root() {
        return dir;
    }
    let base = std::env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| dirs::data_dir().unwrap_or_else(std::env::temp_dir));
    base.join("win-env-manager")
}

pub fn ensure_dir(p: &Path) -> PathBuf {
    let _ = std::fs::create_dir_all(p);
    p.to_path_buf()
}

pub fn ensure_all_dirs() {
    ensure_dir(&app_data_dir());
    ensure_dir(&snapshot_dir());
    ensure_dir(&log_dir());
    ensure_dir(&cache_dir());
    ensure_dir(&resolved_backup_dir());
}

pub fn snapshot_dir() -> PathBuf {
    ensure_dir(&app_data_dir().join("snapshots"))
}

pub fn log_dir() -> PathBuf {
    ensure_dir(&app_data_dir().join("logs"))
}

pub fn cache_dir() -> PathBuf {
    ensure_dir(&app_data_dir().join("cache"))
}

pub fn default_backup_dir() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(std::env::temp_dir);
    ensure_dir(&home.join("Documents").join("EnvBackup"))
}

pub fn resolved_backup_dir() -> PathBuf {
    let cfg = read_config();
    let custom = cfg["backupDir"].as_str().unwrap_or("").trim().to_string();
    if custom.is_empty() {
        default_backup_dir()
    } else {
        ensure_dir(&PathBuf::from(&custom))
    }
}

pub fn resolved_dev_root() -> PathBuf {
    let cfg = read_config();
    let custom = cfg["devRoot"].as_str().unwrap_or("").trim().to_string();
    let dir = if custom.is_empty() { PathBuf::from("C:\\dev\\soft") } else { PathBuf::from(custom) };
    ensure_dir(&dir)
}

pub fn config_file() -> PathBuf {
    app_data_dir().join("config.json")
}

pub const DEFAULT_CONFIG_JSON: &str = r##"{
  "theme": "light", "primaryColor": "#165DFF", "language": "zh-CN", "pageSize": 20,
  "rowHeight": "middle", "fontSize": 13,
  "loadOnStart": true, "startMinimized": false, "autoLaunch": false,
  "autoSnapshot": true, "autoBackup": true, "autoBackupFormat": "json",
  "backupDir": "", "logEnabled": true, "trayAction": "minimize",
  "confirmBeforeSave": true, "undoMaxSteps": 50, "saveValidatePath": true,
  "detectExternal": true, "draftAutoSave": true, "autoRestartExplorerAfterSave": false,
  "keepDraftOnExit": true,
  "devRoot": "C:\\dev\\soft", "cacheDir": "", "cacheMaxMB": 2048,
  "downloadSource": "mirror", "mirrorNode": "", "mirrorPython": "", "mirrorGo": "",
  "mirrorJdk": "", "mirrorMaven": "", "mirrorGradle": "", "mirrorGithub": "",
  "maxConcurrentDownloads": 2, "deployVerifyVersion": true, "multiVersionMode": "coexist",
  "dbRegisterService": false, "taskDepends": true, "verifyHash": true,
  "scanOnStart": true, "scanOnEnterPage": true, "deepScan": false,
  "scanCustomDirs": [], "scanExcludeDirs": [], "scanExcludeNames": [],
  "auditIntervalHours": 0, "scanTimeoutSec": 90, "lastScanAt": 0,
  "backupSchedule": "off", "backupKeep": 20, "snapshotMax": 50, "backupPassword": "",
  "logKeepDays": 30, "taskLogKeepDays": 30, "logMaxSizeMB": 10, "logLevel": "info",
  "confirmDanger": true, "lockProtect": true, "avWarning": true,
  "detectSensitive": true, "desensitizeExport": false,
  "updateChannel": "stable", "updateUrl": "",
  "disabledPathUser": [], "disabledPathMachine": [], "scanIgnoreList": [],
  "baselineSnapshotId": "", "windowBounds": null
}"##;

pub fn read_config() -> serde_json::Value {
    let f = config_file();
    let defaults: serde_json::Value =
        serde_json::from_str(DEFAULT_CONFIG_JSON).unwrap_or(serde_json::json!({}));
    let mut out = defaults;
    if let Ok(text) = std::fs::read_to_string(&f) {
        if let Ok(user) = serde_json::from_str::<serde_json::Value>(&text) {
            if let (Some(a), Some(b)) = (out.as_object_mut(), user.as_object()) {
                for (k, v) in b {
                    a.insert(k.clone(), v.clone());
                }
            }
        }
    }
    out
}

pub fn write_config(patch: &serde_json::Value) -> serde_json::Value {
    ensure_dir(&app_data_dir());
    let mut cfg = read_config();
    if let (Some(a), Some(b)) = (cfg.as_object_mut(), patch.as_object()) {
        for (k, v) in b {
            a.insert(k.clone(), v.clone());
        }
    }
    let _ = std::fs::write(&config_file(), serde_json::to_string_pretty(&cfg).unwrap_or_default());
    cfg
}

pub fn write_log(level: &str, message: &str, detail: Option<serde_json::Value>) {
    let cfg = read_config();
    if cfg["logEnabled"].as_bool() == Some(false) {
        return;
    }
    let dir = log_dir();
    let now = chrono::Local::now();
    let file = dir.join(format!("{}.log", now.format("%Y-%m-%d")));
    let line = format!(
        "[{}] [{}] {}{}\n",
        now.format("%Y-%m-%d %H:%M:%S"),
        level.to_uppercase(),
        message,
        detail.map(|d| format!(" :: {}", d)).unwrap_or_default()
    );
    let _ = std::fs::OpenOptions::new().create(true).append(true).open(file).and_then(|mut f| std::io::Write::write_all(&mut f, line.as_bytes()));
}

pub fn read_json_file(path: &PathBuf, fallback: serde_json::Value) -> serde_json::Value {
    match std::fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or(fallback),
        Err(_) => fallback,
    }
}

pub fn write_json_file(path: &PathBuf, value: &serde_json::Value) -> Result<(), String> {
    let fallback = app_data_dir();
    ensure_dir(path.parent().map(|p| p.to_path_buf()).unwrap_or(fallback).as_path());
    std::fs::write(path, serde_json::to_string_pretty(value).unwrap_or_default())
        .map_err(|e| format!("写入文件失败：{}", e))
}

pub fn dir_size(dir: &PathBuf) -> (u64, u64) {
    let mut size = 0u64;
    let mut files = 0u64;
    fn walk(d: &PathBuf, size: &mut u64, files: &mut u64) {
        if let Ok(entries) = std::fs::read_dir(d) {
            for e in entries.flatten() {
                let p = e.path();
                if p.is_dir() {
                    walk(&p, size, files);
                } else if let Ok(meta) = e.metadata() {
                    *size += meta.len();
                    *files += 1;
                }
            }
        }
    }
    if dir.exists() {
        walk(dir, &mut size, &mut files);
    }
    (size, files)
}

/// 人类可读的文件大小
pub fn fmt_size(n: u64) -> String {
    if n < 1024 {
        format!("{} B", n)
    } else if n < 1024 * 1024 {
        format!("{:.1} KB", n as f64 / 1024.0)
    } else if n < 1024 * 1024 * 1024 {
        format!("{:.2} MB", n as f64 / 1048576.0)
    } else {
        format!("{:.2} GB", n as f64 / 1073741824.0)
    }
}
