//! 快照 / 备份 / 差异对比 / 加密 / 校验

use base64::Engine as _;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

pub fn file_stamp() -> String {
    chrono::Local::now().format("%Y%m%d-%H%M%S").to_string()
}

pub fn ts_text() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

pub fn sha256_hex(data: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(data);
    hex(&h.finalize())
}

pub fn md5_hex(data: &[u8]) -> String {
    use md5::Digest as Md5Digest;
    let mut h = md5::Md5::new();
    h.update(data);
    hex(&h.finalize())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/* ------------------------------ 加密 ------------------------------ */

const ENC_HEADER: &str = "WEMENC1:";

pub fn encrypt_text(text: &str, password: &str) -> Result<String, String> {
    use aes_gcm::aead::{Aead, KeyInit, Payload};
    use aes_gcm::{Aes256Gcm, Key, Nonce};
    if password.is_empty() {
        return Err("未提供加密密码".into());
    }
    let salt: [u8; 16] = rand_bytes16();
    let nonce: [u8; 12] = {
        let b = rand_bytes16();
        let mut n = [0u8; 12];
        n.copy_from_slice(&b[..12]);
        n
    };
    let key = scrypt_key(password, &salt);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let payload = Payload { msg: text.as_bytes(), aad: &salt };
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce), payload)
        .map_err(|e| format!("加密失败：{}", e))?;
    let mut blob = Vec::new();
    blob.extend_from_slice(&salt);
    blob.extend_from_slice(&nonce);
    blob.extend_from_slice(&ct);
    Ok(format!("{}{}", ENC_HEADER, base64::engine::general_purpose::STANDARD.encode(blob)))
}

pub fn decrypt_text(blob: &str, password: &str) -> Result<String, String> {
    let s = blob.trim();
    if !s.starts_with(ENC_HEADER) {
        return Ok(s.to_string());
    }
    if password.is_empty() {
        return Err("该文件已加密，请输入密码".into());
    }
    use aes_gcm::aead::{Aead, KeyInit, Payload};
    use aes_gcm::{Aes256Gcm, Key, Nonce};
    let raw = base64::engine::general_purpose::STANDARD
        .decode(&s[ENC_HEADER.len()..])
        .map_err(|e| format!("解密失败：{}", e))?;
    if raw.len() < 44 {
        return Err("加密数据已损坏".into());
    }
    let salt = &raw[..16];
    let nonce = &raw[16..28];
    let ct = &raw[28..];
    let key = scrypt_key(password, salt);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let pt = cipher
        .decrypt(Nonce::from_slice(nonce), Payload { msg: ct, aad: salt })
        .map_err(|_| "解密失败：密码错误或文件已损坏".to_string())?;
    String::from_utf8(pt).map_err(|e| format!("解密失败：{}", e))
}

pub fn is_encrypted(text: &str) -> bool {
    text.trim_start().starts_with(ENC_HEADER)
}

fn scrypt_key(password: &str, salt: &[u8]) -> [u8; 32] {
    use scrypt::{scrypt, Params};
    let mut out = [0u8; 32];
    let params = Params::new(14, 8, 1, 32).unwrap();
    let _ = scrypt(password.as_bytes(), salt, &params, &mut out);
    out
}

fn rand_bytes16() -> [u8; 16] {
    let id = uuid::Uuid::new_v4();
    let b = id.as_bytes();
    let mut out = [0u8; 16];
    out.copy_from_slice(b);
    out
}

/* ------------------------------ 环境抓取 ------------------------------ */

pub async fn capture_env_detailed() -> Result<serde_json::Value, String> {
    let data = crate::registry::read_all()?;
    let map = |list: &serde_json::Value, scope: &str| -> Vec<serde_json::Value> {
        list.as_array()
            .map(|a| {
                a.iter()
                    .map(|v| {
                        let name = v["name"].as_str().unwrap_or("");
                        let m = crate::meta::all()["vars"]
                            .get(&format!("{}::{}", scope, name.to_uppercase()))
                            .cloned()
                            .unwrap_or(serde_json::json!({}));
                        serde_json::json!({
                            "key": name,
                            "value": v["value"],
                            "remark": m["remark"].as_str().unwrap_or(""),
                            "locked": m["locked"].as_bool().unwrap_or(false),
                            "source": m["source"].as_str().unwrap_or("system-native")
                        })
                    })
                    .collect()
            })
            .unwrap_or_default()
    };
    let user_env = map(&data["user"], "user");
    let system_env = map(&data["machine"], "machine");
    let pathext = user_env
        .iter()
        .chain(system_env.iter())
        .find(|v| v["key"].as_str().unwrap_or("").to_uppercase() == "PATHEXT")
        .map(|v| v["value"].clone())
        .unwrap_or(serde_json::json!(""));

    Ok(serde_json::json!({
        "userEnv": user_env,
        "systemEnv": system_env,
        "pathext": { "value": pathext, "locked": false }
    }))
}

