//! 本机开发软件自动扫描识别引擎

use serde_json::json;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

pub static SCAN_CANCELLED: AtomicBool = AtomicBool::new(false);

pub fn cancel_scan() {
    SCAN_CANCELLED.store(true, Ordering::SeqCst);
}

fn reset_cancel() {
    SCAN_CANCELLED.store(false, Ordering::SeqCst);
}

fn norm_lower(p: &str) -> String {
    p.trim().trim_end_matches(['\\', '/']).to_lowercase()
}

fn dir_exists(p: &str) -> bool {
    Path::new(p).is_dir()
}

const DEFAULT_SCAN_DIRS: &[&str] = &["C:\\dev\\soft", "C:\\Program Files", "C:\\Program Files (x86)", "%LOCALAPPDATA%\\Programs"];
const SKIP_DIRS: &[&str] = &[
    "$recycle.bin", "system volume information", "windows", "appdata", "node_modules", "recovery",
    "perflogs", "internet explorer", "windowsapps", "common files", "windows nt", "wbem", "dotnet",
    "reference assemblies", "microsoft shared", "windows media player", "driverstore",
];

fn walk_dirs(roots: &[String], max_depth: usize, budget: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut queue: Vec<(String, usize)> = roots
        .iter()
        .map(|r| crate::ps::expand_win(r))
        .filter(|r| dir_exists(r))
        .map(|r| (r, 0))
        .collect();
    let mut seen: HashSet<String> = HashSet::new();
    while let Some((dir, depth)) = queue.pop() {
        if SCAN_CANCELLED.load(Ordering::SeqCst) || out.len() > budget {
            break;
        }
        let key = norm_lower(&dir);
        if seen.contains(&key) {
            continue;
        }
        seen.insert(key);
        out.push(dir.clone());
        if depth >= max_depth {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for e in entries.flatten() {
                if e.path().is_dir() {
                    let name = e.file_name().to_string_lossy().to_lowercase();
                    if name.starts_with('.') || SKIP_DIRS.contains(&name.as_str()) {
                        continue;
                    }
                    queue.push((e.path().display().to_string(), depth + 1));
                }
            }
        }
    }
    out
}

fn resolve_install_path(rule: &serde_json::Value, dir: &str) -> String {
    let cfg = &rule["installPathExtract"];
    let mode = cfg["mode"].as_str().unwrap_or("self");
    if mode == "parentNLevel" {
        let mut p = PathBuf::from(dir);
        for _ in 0..cfg["level"].as_i64().unwrap_or(1) {
            match p.parent() {
                Some(parent) if parent != p => p = parent.to_path_buf(),
                _ => break,
            }
        }
        return p.display().to_string();
    }
    dir.to_string()
}

fn extract_version(text: &str, regex: &str) -> String {
    if regex.is_empty() {
        return String::new();
    }
    match regex::Regex::new(regex) {
        Ok(re) => {
            match re.captures(text) {
                Some(c) => c.get(1).map(|m| m.as_str().to_string()).unwrap_or_default(),
                None => String::new(),
            }
        }
        Err(_) => String::new(),
    }
}

fn detect_version(rule: &serde_json::Value, exe_path: &str, install_path: &str) -> String {
    let cmd = rule["versionCmd"].as_str().unwrap_or("");
    if cmd.is_empty() {
        // 读取文件版本信息
        let script = format!(
            "(Get-Item -LiteralPath '{}').VersionInfo.ProductVersion",
            crate::ps::ps_quote(exe_path)
        );
        return crate::ps::run_powershell_lossy(&script).trim().to_string();
    }
    let args: Vec<&str> = cmd.split_whitespace().collect();
    let out = std::process::Command::new(exe_path)
        .args(&args)
        .current_dir(install_path)
        .creation_flags(0x08000000)
        .output();
    if let Ok(o) = out {
        let text = format!(
            "{}\n{}",
            String::from_utf8_lossy(&o.stdout),
            String::from_utf8_lossy(&o.stderr)
        );
        return extract_version(&text, rule["versionRegex"].as_str().unwrap_or(""));
    }
    String::new()
}

