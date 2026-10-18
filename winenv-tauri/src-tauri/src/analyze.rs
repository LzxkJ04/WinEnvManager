//! 分析类能力：敏感值 / 引用 / 断裂引用 / 外部变更 / 权限诊断 / 终端对比 / 性能

use serde_json::{json, Value};

pub const SENSITIVE_RULES: &[(&str, &str)] = &[
    ("AWS Access Key", r"\bAKIA[0-9A-Z]{16}\b"),
    ("私钥内容", r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    ("JWT Token", r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b"),
    ("API Key", r"\b(sk|pk|rk|api|token|key)[_-]?[A-Za-z0-9]{24,}\b"),
    ("十六进制密钥", r"\b[a-f0-9]{40,}\b"),
    ("口令类变量", r"(?i)(password|passwd|pwd|secret|token|apikey|api_key|access[_-]?key)"),
    ("连接串口令", r"(?i)(password|pwd)=[^;\s]{4,}"),
];

pub fn detect_sensitive(name: &str, value: &str) -> Vec<&'static str> {
    let text = format!("{}\n{}", name, value);
    SENSITIVE_RULES
        .iter()
        .filter(|(_, re)| regex::Regex::new(re).map(|r| r.is_match(&text)).unwrap_or(false))
        .map(|(label, _)| *label)
        .collect()
}

pub fn mask_value(value: &str) -> String {
    let mut out = value.to_string();
    if let Ok(re) = regex::Regex::new(r"\b([A-Za-z0-9_-]{8})[A-Za-z0-9_-]{16,}([A-Za-z0-9_-]{4})\b") {
        out = re.replace_all(&out, "${1}****${2}").to_string();
    }
    if let Ok(re) = regex::Regex::new(r"(?i)(password|passwd|pwd|secret|token|apikey|api_key|access[_-]?key)([=:]\s*)(\S+)") {
        out = re
            .replace_all(&out, |c: &regex::Captures| format!("{}{}{}", &c[1], &c[2], "*".repeat(c[3].len().min(12))))
            .to_string();
    }
    out
}

pub async fn sensitive_scan() -> Result<Value, String> {
    let data = crate::registry::read_all()?;
    let mut items = Vec::new();
    for scope in ["user", "machine"] {
        if let Some(arr) = data[scope].as_array() {
            for v in arr {
                let name = v["name"].as_str().unwrap_or("");
                let value = v["value"].as_str().unwrap_or("");
                let hits = detect_sensitive(name, value);
                if !hits.is_empty() {
                    items.push(json!({ "scope": scope, "name": name, "value": value, "labels": hits, "masked": mask_value(value) }));
                }
            }
        }
    }
    let total = items.len();
    Ok(json!({ "total": total, "items": items }))
}

pub async fn var_refs(payload: &Value) -> Result<Value, String> {
    let name = payload["name"].as_str().unwrap_or("").to_uppercase();
    if name.is_empty() {
        return Err("缺少变量名".into());
    }
    let data = crate::registry::read_all()?;
    let mut referenced_by = Vec::new();
    let re = regex::Regex::new(&format!("%{}%", regex::escape(&name))).unwrap();
    for scope in ["user", "machine"] {
        if let Some(arr) = data[scope].as_array() {
            for v in arr {
                let n = v["name"].as_str().unwrap_or("");
                let value = v["value"].as_str().unwrap_or("");
                if n.to_uppercase() == name {
                    continue;
                }
                if re.is_match(value) {
                    referenced_by.push(json!({ "scope": scope, "name": n, "value": value, "kind": "variable" }));
                }
            }
        }
    }
    let count = referenced_by.len();
    Ok(json!({ "name": name, "referencedBy": referenced_by, "count": count }))
}

pub async fn broken_refs() -> Result<Value, String> {
    let data = crate::registry::read_all()?;
    let mut known: Vec<String> = Vec::new();
    for scope in ["user", "machine"] {
        if let Some(arr) = data[scope].as_array() {
            for v in arr {
                known.push(v["name"].as_str().unwrap_or("").to_uppercase());
            }
        }
    }
    let items = crate::analyze::BUILTIN_VARS
        .iter()
        .map(|s| s.to_string())
        .chain(known.clone())
        .collect::<Vec<_>>();
    let mut broken = Vec::new();
    for scope in ["user", "machine"] {
        if let Some(arr) = data[scope].as_array() {
            for v in arr {
                let value = v["value"].as_str().unwrap_or("");
                let re = regex::Regex::new(r"%([^%|=\s]+)%").unwrap();
                for cap in re.captures_iter(value) {
                    let n = cap.get(1).map(|m| m.as_str().to_uppercase()).unwrap_or_default();
                    if !items.contains(&n) {
                        broken.push(json!({ "scope": scope, "name": v["name"], "ref": n, "value": value }));
                    }
                }
            }
        }
    }
    let total = broken.len();
    Ok(json!({ "total": total, "items": broken }))
}

pub const BUILTIN_VARS: &[&str] = &[
    "SYSTEMROOT", "SYSTEMDRIVE", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA",
    "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "COMMONPROGRAMFILES", "COMMONPROGRAMFILES(X86)",
    "PUBLIC", "ALLUSERSPROFILE", "TEMP", "TMP", "COMPUTERNAME", "USERNAME", "USERDOMAIN", "OS",
    "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER", "PROCESSOR_LEVEL",
    "PROCESSOR_REVISION", "PATHEXT", "COMSPEC", "WINDIR", "PSMODULEPATH", "DRIVERDATA",
];

pub async fn external_check() -> Result<Value, String> {
    let cfg = crate::store::read_config();
    if cfg["detectExternal"].as_bool() == Some(false) {
        return Ok(json!({ "enabled": false, "changed": false }));
    }
    let fp = crate::ops::env_fingerprint().await?;
    let rec = crate::meta::get_external();
    let changed = !rec["lastHash"].as_str().unwrap_or("").is_empty() && rec["lastHash"].as_str() != Some(fp.as_str());
    crate::meta::set_external(&fp);
    Ok(json!({ "enabled": true, "changed": changed, "fingerprint": fp, "lastAt": rec["lastAt"] }))
}

pub async fn registry_acl() -> Result<Value, String> {
    let admin = crate::registry::is_admin();
    let mut results = Vec::new();
    let user_key = crate::registry::USER_PS_KEY;
    let machine_key = crate::registry::MACHINE_PS_KEY;
    let probe_user = crate::ps::run_powershell(&format!(
        "$v='__wem_probe_'+(Get-Random); New-ItemProperty -LiteralPath '{}' -Name $v -Value '1' -Force | Out-Null; Remove-ItemProperty -LiteralPath '{}' -Name $v; 'ok'",
        user_key, user_key
    ));
    results.push(json!({
        "target": "用户变量 HKCU\\Environment",
        "writable": probe_user.as_deref() == Ok("ok"), "readable": true,
        "message": if probe_user.as_deref() == Ok("ok") { "可读可写" } else { "写入失败" }
    }));
    let probe_machine = if admin {
        crate::ps::run_powershell(&format!(
            "$v='__wem_probe_'+(Get-Random); New-ItemProperty -LiteralPath '{}' -Name $v -Value '1' -Force | Out-Null; Remove-ItemProperty -LiteralPath '{}' -Name $v; 'ok'",
            machine_key, machine_key
        ))
    } else {
        Err("无管理员权限".into())
    };
    results.push(json!({
        "target": "系统变量 HKLM Session Manager\\Environment",
        "writable": probe_machine.as_deref() == Ok("ok"), "readable": true,
        "message": if probe_machine.as_deref() == Ok("ok") { "可读可写" } else { if admin { "写入失败" } else { "可读，无写权限" } }
    }));
    Ok(json!({ "admin": admin, "results": results }))
}

pub async fn terminal_env(payload: &Value) -> Result<Value, String> {
    let shell = payload["shell"].as_str().unwrap_or("cmd");
    let script = if shell == "powershell" {
        "Get-ChildItem Env: | ForEach-Object { \"$($_.Name)=$($_.Value)\" }".to_string()
    } else {
        "set".to_string()
    };
    let raw = crate::ps::run_powershell(&script)?;
    let mut live: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for line in raw.lines() {
        if let Some(idx) = line.find('=') {
            live.insert(line[..idx].to_uppercase(), line[idx + 1..].to_string());
        }
    }
    let data = crate::registry::read_all()?;
    let mut registry_env: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    if let Some(arr) = data["machine"].as_array() {
        for v in arr {
            registry_env.insert(v["name"].as_str().unwrap_or("").to_uppercase(), v["value"].as_str().unwrap_or("").to_string());
        }
    }
    if let Some(arr) = data["user"].as_array() {
        for v in arr {
            let k = v["name"].as_str().unwrap_or("").to_uppercase();
            let raw_v = v["value"].as_str().unwrap_or("").to_string();
            registry_env.insert(k.clone(), if raw_v.contains('%') { crate::ps::expand_win(&raw_v) } else { raw_v });
        }
    }
    let mut only_in_terminal = Vec::new();
    let mut only_in_registry = Vec::new();
    let mut different = Vec::new();
    for (k, v) in &live {
        if k == "PATH" {
            continue;
        }
        match registry_env.get(k) {
            None => only_in_terminal.push(json!({ "name": k, "value": v })),
            Some(r) if r != v => different.push(json!({ "name": k, "terminal": v, "registry": r })),
            _ => {}
        }
    }
    for (k, v) in &registry_env {
        if k != "PATH" && !live.contains_key(k) {
            only_in_registry.push(json!({ "name": k, "value": v }));
        }
    }
    Ok(json!({
        "shell": shell, "total": live.len(),
        "onlyInTerminal": only_in_terminal, "onlyInRegistry": only_in_registry, "different": different
    }))
}

pub async fn path_perf() -> Result<Value, String> {
    let data = crate::registry::read_all()?;
    let mut items = Vec::new();
    let mut total = 0usize;
    let mut total_len = 0usize;
    let mut invalid = 0usize;
    for scope in ["user", "machine"] {
        let hit = data[scope]
            .as_array()
            .and_then(|a| a.iter().find(|v| v["name"].as_str().unwrap_or("").eq_ignore_ascii_case("Path")))
            .map(|v| v["value"].as_str().unwrap_or("").to_string())
            .unwrap_or_default();
        let dirs: Vec<String> = hit.split(';').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
        let chk = crate::registry::check_paths_exist(&dirs);
        let inv = chk.iter().filter(|c| !c["exists"].as_bool().unwrap_or(false)).count();
        let dup = dirs.len() - dirs.iter().map(|d| d.to_lowercase()).collect::<std::collections::HashSet<_>>().len();
        total += dirs.len();
        total_len += hit.len();
        invalid += inv;
        items.push(json!({ "scope": scope, "count": dirs.len(), "length": hit.len(), "invalid": inv, "dup": dup }));
    }
    let mut advice: Vec<String> = Vec::new();
    if total > 40 {
        advice.push(String::from("PATH 条目超过 40 条，终端每次解析可执行文件会明显变慢，建议清理不常用目录。"));
    }
    if total_len > 1800 {
        advice.push(String::from("PATH 总长度接近 2047 字符上限，有被截断风险，请精简。"));
    }
    if invalid > 0 {
        advice.push(format!("存在 {} 条无效目录，会拖慢每次命令查找，建议清理。", invalid));
    }
    if advice.is_empty() {
        advice.push(String::from("当前 PATH 配置良好。"));
    }
    Ok(json!({ "items": items, "total": total, "totalLen": total_len, "invalid": invalid, "advice": advice }))
}

pub async fn storage_stats() -> Result<Value, String> {
    let stat = |d: &std::path::PathBuf| {
        let (size, files) = crate::store::dir_size(d);
        json!({ "dir": d.display().to_string(), "size": size, "files": files })
    };
    Ok(json!({
        "config": stat(&crate::store::app_data_dir()),
        "snapshots": stat(&crate::store::snapshot_dir()),
        "logs": stat(&crate::store::log_dir()),
        "cache": stat(&crate::store::cache_dir()),
        "backups": stat(&crate::store::resolved_backup_dir())
    }))
}