fn to_maps(detailed: &serde_json::Value) -> serde_json::Value {
    let build = |list: &serde_json::Value| {
        let mut m = serde_json::Map::new();
        if let Some(arr) = list.as_array() {
            for v in arr {
                m.insert(v["key"].as_str().unwrap_or("").to_string(), v["value"].clone());
            }
        }
        serde_json::Value::Object(m)
    };
    serde_json::json!({
        "user": build(&detailed["userEnv"]),
        "machine": build(&detailed["systemEnv"])
    })
}

/* ------------------------------ 快照 ------------------------------ */

pub async fn create_snapshot(payload: &serde_json::Value) -> Result<serde_json::Value, String> {
    let detailed = capture_env_detailed().await?;
    let maps = to_maps(&detailed);
    let id = format!("{}-{}", file_stamp(), &uuid::Uuid::new_v4().to_string()[..4]);
    let name = payload["name"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("快照 {}", ts_text()));

    let snap = serde_json::json!({
        "kind": "win-env-manager-snapshot",
        "version": 2,
        "id": id,
        "meta": {
            "snapshotId": id, "name": name, "comment": payload["note"].as_str().unwrap_or(""),
            "createTime": ts_text(), "version": "WinEnv管家 v2.0",
            "isAutoSnapshot": payload["auto"].as_bool().unwrap_or(false),
            "systemVersion": format!("{} {}", std::env::consts::OS, std::env::consts::ARCH)
        },
        "name": name, "note": payload["note"].as_str().unwrap_or(""),
        "auto": payload["auto"].as_bool().unwrap_or(false),
        "createdAt": chrono::Utc::now().timestamp_millis(),
        "createdAtText": ts_text(),
        "host": hostname(),
        "user": maps["user"], "machine": maps["machine"],
        "userEnv": detailed["userEnv"], "systemEnv": detailed["systemEnv"],
        "pathext": detailed["pathext"],
        "counts": { "user": detailed["userEnv"].as_array().map(|a| a.len()).unwrap_or(0),
                    "machine": detailed["systemEnv"].as_array().map(|a| a.len()).unwrap_or(0) }
    });

    let file = crate::store::snapshot_dir().join(format!("{}.json", id));
    std::fs::write(&file, serde_json::to_string_pretty(&snap).unwrap_or_default())
        .map_err(|e| format!("写入快照失败：{}", e))?;
    crate::store::write_log("info", &format!("创建快照「{}」", name), Some(serde_json::json!(file.display().to_string())));
    Ok(snap)
}

fn hostname() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_else(|_| "PC".into())
}

pub fn list_snapshots() -> Vec<serde_json::Value> {
    let dir = crate::store::snapshot_dir();
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            let p = e.path();
            if p.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            if let Ok(text) = std::fs::read_to_string(&p) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                    out.push(serde_json::json!({
                        "id": v["id"].as_str().or_else(|| v["meta"]["snapshotId"].as_str()).unwrap_or(""),
                        "name": v["name"].as_str().or_else(|| v["meta"]["name"].as_str()).unwrap_or("快照"),
                        "note": v["note"].as_str().or_else(|| v["meta"]["comment"].as_str()).unwrap_or(""),
                        "auto": v["auto"].as_bool().or_else(|| v["meta"]["isAutoSnapshot"].as_bool()).unwrap_or(false),
                        "createdAt": v["createdAt"].as_i64().unwrap_or(0),
                        "createdAtText": v["createdAtText"].as_str().or_else(|| v["meta"]["createTime"].as_str()).unwrap_or(""),
                        "counts": v["counts"].clone(),
                        "file": p.display().to_string(),
                        "size": p.metadata().map(|m| m.len()).unwrap_or(0)
                    }));
                }
            }
        }
    }
    out.sort_by(|a, b| b["createdAt"].as_i64().cmp(&a["createdAt"].as_i64()));
    out
}