pub async fn scan(payload: &serde_json::Value) -> Result<serde_json::Value, String> {
    reset_cancel();
    let deep = payload["deep"].as_bool().unwrap_or(false);
    let cfg = crate::store::read_config();
    let max_depth = if deep { 3 } else { 2 };
    let budget = if deep { 12000 } else { 5000 };

    let data = crate::registry::read_all()?;
    let to_map = |list: &serde_json::Value| {
        let mut m = serde_json::Map::new();
        if let Some(arr) = list.as_array() {
            for v in arr {
                m.insert(v["name"].as_str().unwrap_or("").to_string(), v["value"].clone());
            }
        }
        serde_json::Value::Object(m)
    };
    let current_env = json!({ "user": to_map(&data["user"]), "machine": to_map(&data["machine"]) });

    // 数据源1：注册表卸载项
    let uninstall_script = r#"
$out = New-Object System.Collections.ArrayList
$keys = @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall','HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall')
foreach ($root in $keys) {
  if (-not (Test-Path -LiteralPath $root)) { continue }
  foreach ($sub in (Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue)) {
    $p = Get-ItemProperty -LiteralPath $sub.PSPath -ErrorAction SilentlyContinue
    if ($null -eq $p) { continue }
    $name = [string]$p.DisplayName
    if ([string]::IsNullOrWhiteSpace($name)) { continue }
    [void]$out.Add([pscustomobject]@{ name = $name; version = [string]$p.DisplayVersion; location = [string]$p.InstallLocation; icon = [string]$p.DisplayIcon; uninstall = [string]$p.UninstallString })
  }
}
@($out) | ConvertTo-Json -Depth 4 -Compress
"#;
    let raw = crate::ps::run_powershell(uninstall_script).unwrap_or_default();
    let uninstall_entries = crate::registry::parse_array(&raw, |i| i.clone());

    // 数据源2/3：PATH 目录 + 默认/自定义目录
    let mut roots: Vec<String> = Vec::new();
    for scope in ["user", "machine"] {
        if let Some(arr) = data[scope].as_array() {
            for v in arr {
                if v["name"].as_str().unwrap_or("").eq_ignore_ascii_case("Path") {
                    for p in v["value"].as_str().unwrap_or("").split(';') {
                        let t = p.trim().to_string();
                        if !t.is_empty() {
                            roots.push(t);
                        }
                    }
                }
            }
        }
    }
    for d in DEFAULT_SCAN_DIRS {
        roots.push(d.to_string());
    }
    if let Some(custom) = cfg["scanCustomDirs"].as_array() {
        for d in custom {
            if let Some(s) = d.as_str() {
                roots.push(s.to_string());
            }
        }
    }
    let dirs = walk_dirs(&roots, max_depth, budget);
    if SCAN_CANCELLED.load(Ordering::SeqCst) {
        return Ok(json!({ "scannedAt": chrono::Utc::now().timestamp_millis(), "items": [], "cancelled": true }));
    }

    // 数据源4：HOME 变量
    let mut home_vars: Vec<(String, String)> = Vec::new();
    for scope in ["machine", "user"] {
        if let Some(m) = current_env[scope].as_object() {
            for (k, v) in m {
                if k.ends_with("_HOME") || k.ends_with("_ROOT") || k == "GOROOT" || k == "CARGO_HOME" {
                    let expanded = crate::ps::expand_win(v.as_str().unwrap_or(""));
                    if dir_exists(&expanded) {
                        home_vars.push((k.clone(), expanded));
                    }
                }
            }
        }
    }

    // 匹配
    let all_rules = crate::rules::list_rules()["rules"].as_array().cloned().unwrap_or_default();
    let mut found: Vec<(String, String, String, serde_json::Value)> = Vec::new(); // (ruleId, installPath, sources, extra)
    let mut seen: HashSet<String> = HashSet::new();

    let mut add = |rule_id: &str, path: &str, source: &str, extra: serde_json::Value, exe: &str| {
        if !dir_exists(path) {
            return;
        }
        let key = norm_lower(path);
        if seen.contains(&key) {
            for item in found.iter_mut() {
                if norm_lower(&item.1) == key && !item.2.contains(source) {
                    item.2.push_str(&format!(",{}", source));
                }
            }
            return;
        }
        seen.insert(key);
        found.push((
            rule_id.to_string(),
            path.to_string(),
            source.to_string(),
            json!({ "exePath": exe, "extra": extra }),
        ));
    };

    for rule in &all_rules {
        let rid = rule["id"].as_str().unwrap_or("");
        let exe = rule["executableName"].as_str().unwrap_or("");
        // PATH 目录命中
        for dir in &dirs {
            let direct = format!("{}\\{}", dir, exe);
            let bin = format!("{}\\bin\\{}", dir, exe);
            let hit = if Path::new(&direct).exists() { direct.clone() } else if Path::new(&bin).exists() { bin.clone() } else { String::new() };
            if !hit.is_empty() {
                let ip = resolve_install_path(rule, dir);
                add(rid, &ip, "path-scan", json!({}), &hit);
                break;
            }
        }
        // HOME 变量
        let home_key = rule["envTemplate"]
            .as_array()
            .and_then(|a| a.iter().map(|t| t["varKey"].as_str().unwrap_or("")).find(|k| k.ends_with("_HOME") || k.ends_with("_ROOT") || *k == "GOROOT" || *k == "CARGO_HOME"));
        if let Some(hk) = home_key {
            if let Some((_, hv)) = home_vars.iter().find(|(k, _)| k.eq_ignore_ascii_case(hk)) {
                let ip = resolve_install_path(rule, hv);
                add(rid, &ip, "home-var", json!({}), &format!("{}\\{}", hv, exe));
            }
        }
    }

    // 目录名匹配（限制数量避免过慢）
    for dir in dirs.iter().take(3000) {
        if SCAN_CANCELLED.load(Ordering::SeqCst) {
            break;
        }
        let dname = Path::new(dir).file_name().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
        for rule in &all_rules {
            let exe = rule["executableName"].as_str().unwrap_or("");
            let direct = format!("{}\\{}", dir, exe);
            if !Path::new(&direct).exists() {
                continue;
            }
            let mut hay: Vec<String> = vec![rule["name"].as_str().unwrap_or("").to_lowercase()];
            hay.extend(rule["alias"].as_array().map(|a| a.iter().filter_map(|x| x.as_str()).map(|s| s.to_lowercase()).collect::<Vec<_>>()).unwrap_or_default());
            if hay.iter().any(|h| h.len() > 2 && dname.contains(h.as_str())) {
                let ip = resolve_install_path(rule, dir);
                add(rule["id"].as_str().unwrap_or(""), &ip, "dir-scan", json!({}), &direct);
            }
        }
    }

    // 注册表卸载项匹配
    for entry in &uninstall_entries {
        let name = entry["name"].as_str().unwrap_or("").to_lowercase();
        let hit = all_rules.iter().find(|r| {
            let mut hay: Vec<String> = vec![r["name"].as_str().unwrap_or("").to_lowercase()];
            hay.extend(r["alias"].as_array().map(|a| a.iter().filter_map(|x| x.as_str()).map(|s| s.to_lowercase()).collect::<Vec<_>>()).unwrap_or_default());
            hay.iter().any(|h| h.len() > 2 && name.contains(h.as_str()))
        });
        if let Some(rule) = hit {
            let mut loc = entry["location"].as_str().unwrap_or("").to_string();
            if !dir_exists(&loc) {
                let icon = entry["icon"].as_str().unwrap_or("");
                if let Some(p) = Path::new(icon.trim_matches('"')).parent() {
                    loc = p.display().to_string();
                }
            }
            if dir_exists(&loc) {
                let ip = resolve_install_path(rule, &loc);
                add(
                    rule["id"].as_str().unwrap_or(""),
                    &ip,
                    "registry",
                    json!({ "version": entry["version"], "uninstall": entry["uninstall"], "displayName": entry["name"] }),
                    &format!("{}\\{}", loc, rule["executableName"].as_str().unwrap_or("")),
                );
            }
        }
    }

    // 组装结果
    let mut items = Vec::new();
    for (rid, install_path, sources, extra) in &found {
        let rule = match crate::rules::get_rule(rid) {
            Some(r) => r,
            None => continue,
        };
        let exe_path = extra["exePath"].as_str().unwrap_or("").to_string();
        let exe = if Path::new(&exe_path).exists() {
            exe_path.clone()
        } else {
            let c = format!("{}\\{}", install_path, rule["executableName"].as_str().unwrap_or(""));
            if Path::new(&c).exists() { c } else { String::new() }
        };
        let mut version = extra["extra"]["version"].as_str().unwrap_or("").to_string();
        if version.is_empty() && !exe.is_empty() {
            version = detect_version(&rule, &exe, install_path);
        }
        let plan = crate::rules::build_var_plan(&rule, install_path, &current_env);
        let managed = !plan.is_empty() && plan.iter().all(|p| p["op"] == "same");
        items.push(json!({
            "id": format!("{}::{}", rid, norm_lower(install_path)),
            "ruleId": rid,
            "name": rule["name"],
            "category": rule["category"],
            "version": version,
            "installPath": install_path,
            "exePath": exe,
            "sources": sources.split(',').collect::<Vec<_>>(),
            "managed": managed,
            "ignored": false,
            "uninstall": extra["extra"]["uninstall"],
            "variables": plan
        }));
    }

    let ignore = cfg["scanIgnoreList"].as_array().cloned().unwrap_or_default();
    for item in items.iter_mut() {
        let key = item["id"].as_str().unwrap_or("");
        item["ignored"] = json!(ignore.iter().any(|x| x.as_str() == Some(key)));
    }

    crate::store::write_config(&json!({ "lastScanAt": chrono::Utc::now().timestamp_millis() }));
    crate::store::write_log("info", &format!("本机环境扫描完成，发现 {} 项", items.len()), None);

    Ok(json!({
        "scannedAt": chrono::Utc::now().timestamp_millis(),
        "deep": deep,
        "totalDirs": dirs.len(),
        "registryEntries": uninstall_entries.len(),
        "items": items,
        "cancelled": SCAN_CANCELLED.load(Ordering::SeqCst)
    }))
}

pub fn validate_item(item: &serde_json::Value) -> Result<serde_json::Value, String> {
    let rule = crate::rules::get_rule(item["ruleId"].as_str().unwrap_or("")).ok_or("识别规则不存在")?;
    let exe = item["exePath"].as_str().unwrap_or("");
    if exe.is_empty() || !Path::new(exe).exists() {
        return Err("未找到可执行文件".into());
    }
    let cmd = rule["versionCmd"].as_str().unwrap_or("");
    let version = detect_version(&rule, exe, item["installPath"].as_str().unwrap_or(""));
    Ok(json!({
        "ok": !version.is_empty(), "version": version, "exePath": exe,
        "cmd": if cmd.is_empty() { exe.to_string() } else { format!("{} {}", exe, cmd) }
    }))
}

/// 供部署模块复用的版本检测
pub fn detect_version_pub(rule: &serde_json::Value, exe_path: &str, install_path: &str) -> String {
    detect_version(rule, exe_path, install_path)
}