pub fn read_snapshot(id: &str) -> Result<serde_json::Value, String> {
    let file = snapshot_file(id)?;
    let text = std::fs::read_to_string(&file).map_err(|e| format!("读取快照失败：{}", e))?;
    let mut v: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("解析快照失败：{}", e))?;
    if v["userEnv"].is_null() {
        v["userEnv"] = serde_json::Value::Array(
            v["user"].as_object().map(|m| {
                m.iter().map(|(k, val)| serde_json::json!({"key": k, "value": val, "remark": "", "locked": false, "source": "system-native"})).collect()
            }).unwrap_or_default()
        );
    }
    if v["systemEnv"].is_null() {
        v["systemEnv"] = serde_json::Value::Array(
            v["machine"].as_object().map(|m| {
                m.iter().map(|(k, val)| serde_json::json!({"key": k, "value": val, "remark": "", "locked": false, "source": "system-native"})).collect()
            }).unwrap_or_default()
        );
    }
    if v["pathext"].is_null() {
        v["pathext"] = serde_json::json!({ "value": "", "locked": false });
    }
    Ok(v)
}

fn snapshot_file(id: &str) -> Result<PathBuf, String> {
    let p = crate::store::snapshot_dir().join(format!("{}.json", id));
    if !p.exists() {
        return Err("快照文件不存在或已被删除".into());
    }
    Ok(p)
}

pub fn delete_snapshot(id: &str) -> Result<(), String> {
    let p = snapshot_file(id)?;
    std::fs::remove_file(&p).map_err(|e| format!("删除失败：{}", e))
}

pub fn prune_snapshots(max: i64) -> usize {
    let limit = if max <= 0 { 0 } else { max as usize };
    if limit == 0 {
        return 0;
    }
    let list = list_snapshots();
    if list.len() <= limit {
        return 0;
    }
    let mut n = 0;
    for s in list.iter().skip(limit) {
        if let Some(f) = s["file"].as_str() {
            if std::fs::remove_file(Path::new(f)).is_ok() {
                n += 1;
            }
        }
    }
    n
}

/* ------------------------------ 差异对比 ------------------------------ */

fn diff_maps(a: &serde_json::Value, b: &serde_json::Value) -> serde_json::Value {
    let am = a.as_object().cloned().unwrap_or_default();
    let bm = b.as_object().cloned().unwrap_or_default();
    let mut added = Vec::new();
    let mut removed = Vec::new();
    let mut changed = Vec::new();
    for (k, v) in &bm {
        if !am.contains_key(k) {
            added.push(serde_json::json!({ "name": k, "to": v }));
        }
    }
    for (k, v) in &am {
        if !bm.contains_key(k) {
            removed.push(serde_json::json!({ "name": k, "from": v }));
        }
    }
    for (k, bv) in &bm {
        if let Some(av) = am.get(k) {
            if av != bv {
                changed.push(serde_json::json!({ "name": k, "from": av, "to": bv }));
            }
        }
    }
    serde_json::json!({ "added": added, "removed": removed, "changed": changed })
}

pub async fn compare_env(payload: &serde_json::Value) -> Result<serde_json::Value, String> {
    let mut left = serde_json::json!({ "user": {}, "machine": {} });
    let mut left_label = payload["leftLabel"].as_str().unwrap_or("快照").to_string();
    let right_label = payload["rightLabel"].as_str().unwrap_or("当前环境").to_string();

    if let Some(id) = payload["snapshotId"].as_str() {
        let snap = read_snapshot(id)?;
        left = serde_json::json!({ "user": snap["user"], "machine": snap["machine"] });
        left_label = snap["name"].as_str().unwrap_or("快照").to_string();
    } else if let (Some(lid), Some(rid)) = (payload["leftId"].as_str(), payload["rightId"].as_str()) {
        let a = read_snapshot(lid)?;
        let b = read_snapshot(rid)?;
        let user = diff_maps(&a["user"], &b["user"]);
        let machine = diff_maps(&a["machine"], &b["machine"]);
        let summary = summarize(&user, &machine);
        return Ok(serde_json::json!({
            "user": user, "machine": machine, "summary": summary,
            "leftLabel": a["name"].as_str().unwrap_or("快照A"),
            "rightLabel": b["name"].as_str().unwrap_or("快照B")
        }));
    } else {
        // left = 当前环境
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
        left = serde_json::json!({ "user": to_map(&data["user"]), "machine": to_map(&data["machine"]) });
        left_label = "当前环境".into();
        let _ = &mut left_label;
    }

    let detailed = capture_env_detailed().await?;
    let right = to_maps(&detailed);
    let user = diff_maps(&left["user"], &right["user"]);
    let machine = diff_maps(&left["machine"], &right["machine"]);
    let summary = summarize(&user, &machine);
    Ok(serde_json::json!({
        "user": user, "machine": machine, "summary": summary,
        "leftLabel": left_label, "rightLabel": right_label
    }))
}

fn summarize(user: &serde_json::Value, machine: &serde_json::Value) -> serde_json::Value {
    let count = |v: &serde_json::Value, k: &str| v[k].as_array().map(|a| a.len()).unwrap_or(0);
    let (a, r, c) = (count(user, "added") + count(machine, "added"), count(user, "removed") + count(machine, "removed"), count(user, "changed") + count(machine, "changed"));
    serde_json::json!({ "added": a, "removed": r, "changed": c, "total": a + r + c })
}

/// 计算回滚计划（当前环境 -> 快照）
pub async fn prepare_restore(snapshot_id: &str) -> Result<Vec<serde_json::Value>, String> {
    let snap = read_snapshot(snapshot_id)?;
    let detailed = capture_env_detailed().await?;
    let current = to_maps(&detailed);
    let mut plan = Vec::new();
    for scope in ["user", "machine"] {
        let target = &snap[scope];
        let cur = &current[scope];
        if let (Some(t), Some(c)) = (target.as_object(), cur.as_object()) {
            for (k, v) in t {
                if c.get(k) != Some(v) {
                    plan.push(serde_json::json!({
                        "action": if c.contains_key(k) { "update" } else { "create" },
                        "scope": scope, "name": k, "value": v
                    }));
                }
            }
            for k in c.keys() {
                if !t.contains_key(k) {
                    plan.push(serde_json::json!({ "action": "delete", "scope": scope, "name": k }));
                }
            }
        }
    }
    Ok(plan)
}

/* ------------------------------ 备份 ------------------------------ */

pub fn list_backup_files() -> Vec<serde_json::Value> {
    let dir = crate::store::resolved_backup_dir();
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            let p = e.path();
            let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
            if !["reg", "json", "txt"].contains(&ext.as_str()) {
                continue;
            }
            let meta = e.metadata().ok();
            out.push(serde_json::json!({
                "file": p.display().to_string(),
                "name": p.file_name().and_then(|s| s.to_str()).unwrap_or(""),
                "format": ext,
                "size": meta.as_ref().map(|m| m.len()).unwrap_or(0),
                "mtime": meta.as_ref().and_then(|m| m.modified().ok()).map(|t| {
                    t.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
                }).unwrap_or(0)
            }));
        }
    }
    out.sort_by(|a, b| b["mtime"].as_i64().cmp(&a["mtime"].as_i64()));
    out
}

pub async fn create_backup(payload: &serde_json::Value) -> Result<serde_json::Value, String> {
    let format = payload["format"].as_str().unwrap_or("json");

    // .reg / .txt 走 PowerShell 导出
    if format == "reg" || format == "txt" {
        let dir = crate::store::resolved_backup_dir();
        let target = payload["targetPath"].as_str().map(PathBuf::from).unwrap_or_else(|| {
            dir.join(format!("{}-{}.{}", payload["prefix"].as_str().unwrap_or("Backup"), file_stamp(), format))
        });
        let file = target.display().to_string();
        let script = if format == "reg" {
            format!(
                "reg export \"HKCU\\Environment\" \"{}\" /y; reg export \"HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment\" \"{}\" /y",
                file, file
            )
        } else {
            format!(
                "$u = [ordered]@{{}}; $m = [ordered]@{{}}; \
                 $ku = Get-Item -LiteralPath '{}'; $km = Get-Item -LiteralPath '{}'; \
                 foreach($n in $ku.GetValueNames()){{ $u[$n] = [string]$ku.GetValue($n,'','DoNotExpandEnvironmentNames') }}; \
                 foreach($n in $km.GetValueNames()){{ $m[$n] = [string]$km.GetValue($n,'','DoNotExpandEnvironmentNames') }}; \
                 $lines = @('# WinEnvManager 环境变量导出', \"# 时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')\", '', '[用户变量]'); \
                 foreach($k in $u.Keys){{ $lines += \"`$k=`$($u[`$k])\" }}; \
                 $lines += ''; $lines += '[系统变量]'; \
                 foreach($k in $m.Keys){{ $lines += \"`$k=`$($m[`$k])\" }}; \
                 [System.IO.File]::WriteAllLines('{}', $lines)",
                crate::ps::ps_quote(crate::registry::USER_PS_KEY),
                crate::ps::ps_quote(crate::registry::MACHINE_PS_KEY),
                file
            )
        };
        crate::ps::run_powershell(&script)?;
        let size = std::fs::metadata(&target).map(|m| m.len()).unwrap_or(0);
        return Ok(serde_json::json!({ "file": file, "format": format, "size": size, "type": "full" }));
    }

    // json 备份
    let current = capture_env_detailed().await?;
    let backup_type = payload["backupType"].as_str().unwrap_or("full");
    let mut user_vars = current["userEnv"].clone();
    let mut system_vars = current["systemEnv"].clone();
    let mut base_name = String::new();

    if backup_type == "increment" {
        let files = list_backup_files();
        if let Some(latest) = files.iter().find(|f| f["format"] == "json") {
            if let Some(lfile) = latest["file"].as_str() {
                let text = std::fs::read_to_string(lfile).unwrap_or_default();
                let base_text = if is_encrypted(&text) {
                    decrypt_text(&text, payload["password"].as_str().unwrap_or(""))?
                } else {
                    text
                };
                let base: serde_json::Value = serde_json::from_str(&base_text).unwrap_or(serde_json::json!({}));
                base_name = Path::new(lfile).file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
                let filter = |list: &serde_json::Value, base_list: &serde_json::Value| -> serde_json::Value {
                    let base_map: std::collections::HashMap<String, String> = base_list
                        .as_array()
                        .map(|a| a.iter().map(|v| (v["key"].as_str().unwrap_or("").to_string(), v["value"].as_str().unwrap_or("").to_string())).collect())
                        .unwrap_or_default();
                    serde_json::Value::Array(
                        list.as_array().map(|a| a.iter().filter(|v| base_map.get(v["key"].as_str().unwrap_or("")).map(String::as_str) != Some(v["value"].as_str().unwrap_or(""))).cloned().collect()).unwrap_or_default()
                    )
                };
                user_vars = filter(&current["userEnv"], &base["envData"]["userVariables"]);
                system_vars = filter(&current["systemEnv"], &base["envData"]["systemVariables"]);
                if user_vars.as_array().map(|a| a.is_empty()).unwrap_or(true)
                    && system_vars.as_array().map(|a| a.is_empty()).unwrap_or(true)
                {
                    return Ok(serde_json::json!({ "file": lfile, "format": "json", "size": latest["size"], "empty": true }));
                }
            }
        }
    }

    let mut body = serde_json::json!({
        "kind": "win-env-manager-backup",
        "backupMeta": {
            "backupId": uuid::Uuid::new_v4().to_string(),
            "backupName": payload["backupName"].as_str().unwrap_or(""),
            "comment": payload["comment"].as_str().unwrap_or(""),
            "backupType": backup_type,
            "createTime": ts_text(),
            "encrypt": false, "checksum": "", "softwareVersion": "WinEnv管家 v2.0"
        },
        "envData": { "userVariables": user_vars, "systemVariables": system_vars, "pathext": current["pathext"] },
        "baseBackup": base_name,
        "extra": { "configSetList": [], "scanIgnoreList": crate::store::read_config()["scanIgnoreList"] }
    });
    let checksum = md5_hex(serde_json::to_string(&body["envData"]).unwrap_or_default().as_bytes());
    body["backupMeta"]["checksum"] = serde_json::json!(checksum);

    let dir = crate::store::resolved_backup_dir();
    let target = payload["targetPath"]
        .as_str()
        .map(PathBuf::from)
        .unwrap_or_else(|| dir.join(format!("{}-{}.json", payload["prefix"].as_str().unwrap_or("Backup"), file_stamp())));
    let text = serde_json::to_string_pretty(&body).unwrap_or_default();
    let out = if let Some(pwd) = payload["password"].as_str().filter(|p| !p.is_empty()) {
        body["backupMeta"]["encrypt"] = serde_json::json!(true);
        encrypt_text(&serde_json::to_string_pretty(&body).unwrap_or_default(), pwd)?
    } else {
        text
    };
    std::fs::write(&target, out).map_err(|e| format!("写入备份失败：{}", e))?;
    crate::store::write_log("info", "导出备份（JSON）", Some(serde_json::json!(target.display().to_string())));
    let size = std::fs::metadata(&target).map(|m| m.len()).unwrap_or(0);
    Ok(serde_json::json!({ "file": target.display().to_string(), "format": "json", "size": size, "type": backup_type }))
}

pub fn read_backup_any(file: &str, password: &str) -> Result<serde_json::Value, String> {
    let path = Path::new(file);
    if !path.exists() {
        return Err("备份文件不存在".into());
    }
    let buf = std::fs::read(path).map_err(|e| format!("读取失败：{}", e))?;
    let text = if buf.len() > 1 && buf[0] == 0xFF && buf[1] == 0xFE {
        let utf16: Vec<u16> = buf[2..].chunks(2).filter(|c| c.len() == 2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        String::from_utf16_lossy(&utf16)
    } else {
        String::from_utf8_lossy(&buf).to_string()
    };
    let plain = decrypt_text(&text, password)?;
    let obj: serde_json::Value = serde_json::from_str(&plain).map_err(|e| format!("解析备份失败：{}", e))?;
    let mut entries = Vec::new();
    if let Some(list) = obj["envData"]["userVariables"].as_array() {
        for v in list {
            entries.push(serde_json::json!({ "name": v["key"], "value": v["value"], "scope": "user" }));
        }
    }
    if let Some(list) = obj["envData"]["systemVariables"].as_array() {
        for v in list {
            entries.push(serde_json::json!({ "name": v["key"], "value": v["value"], "scope": "machine" }));
        }
    }
    if let Some(list) = obj["vars"].as_array() {
        for v in list {
            entries.push(serde_json::json!({ "name": v["name"], "value": v["value"], "scope": v["scope"].as_str().unwrap_or("user") }));
        }
    }
    let to_map = |key: &str| -> serde_json::Value {
        let mut m = serde_json::Map::new();
        if let Some(arr) = obj[key].as_object() {
            for (k, v) in arr {
                m.insert(k.clone(), v.clone());
            }
        }
        serde_json::Value::Object(m)
    };
    if let Some(list) = obj["userVariables"].as_array() {
        for v in list {
            entries.push(serde_json::json!({ "name": v["key"], "value": v["value"], "scope": "user" }));
        }
    }
    if let Some(m) = obj["user"].as_object() {
        for (k, v) in m {
            entries.push(serde_json::json!({ "name": k, "value": v, "scope": "user" }));
        }
    }
    if let Some(m) = obj["machine"].as_object() {
        for (k, v) in m {
            entries.push(serde_json::json!({ "name": k, "value": v, "scope": "machine" }));
        }
    }
    let _ = to_map("");
    Ok(serde_json::json!({
        "meta": obj["backupMeta"], "entries": entries, "total": entries.len(),
        "checksumOk": true, "encrypted": is_encrypted(&text)
    }))
}

pub fn prune_backups(max: i64) -> usize {
    let limit = if max <= 0 { 0 } else { max as usize };
    if limit == 0 {
        return 0;
    }
    let files: Vec<_> = list_backup_files().into_iter().filter(|f| f["format"] == "json").collect();
    if files.len() <= limit {
        return 0;
    }
    let mut n = 0;
    for f in files.iter().skip(limit) {
        if let Some(p) = f["file"].as_str() {
            if std::fs::remove_file(Path::new(p)).is_ok() {
                n += 1;
            }
        }
    }
    n
}

/// 当前环境指纹（外部变更检测）
pub async fn env_fingerprint() -> Result<String, String> {
    let data = crate::registry::read_all()?;
    let mut parts: Vec<String> = Vec::new();
    for scope in ["user", "machine"] {
        if let Some(arr) = data[scope].as_array() {
            for v in arr {
                parts.push(format!("{}:{}={}", scope, v["name"].as_str().unwrap_or(""), v["value"].as_str().unwrap_or("")));
            }
        }
    }
    parts.sort();
    Ok(sha256_hex(parts.join("|").as_bytes()))
}
