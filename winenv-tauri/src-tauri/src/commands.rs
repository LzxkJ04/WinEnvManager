//! Tauri 命令层：前端 invoke 的全部入口

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::Emitter;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::meta;
use crate::tasks::TaskManager;

pub struct AppState {
    pub tasks: TaskManager,
    pub draft: Arc<Mutex<Value>>,
}

pub fn save_draft(state: &State<AppState>) {
    let d = state.draft.lock().unwrap().clone();
    let _ = crate::store::write_json_file(&crate::store::app_data_dir().join("draft.json"), &d);
}

pub fn load_draft(state: &State<AppState>) -> Value {
    let mut d = crate::store::read_json_file(
        &crate::store::app_data_dir().join("draft.json"),
        json!({ "working": { "user": [], "machine": [] }, "changeMeta": {} }),
    );
    if d["working"].is_null() {
        d["working"] = json!({ "user": [], "machine": [] });
    }
    d
}

/* ============================ 环境变量 ============================ */

#[tauri::command]
pub fn read_env() -> Result<Value, String> {
    crate::registry::read_all()
}

#[tauri::command]
pub async fn read_env_detailed() -> Result<Value, String> {
    let mut d = crate::ops::capture_env_detailed().await?;
    d["admin"] = json!(crate::registry::is_admin());
    Ok(d)
}

#[tauri::command]
pub fn apply_changes(
    changes: Vec<Value>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let results = crate::registry::apply_changes(&changes)?;
    for c in &changes {
        let action = c["action"].as_str().unwrap_or("");
        let scope = c["scope"].as_str().unwrap_or("user");
        let name = c["name"].as_str().unwrap_or("");
        if action == "delete" {
            meta::remove_var(scope, name);
            meta::push_history(scope, name, "delete", "", c["oldValue"].as_str().unwrap_or(""));
        } else {
            let n = if action == "rename" { c["newName"].as_str().unwrap_or(name) } else { name };
            let _ = meta::set_var(scope, n, &json!({ "updatedAt": chrono::Utc::now().timestamp_millis() }));
            meta::push_history(scope, n, action, c["value"].as_str().unwrap_or(""), c["oldValue"].as_str().unwrap_or(""));
        }
    }
    // 草稿区同步：把已提交的变更从草稿里清除
    {
        let mut d = state.draft.lock().unwrap();
        let keys: Vec<String> = changes
            .iter()
            .map(|c| format!("{}::{}", c["scope"].as_str().unwrap_or("user"), c["name"].as_str().unwrap_or("").to_uppercase()))
            .collect();
        if let Some(cm) = d["changeMeta"].as_object_mut() {
            for k in keys {
                cm.remove(&k);
            }
        }
        save_draft(&state);
    }
    let _ = app.emit("env:changed", json!({}));
    crate::store::write_log("info", "写入系统环境变量", Some(json!(results.len())));
    Ok(json!({ "results": results, "needRestartExplorer": true }))
}

#[tauri::command]
pub fn write_one(payload: Value) -> Result<bool, String> {
    let scope = payload["scope"].as_str().unwrap_or("user");
    let name = payload["name"].as_str().unwrap_or("");
    let value = payload["value"].as_str().unwrap_or("");
    crate::registry::write_value(scope, name, value)?;
    crate::registry::broadcast_change()?;
    Ok(true)
}

#[tauri::command]
pub fn is_admin() -> bool {
    crate::registry::is_admin()
}

#[tauri::command]
pub fn reload_explorer() -> bool {
    let _ = crate::registry::reload_explorer();
    true
}

#[tauri::command]
pub fn broadcast_change() -> bool {
    let _ = crate::registry::broadcast_change();
    true
}

#[tauri::command]
pub fn validate_paths(paths: Vec<String>) -> Result<Value, String> {
    crate::registry::validate_paths(&paths)
}

#[tauri::command]
pub fn validate_pathext(value: String) -> Value {
    let entries: Vec<String> = value.split(';').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
    let valid_re = regex::Regex::new(r"^\.[A-Za-z0-9]{1,8}$").unwrap();
    let invalid: Vec<String> = entries.iter().filter(|e| !valid_re.is_match(e)).cloned().collect();
    let mut dup: Vec<String> = Vec::new();
    for e in &entries {
        if entries.iter().filter(|x| x.to_lowercase() == e.to_lowercase()).count() > 1 && !dup.contains(e) {
            dup.push(e.clone());
        }
    }
    json!({ "entries": entries, "invalid": invalid, "duplicate": dup, "valid": invalid.is_empty() && dup.is_empty() })
}

#[tauri::command]
pub fn expand_string(text: String) -> Result<String, String> {
    crate::registry::expand_string(&text)
}

#[tauri::command]
pub fn path_items(scope: String) -> Result<Value, String> {
    let data = crate::registry::read_all()?;
    let arr = &data[if scope == "machine" { "machine" } else { "user" }];
    let hit = arr
        .as_array()
        .and_then(|a| a.iter().find(|v| v["name"].as_str().unwrap_or("").eq_ignore_ascii_case("Path")))
        .map(|v| v["value"].as_str().unwrap_or("").to_string())
        .unwrap_or_default();
    let items: Vec<Value> = hit
        .split(';')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .enumerate()
        .map(|(i, p)| json!({ "id": format!("{}-{}", scope, i), "path": p, "scope": scope }))
        .collect();
    Ok(json!(items))
}

#[tauri::command]
pub fn save_path_items(payload: Value) -> Result<Value, String> {
    let scope = payload["scope"].as_str().unwrap_or("user").to_string();
    let items: Vec<String> = payload["items"]
        .as_array()
        .map(|a| a.iter().map(|i| i["path"].as_str().unwrap_or("").trim().to_string()).filter(|s| !s.is_empty()).collect())
        .unwrap_or_default();
    crate::registry::write_value(&scope, "Path", &items.join(";"))?;
    crate::registry::broadcast_change()?;
    let v = items.join(";");
    Ok(json!({ "value": v, "length": v.len() }))
}

/* ============================ 元数据 ============================ */

#[tauri::command]
pub fn meta_all() -> Value {
    crate::meta::all()
}

#[tauri::command]
pub fn meta_set(payload: Value) -> Result<Value, String> {
    crate::meta::set_var(
        payload["scope"].as_str().unwrap_or("user"),
        payload["name"].as_str().unwrap_or(""),
        &payload["patch"].as_object().map(|o| Value::Object(o.clone())).unwrap_or(json!({})),
    )
}

#[tauri::command]
pub fn meta_remove(payload: Value) -> bool {
    crate::meta::remove_var(payload["scope"].as_str().unwrap_or("user"), payload["name"].as_str().unwrap_or(""))
}

#[tauri::command]
pub fn meta_history(payload: Value) -> Value {
    crate::meta::history(payload["scope"].as_str().unwrap_or("user"), payload["name"].as_str().unwrap_or(""))
}

#[tauri::command]
pub fn meta_path_set(payload: Value) -> Value {
    crate::meta::set_path_meta(
        payload["scope"].as_str().unwrap_or("user"),
        payload["path"].as_str().unwrap_or(""),
        &payload["patch"].as_object().map(|o| Value::Object(o.clone())).unwrap_or(json!({})),
    )
}

#[tauri::command]
pub fn meta_toggle_favorite(payload: Value) -> Result<Value, String> {
    let scope = payload["scope"].as_str().unwrap_or("user");
    let name = payload["name"].as_str().unwrap_or("");
    let all = crate::meta::all()["vars"]
        .get(&format!("{}::{}", scope, name.to_uppercase()))
        .cloned()
        .unwrap_or(json!({}));
    let next = !all["favorite"].as_bool().unwrap_or(false);
    crate::meta::set_var(scope, name, &json!({ "favorite": next }))
}

#[tauri::command]
pub fn meta_set_tags(payload: Value) -> Result<Value, String> {
    crate::meta::set_var(payload["scope"].as_str().unwrap_or("user"), payload["name"].as_str().unwrap_or(""), &json!({ "tags": payload["tags"] }))
}

#[tauri::command]
pub fn meta_set_locked(payload: Value) -> Result<Value, String> {
    crate::meta::set_var(payload["scope"].as_str().unwrap_or("user"), payload["name"].as_str().unwrap_or(""), &json!({ "locked": payload["locked"].as_bool().unwrap_or(false) }))
}

#[tauri::command]
pub fn meta_mark_sensitive(payload: Value) -> Value {
    let name = payload["name"].as_str().unwrap_or("");
    let value = payload["value"].as_str().unwrap_or("");
    let hits = crate::analyze::detect_sensitive(name, value);
    let _ = crate::meta::set_var(payload["scope"].as_str().unwrap_or("user"), name, &json!({ "sensitive": !hits.is_empty(), "sensitiveLabels": hits }));
    json!({ "hits": hits })
}

/* ============================ 分析 ============================ */

#[tauri::command]
pub async fn sensitive_scan() -> Result<Value, String> {
    crate::analyze::sensitive_scan().await
}

#[tauri::command]
pub async fn var_refs(payload: Value) -> Result<Value, String> {
    crate::analyze::var_refs(&payload).await
}

#[tauri::command]
pub async fn broken_refs() -> Result<Value, String> {
    crate::analyze::broken_refs().await
}

#[tauri::command]
pub async fn external_check() -> Result<Value, String> {
    crate::analyze::external_check().await
}

#[tauri::command]
pub async fn registry_acl() -> Result<Value, String> {
    crate::analyze::registry_acl().await
}

#[tauri::command]
pub async fn terminal_env(payload: Value) -> Result<Value, String> {
    crate::analyze::terminal_env(&payload).await
}

#[tauri::command]
pub async fn path_perf() -> Result<Value, String> {
    crate::analyze::path_perf().await
}

#[tauri::command]
pub async fn storage_stats() -> Result<Value, String> {
    crate::analyze::storage_stats().await
}

/* ============================ 快照 ============================ */

#[tauri::command]
pub async fn create_snapshot(payload: Value) -> Result<Value, String> {
    let snap = crate::ops::create_snapshot(&payload).await?;
    let max = crate::store::read_config()["snapshotMax"].as_i64().unwrap_or(50);
    crate::ops::prune_snapshots(max);
    Ok(snap)
}

#[tauri::command]
pub fn list_snapshots() -> Value {
    json!(crate::ops::list_snapshots())
}

#[tauri::command]
pub fn read_snapshot(id: String) -> Result<Value, String> {
    crate::ops::read_snapshot(&id)
}

#[tauri::command]
pub fn delete_snapshot(id: String) -> Result<(), String> {
    crate::ops::delete_snapshot(&id)
}

#[tauri::command]
pub async fn compare_env(payload: Value) -> Result<Value, String> {
    crate::ops::compare_env(&payload).await
}

#[tauri::command]
pub async fn prepare_restore(payload: Value) -> Result<Value, String> {
    let id = payload["snapshotId"].as_str().unwrap_or("");
    Ok(json!(crate::ops::prepare_restore(id).await?))
}

#[tauri::command]
pub fn set_baseline(id: String) -> Value {
    let prev = crate::store::read_config()["baselineSnapshotId"].as_str().unwrap_or("").to_string();
    crate::store::write_config(&json!({ "baselineSnapshotId": id }));
    json!({ "baselineSnapshotId": id, "previous": prev })
}

#[tauri::command]
pub fn get_baseline() -> String {
    crate::store::read_config()["baselineSnapshotId"].as_str().unwrap_or("").to_string()
}

/* ============================ 备份 ============================ */

#[tauri::command]
pub async fn create_backup(payload: Value) -> Result<Value, String> {
    let res = crate::ops::create_backup(&payload).await?;
    let keep = crate::store::read_config()["backupKeep"].as_i64().unwrap_or(20);
    crate::ops::prune_backups(keep);
    Ok(res)
}

#[tauri::command]
pub fn list_backups() -> Value {
    let tags = crate::store::read_json_file(
        &crate::store::resolved_backup_dir().join(".tags.json"),
        json!({}),
    );
    let files = crate::ops::list_backup_files();
    json!({
        "dir": crate::store::resolved_backup_dir().display().to_string(),
        "files": files,
        "config": crate::store::read_config()
    })
}

#[tauri::command]
pub fn delete_backup(file: String) -> Result<(), String> {
    std::fs::remove_file(Path::new(&file)).map_err(|e| format!("删除失败：{}", e))
}

#[tauri::command]
pub fn read_backup(payload: Value) -> Result<Value, String> {
    crate::ops::read_backup_any(payload["file"].as_str().unwrap_or(""), payload["password"].as_str().unwrap_or(""))
}

#[tauri::command]
pub fn read_text_file(file: String) -> Result<String, String> {
    let buf = std::fs::read(Path::new(&file)).map_err(|e| format!("读取失败：{}", e))?;
    if buf.len() > 1 && buf[0] == 0xFF && buf[1] == 0xFE {
        let utf16: Vec<u16> = buf[2..].chunks(2).filter(|c| c.len() == 2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        return Ok(String::from_utf16_lossy(&utf16));
    }
    Ok(String::from_utf8_lossy(&buf).to_string())
}

#[tauri::command]
pub fn parse_text(text: String) -> Value {
    crate::parse::parse_text_content(&text)
}

#[tauri::command]
pub fn prune_backups(max: i64) -> usize {
    crate::ops::prune_backups(max)
}

#[tauri::command]
pub fn set_backup_tag(payload: Value) -> Value {
    let dir = crate::store::resolved_backup_dir();
    let mut tags = crate::store::read_json_file(&dir.join(".tags.json"), json!({}));
    if let (Some(name), Some(obj)) = (
        Path::new(payload["file"].as_str().unwrap_or("")).file_name().and_then(|s| s.to_str()),
        payload.as_object(),
    ) {
        let entry = json!({ "tag": payload["tag"], "note": payload["note"] });
        tags[name] = entry;
        let _ = crate::store::write_json_file(&dir.join(".tags.json"), &tags);
    }
    tags
}

#[tauri::command]
pub fn copy_to_remote(payload: Value) -> Result<Value, String> {
    let file = payload["file"].as_str().unwrap_or("");
    let remote = payload["remoteDir"].as_str().unwrap_or("");
    if file.is_empty() || !Path::new(file).exists() {
        return Err("源备份文件不存在".into());
    }
    if remote.is_empty() || !Path::new(remote).exists() {
        return Err(format!("远端目录不可访问：{}", remote));
    }
    let name = Path::new(file).file_name().ok_or("文件名无效")?;
    let dest = Path::new(remote).join(name);
    std::fs::copy(file, &dest).map_err(|e| format!("复制失败：{}", e))?;
    Ok(json!({ "dest": dest.display().to_string() }))
}

/* ============================ 开发环境 ============================ */

#[tauri::command]
pub fn list_catalog() -> Value {
    json!({
        "items": crate::catalog::load_catalog(),
        "mirrors": {
            "nodejs": "https://npmmirror.com/mirrors/node",
            "python": "https://npmmirror.com/mirrors/python",
            "golang": "https://mirrors.aliyun.com/golang",
            "jdk": "https://mirrors.tuna.tsinghua.edu.cn/Adoptium",
            "maven": "https://mirrors.tuna.tsinghua.edu.cn/apache/maven",
            "gradle": "https://mirrors.cloud.tencent.com/gradle",
            "github": "https://ghfast.top/https://github.com"
        }
    })
}

#[tauri::command]
pub fn get_catalog_item(id: String) -> Option<Value> {
    crate::catalog::load_catalog().as_array()?.iter().find(|i| i["id"].as_str() == Some(&id)).cloned()
}

#[tauri::command]
pub fn resolve_url(payload: Value) -> Result<Value, String> {
    let id = payload["itemId"].as_str().unwrap_or("");
    let version = payload["version"].as_str().unwrap_or("");
    let item = crate::catalog::load_catalog()
        .as_array()
        .and_then(|a| a.iter().find(|i| i["id"].as_str() == Some(id)))
        .cloned()
        .ok_or("软件清单项不存在")?;
    Ok(json!({ "url": crate::catalog::resolve_url(&item, version, payload["source"].as_str().unwrap_or("mirror"), payload["customMirror"].as_str()), "source": payload["source"] }))
}

#[tauri::command]
pub async fn scan_env(payload: Value) -> Result<Value, String> {
    crate::scanner::scan(&payload).await
}

#[tauri::command]
pub fn cancel_scan() -> bool {
    crate::scanner::cancel_scan();
    true
}

#[tauri::command]
pub fn validate_item(item: Value) -> Result<Value, String> {
    crate::scanner::validate_item(&item)
}

#[tauri::command]
pub fn validate_batch(items: Vec<Value>) -> Value {
    let mut out = Vec::new();
    for item in &items {
        match crate::scanner::validate_item(item) {
            Ok(mut r) => {
                r["name"] = item["name"].clone();
                out.push(r);
            }
            Err(e) => out.push(json!({ "name": item["name"], "ok": false, "message": e })),
        }
    }
    json!(out)
}

#[tauri::command]
pub fn build_plan(payload: Value) -> Result<Value, String> {
    let rule = crate::rules::get_rule(payload["ruleId"].as_str().unwrap_or("")).ok_or("识别规则不存在")?;
    let data = crate::registry::read_all()?;
    let to_map = |list: &Value| {
        let mut m = serde_json::Map::new();
        if let Some(arr) = list.as_array() {
            for v in arr {
                m.insert(v["name"].as_str().unwrap_or("").to_string(), v["value"].clone());
            }
        }
        Value::Object(m)
    };
    let current_env = json!({ "user": to_map(&data["user"]), "machine": to_map(&data["machine"]) });
    let plan = crate::rules::build_var_plan(&rule, payload["installPath"].as_str().unwrap_or(""), &current_env);
    let managed = !plan.is_empty() && plan.iter().all(|p| p["op"] == "same");
    Ok(json!({ "rule": { "id": rule["id"], "name": rule["name"] }, "plan": plan, "managed": managed }))
}

#[tauri::command]
pub fn list_ignore() -> Value {
    crate::store::read_config()["scanIgnoreList"].clone()
}

#[tauri::command]
pub fn add_ignore(key: String) -> bool {
    let mut cfg = crate::store::read_config();
    let mut list = cfg["scanIgnoreList"].as_array().cloned().unwrap_or_default();
    if !list.iter().any(|x| x.as_str() == Some(key.as_str())) {
        list.push(json!(key));
    }
    cfg["scanIgnoreList"] = Value::Array(list);
    crate::store::write_config(&cfg);
    true
}

#[tauri::command]
pub fn remove_ignore(key: String) -> bool {
    let mut cfg = crate::store::read_config();
    let list = cfg["scanIgnoreList"].as_array().cloned().unwrap_or_default();
    cfg["scanIgnoreList"] = Value::Array(list.into_iter().filter(|x| x.as_str() != Some(key.as_str())).collect());
    crate::store::write_config(&cfg);
    true
}

#[tauri::command]
pub async fn run_audit(payload: Value) -> Result<Value, String> {
    let scan = crate::scanner::scan(&payload).await?;
    let data = crate::registry::read_all()?;
    let to_map = |list: &Value| {
        let mut m = serde_json::Map::new();
        if let Some(arr) = list.as_array() {
            for v in arr {
                m.insert(v["name"].as_str().unwrap_or("").to_string(), v["value"].clone());
            }
        }
        Value::Object(m)
    };
    let current_env = json!({ "user": to_map(&data["user"]), "machine": to_map(&data["machine"]) });

    let mut issues: Vec<Value> = Vec::new();
    let mut ok_items: Vec<String> = Vec::new();
    let items = scan["items"].as_array().cloned().unwrap_or_default();

    for item in &items {
        if item["ignored"].as_bool().unwrap_or(false) {
            continue;
        }
        let missing_home: Vec<&Value> = item["variables"]
            .as_array()
            .map(|a| a.iter().filter(|v| v["name"].as_str().unwrap_or("").to_uppercase() != "PATH" && v["op"] != "same").collect())
            .unwrap_or_default();
        if !missing_home.is_empty() {
            issues.push(json!({
                "level": "error", "risk": "high",
                "title": format!("{} 缺少 HOME 类环境变量", item["name"].as_str().unwrap_or("")),
                "detail": missing_home.iter().map(|m| format!("{}（建议值 {}）", m["name"].as_str().unwrap_or(""), m["value"].as_str().unwrap_or(""))).collect::<Vec<_>>().join("、"),
                "installPath": item["installPath"], "ruleId": item["ruleId"],
                "fix": missing_home
            }));
        } else {
            ok_items.push(format!("{} 变量完整", item["name"].as_str().unwrap_or("")));
        }
    }

    // PATH 无效与重复
    let mut all_paths: Vec<String> = Vec::new();
    for scope in ["user", "machine"] {
        if let Some(v) = current_env[scope].get("Path") {
            for p in v.as_str().unwrap_or("").split(';') {
                let t = p.trim();
                if !t.is_empty() {
                    all_paths.push(t.to_string());
                }
            }
        }
    }
    let path_check = crate::registry::check_paths_exist(&all_paths);
    let invalid_paths: Vec<String> = path_check
        .iter()
        .filter(|r| !r["exists"].as_bool().unwrap_or(false))
        .filter_map(|r| r["path"].as_str().map(|s| s.to_string()))
        .collect();
    let mut dup_paths: Vec<String> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for p in &all_paths {
        let k = p.trim_end_matches(['\\', '/']).to_lowercase();
        if !seen.insert(k.clone()) {
            dup_paths.push(p.clone());
        }
    }

    // 变量指向目录失效
    for scope in ["user", "machine"] {
        if let Some(m) = current_env[scope].as_object() {
            for (name, value) in m {
                if !(name.ends_with("_HOME") || name.ends_with("_ROOT")) {
                    continue;
                }
                let expanded = crate::ps::expand_win(value.as_str().unwrap_or(""));
                if !Path::new(&expanded).is_dir() {
                    issues.push(json!({
                        "level": "warn", "risk": "medium",
                        "title": format!("变量 {} 指向的目录不存在", name),
                        "detail": value.as_str().unwrap_or(""),
                        "scope": scope, "name": name,
                        "fix": [json!({ "scope": scope, "name": name, "value": "", "op": "delete" })]
                    }));
                }
            }
        }
    }

    // 多版本冲突
    let mut by_rule: std::collections::HashMap<String, Vec<Value>> = std::collections::HashMap::new();
    for item in &items {
        if item["ignored"].as_bool().unwrap_or(false) {
            continue;
        }
        by_rule.entry(item["ruleId"].as_str().unwrap_or("").to_string()).or_default().push(item.clone());
    }
    let conflicts: Vec<Value> = by_rule
        .iter()
        .filter(|(_, list)| list.len() > 1)
        .map(|(rid, list)| {
            json!({ "ruleId": rid, "name": crate::rules::get_rule(rid).map(|r| r["name"].clone()).unwrap_or(json!(rid)), "items": list })
        })
        .collect();

    let errors = issues.iter().filter(|i| i["level"] == "error").count();
    let warns = issues.iter().filter(|i| i["level"] == "warn").count();
    crate::store::write_log("warn", "环境审计完成", Some(json!({ "errors": errors, "warns": warns })));

    Ok(json!({
        "scannedAt": chrono::Utc::now().timestamp_millis(),
        "total": items.len(),
        "managed": items.iter().filter(|i| i["managed"].as_bool().unwrap_or(false)).count(),
        "discovered": items.iter().filter(|i| !i["managed"].as_bool().unwrap_or(false) && !i["ignored"].as_bool().unwrap_or(false)).count(),
        "ignored": items.iter().filter(|i| i["ignored"].as_bool().unwrap_or(false)).count(),
        "invalidPaths": invalid_paths, "dupPaths": dup_paths, "conflicts": conflicts,
        "issues": issues, "okItems": ok_items, "items": items,
        "summary": { "errors": errors, "warns": warns }
    }))
}

#[tauri::command]
pub fn open_dev_dir(kind: String) -> Value {
    let dir = if kind == "cache" { crate::store::cache_dir() } else { crate::store::resolved_dev_root() };
    json!(dir.display().to_string())
}

#[tauri::command]
pub fn cache_stats() -> Value {
    let dir = crate::store::cache_dir();
    let (size, count) = crate::store::dir_size(&dir);
    json!({ "dir": dir.display().to_string(), "size": size, "count": count })
}

#[tauri::command]
pub fn clear_cache() -> usize {
    let dir = crate::store::cache_dir();
    let mut n = 0usize;
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                if std::fs::remove_dir_all(&p).is_ok() {
                    n += 1;
                }
            } else if std::fs::remove_file(&p).is_ok() {
                n += 1;
            }
        }
    }
    n
}

/* ============================ 识别规则 ============================ */

#[tauri::command]
pub fn list_rules_cmd() -> Value {
    crate::rules::list_rules()
}

#[tauri::command]
pub fn save_rule(rule: Value) -> Result<Value, String> {
    crate::rules::save_rule(&rule)
}

#[tauri::command]
pub fn delete_rule(id: String) -> bool {
    crate::rules::delete_rule(&id)
}

#[tauri::command]
pub fn export_rules() -> String {
    crate::rules::export_rules()
}

#[tauri::command]
pub fn import_rules(text: String) -> Result<Value, String> {
    crate::rules::import_rules(&text)
}

/* ============================ 任务队列 ============================ */

#[tauri::command]
pub fn list_tasks(state: State<'_, AppState>) -> Value {
    json!(state.tasks.list())
}

#[tauri::command]
pub fn get_task(id: String, state: State<'_, AppState>) -> Option<Value> {
    state.tasks.get(&id)
}

#[tauri::command]
pub fn cancel_task(id: String, state: State<'_, AppState>) -> bool {
    state.tasks.cancel(&id)
}

#[tauri::command]
pub fn pause_task(id: String, state: State<'_, AppState>) -> bool {
    state.tasks.pause(&id)
}

#[tauri::command]
pub fn resume_task(id: String, state: State<'_, AppState>) -> bool {
    state.tasks.resume(&id)
}

#[tauri::command]
pub fn retry_task(id: String, state: State<'_, AppState>) -> bool {
    state.tasks.update(&id, &mut |t| {
        if ["failed", "cancelled"].contains(&t.status.as_str()) {
            t.status = "queued".into();
            t.error = String::new();
            t.progress = 0.0;
        }
    });
    true
}

#[tauri::command]
pub fn clear_finished_tasks(state: State<'_, AppState>) -> usize {
    state.tasks.clear_finished()
}

#[tauri::command]
pub fn pause_all_tasks(state: State<'_, AppState>) -> usize {
    let ids: Vec<String> = state
        .tasks
        .list()
        .iter()
        .filter(|t| t["status"] == "running")
        .filter_map(|t| t["id"].as_str().map(|s| s.to_string()))
        .collect();
    let mut n = 0;
    for id in ids {
        if state.tasks.pause(&id) {
            n += 1;
        }
    }
    n
}

#[tauri::command]
pub fn resume_all_tasks(state: State<'_, AppState>) -> usize {
    let ids: Vec<String> = state
        .tasks
        .list()
        .iter()
        .filter(|t| t["status"] == "paused" || t["status"] == "queued")
        .filter_map(|t| t["id"].as_str().map(|s| s.to_string()))
        .collect();
    let mut n = 0;
    for id in ids {
        state.tasks.resume(&id);
        n += 1;
    }
    n
}

#[tauri::command]
pub fn set_concurrency(n: f64, state: State<'_, AppState>) -> usize {
    state.tasks.set_concurrency(n as usize)
}

#[tauri::command]
pub fn create_deploy_task(payload: Value, state: State<'_, AppState>, app: AppHandle) -> Value {
    let name = format!("部署 {} {}", payload["itemId"].as_str().unwrap_or(""), payload["version"].as_str().unwrap_or(""));
    let task = state.tasks.create(&name, "deploy", payload.clone());
    let id = task["id"].as_str().unwrap_or("").to_string();
    let app2 = app.clone();
    let tasks_handle = state.tasks.list_handle();
    std::thread::spawn(move || {
        crate::deploy::run_deploy(&id, &payload, &tasks_handle, &app2);
    });
    task
}

#[tauri::command]
pub fn create_uninstall_task(payload: Value, state: State<'_, AppState>) -> Value {
    let name = format!("卸载 {}", payload["name"].as_str().unwrap_or(""));
    state.tasks.create(&name, "uninstall", payload.clone())
}

/* ============================ 配置集 ============================ */

#[tauri::command]
pub fn envset_list() -> Value {
    crate::envset::list()
}

#[tauri::command]
pub fn envset_get(id: String) -> Option<Value> {
    crate::envset::get(&id)
}

#[tauri::command]
pub fn envset_create(payload: Value) -> Result<Value, String> {
    crate::envset::create(&payload)
}

#[tauri::command]
pub fn envset_update(payload: Value) -> Result<Value, String> {
    crate::envset::update(payload["id"].as_str().unwrap_or(""), &payload["patch"])
}

#[tauri::command]
pub fn envset_delete(id: String) -> Result<bool, String> {
    crate::envset::delete(&id)
}

#[tauri::command]
pub fn envset_duplicate(id: String) -> Result<Value, String> {
    crate::envset::duplicate(&id)
}

#[tauri::command]
pub fn envset_export(id: String) -> Result<Value, String> {
    let s = crate::envset::get(&id).ok_or("配置集不存在")?;
    Ok(json!({ "kind": "win-env-manager-config-set", "version": 1, "exportedAt": crate::ops::ts_text(), "set": s }))
}

#[tauri::command]
pub fn envset_import(json_text: String) -> Result<Value, String> {
    let obj: Value = serde_json::from_str(&json_text).map_err(|e| format!("JSON 解析失败：{}", e))?;
    let src = if obj["set"].is_object() { obj["set"].clone() } else { obj };
    crate::envset::create(&src)
}

#[tauri::command]
pub fn envset_export_file(payload: Value, app: AppHandle) -> Result<Value, String> {
    use tauri_plugin_dialog::DialogExt;
    let id = payload["id"].as_str().unwrap_or("");
    let set = crate::envset::get(id).ok_or("配置集不存在")?;
    let mut vars = set["variables"].clone();
    if payload["desensitize"].as_bool().unwrap_or(false) {
        if let Some(arr) = vars.as_array_mut() {
            for v in arr.iter_mut() {
                let masked = crate::analyze::mask_value(v["value"].as_str().unwrap_or(""));
                v["value"] = json!(masked);
            }
        }
    }
    let name = set["name"].as_str().unwrap_or("config-set").to_string();
    let file = app
        .dialog()
        .file()
        .add_filter("JSON", &["json"])
        .set_file_name(&format!("{}.json", name))
        .blocking_save_file();
    match file {
        Some(p) => {
            let path = p.into_path().map_err(|e| e.to_string())?;
            let mut set_obj = set.as_object().cloned().unwrap_or_default();
            set_obj.insert("variables".to_string(), vars);
            let body = json!({ "kind": "win-env-manager-config-set", "version": 1, "set": Value::Object(set_obj) });
            std::fs::write(&path, serde_json::to_string_pretty(&body).unwrap_or_default()).map_err(|e| e.to_string())?;
            Ok(json!({ "file": path.display().to_string() }))
        }
        None => Ok(json!({ "canceled": true })),
    }
}

#[tauri::command]
pub fn envset_list_mutex() -> Value {
    crate::envset::list_mutex()
}

#[tauri::command]
pub fn envset_create_mutex(payload: Value) -> Result<Value, String> {
    crate::envset::create_mutex(&payload)
}

#[tauri::command]
pub fn envset_update_mutex(payload: Value) -> Result<Value, String> {
    crate::envset::update_mutex(payload["id"].as_str().unwrap_or(""), &payload["patch"])
}

#[tauri::command]
pub fn envset_delete_mutex(id: String) -> Result<bool, String> {
    crate::envset::delete_mutex(&id)
}

#[tauri::command]
pub fn envset_assign_mutex(payload: Value) -> Result<Value, String> {
    crate::envset::assign_mutex(payload["setId"].as_str().unwrap_or(""), payload["mutexId"].as_str().unwrap_or(""))
}

#[tauri::command]
pub fn envset_members(id: String) -> Value {
    let d = crate::envset::list_all();
    let arr = d["sets"].as_array().cloned().unwrap_or_default();
    json!(arr.into_iter().filter(|s| s["mutexId"].as_str() == Some(id.as_str())).collect::<Vec<_>>())
}

#[tauri::command]
pub fn envset_templates() -> Value {
    crate::envset::templates()
}

#[tauri::command]
pub fn envset_template(name: String) -> Option<Value> {
    crate::envset::template(&name)
}

#[tauri::command]
pub fn envset_ignore_prompt(id: String) -> bool {
    crate::envset::ignore_prompt(&id)
}

#[tauri::command]
pub fn launch_terminal(payload: Value) -> Result<Value, String> {
    crate::envset::launch_terminal(&payload)
}

#[tauri::command]
pub fn start_watch(payload: Value, app: AppHandle) -> Result<Value, String> {
    let dir = payload["dir"].as_str().unwrap_or("").to_string();
    let set_id = payload["setId"].as_str().unwrap_or("").to_string();
    if !Path::new(&dir).is_dir() {
        return Err("绑定的项目目录不存在".into());
    }
    let watch_dir = dir.clone();
    std::thread::spawn(move || {
        let dir = watch_dir;
        let mut last = std::fs::metadata(&dir).ok().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis()).unwrap_or(0);
        loop {
            std::thread::sleep(std::time::Duration::from_secs(5));
            let m = std::fs::metadata(&dir).ok().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis()).unwrap_or(0);
            if m != last {
                last = m;
                let _ = app.emit("envset:project-activity", json!({ "setId": set_id, "dir": dir, "at": chrono::Utc::now().timestamp_millis() }));
            }
        }
    });
    Ok(json!({ "started": true, "dir": dir }))
}

#[tauri::command]
pub fn stop_watch() -> bool {
    true
}

/* ============================ 文件系统 ============================ */

#[tauri::command]
pub fn pick_folder(payload: Value, app: AppHandle) -> Value {
    use tauri_plugin_dialog::DialogExt;
    let default = payload["defaultPath"].as_str().unwrap_or("");
    let mut d = app.dialog().file();
    if !default.is_empty() {
        d = d.set_directory(default);
    }
    match d.blocking_pick_folder() {
        Some(p) => json!({ "canceled": false, "path": p.into_path().map(|x| x.display().to_string()).unwrap_or_default() }),
        None => json!({ "canceled": true }),
    }
}

#[tauri::command]
pub fn pick_file(payload: Value, app: AppHandle) -> Value {
    use tauri_plugin_dialog::DialogExt;
    let filters = payload["filters"].as_array().cloned().unwrap_or_default();
    let mut d = app.dialog().file();
    for f in &filters {
        let name = f["name"].as_str().unwrap_or("文件");
        let exts: Vec<String> = f["extensions"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect()).unwrap_or_default();
        let refs: Vec<&str> = exts.iter().map(|s| s.as_str()).collect();
        d = d.add_filter(name, &refs);
    }
    match d.blocking_pick_file() {
        Some(p) => json!({ "canceled": false, "path": p.into_path().map(|x| x.display().to_string()).unwrap_or_default() }),
        None => json!({ "canceled": true }),
    }
}

#[tauri::command]
pub fn pick_save(payload: Value, app: AppHandle) -> Value {
    use tauri_plugin_dialog::DialogExt;
    let name = payload["defaultPath"].as_str().unwrap_or("export.txt");
    let filters = payload["filters"].as_array().cloned().unwrap_or_default();
    let mut d = app.dialog().file().set_file_name(name);
    for f in &filters {
        let fname = f["name"].as_str().unwrap_or("文件");
        let exts: Vec<String> = f["extensions"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect()).unwrap_or_default();
        let refs: Vec<&str> = exts.iter().map(|s| s.as_str()).collect();
        d = d.add_filter(fname, &refs);
    }
    match d.blocking_save_file() {
        Some(p) => json!({ "canceled": false, "path": p.into_path().map(|x| x.display().to_string()).unwrap_or_default() }),
        None => json!({ "canceled": true }),
    }
}

#[tauri::command]
pub fn write_text_file(payload: Value) -> Result<Value, String> {
    let file = payload["file"].as_str().unwrap_or("");
    let content = payload["content"].as_str().unwrap_or("");
    let bom = payload["bom"].as_bool().unwrap_or(false);
    let mut bytes: Vec<u8> = Vec::new();
    if bom {
        bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
    }
    bytes.extend_from_slice(content.as_bytes());
    let size = bytes.len();
    std::fs::write(file, bytes).map_err(|e| format!("写入失败：{}", e))?;
    Ok(json!({ "file": file, "size": size }))
}

/* ============================ 配置 / 日志 ============================ */

#[tauri::command]
pub fn get_config() -> Value {
    json!({
        "config": crate::store::read_config(),
        "paths": {
            "appData": crate::store::app_data_dir().display().to_string(),
            "config": crate::store::config_file().display().to_string(),
            "snapshots": crate::store::snapshot_dir().display().to_string(),
            "logs": crate::store::log_dir().display().to_string(),
            "backupDir": crate::store::resolved_backup_dir().display().to_string(),
            "defaultBackupDir": crate::store::default_backup_dir().display().to_string(),
            "cacheDir": crate::store::cache_dir().display().to_string(),
            "devRoot": crate::store::resolved_dev_root().display().to_string()
        }
    })
}

#[tauri::command]
pub fn set_config(patch: Value, app: AppHandle) -> Value {
    let cfg = crate::store::write_config(&patch);
    let _ = app.emit("config:changed", json!({}));
    json!({ "config": cfg, "paths": {} })
}

#[tauri::command]
pub fn write_log(payload: Value) -> bool {
    crate::store::write_log(payload["level"].as_str().unwrap_or("info"), payload["message"].as_str().unwrap_or(""), None);
    true
}

#[tauri::command]
pub fn list_logs() -> Value {
    let dir = crate::store::log_dir();
    let mut files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            let meta = e.metadata().ok();
            files.push(json!({
                "name": e.file_name().to_string_lossy(),
                "file": e.path().display().to_string(),
                "size": meta.as_ref().map(|m| m.len()).unwrap_or(0)
            }));
        }
    }
    json!({ "dir": dir.display().to_string(), "files": files })
}

#[tauri::command]
pub fn clear_logs() -> usize {
    let dir = crate::store::log_dir();
    let mut n = 0;
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            if std::fs::remove_file(e.path()).is_ok() {
                n += 1;
            }
        }
    }
    n
}

#[tauri::command]
pub fn open_log_dir(app: AppHandle) -> bool {
    let dir = crate::store::log_dir();
    let _ = app.opener().open_path(dir.display().to_string(), None::<&str>);
    true
}

/* ============================ 应用 ============================ */

#[tauri::command]
pub fn app_info(app: AppHandle) -> Value {
    json!({
        "name": "WinEnvManager", "title": "WinEnv管家",
        "version": app.package_info().version.to_string(),
        "electron": "Tauri 2", "chrome": "WebView2", "node": "-", "v8": "-",
        "platform": format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
        "exe": std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_default(),
        "packaged": cfg!(debug_assertions) == false,
        "startedAt": chrono::Utc::now().timestamp_millis()
    })
}

#[tauri::command]
pub fn set_auto_launch(enable: bool) -> bool {
    crate::store::write_config(&json!({ "autoLaunch": enable }));
    enable
}

#[tauri::command]
pub fn get_auto_launch() -> bool {
    crate::store::read_config()["autoLaunch"].as_bool().unwrap_or(false)
}

#[tauri::command]
pub fn win_minimize(app: AppHandle) -> bool {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.minimize();
    }
    true
}

#[tauri::command]
pub fn win_close(app: AppHandle) -> bool {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.close();
    }
    true
}

#[tauri::command]
pub fn win_hide(app: AppHandle) -> bool {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    true
}

/* ============================ 工具 ============================ */

#[tauri::command]
pub fn elevate(app: AppHandle) -> Result<Value, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let script = format!(
        "Start-Process -FilePath '{}' -Verb RunAs",
        crate::ps::ps_quote(&exe.display().to_string())
    );
    crate::ps::run_powershell(&script)?;
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1200));
        app.exit(0);
    });
    Ok(json!({ "exe": exe.display().to_string() }))
}

#[tauri::command]
pub fn open_reg_env(scope: String) -> String {
    let key = if scope == "machine" { "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment" } else { "HKEY_CURRENT_USER\\Environment" };
    let script = format!("Start-Process regedit.exe; Start-Sleep -Milliseconds 800; $w = Add-Type -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr h);' -Name W -Namespace N -PassThru; $p = (Get-Process regedit -ErrorAction SilentlyContinue | Select-Object -First 1).MainWindowHandle; if($p){{ [N.W]::SetForegroundWindow($p) }}");
    let _ = crate::ps::run_powershell(&script);
    let _ = key;
    String::new()
}

#[tauri::command]
pub fn open_native_panel(kind: String) -> bool {
    let script = if kind == "advanced" {
        "Start-Process SystemPropertiesAdvanced.exe"
    } else {
        "Start-Process rundll32.exe -ArgumentList 'sysdm.cpl,EditEnvironmentVariables'"
    };
    let _ = crate::ps::run_powershell(script);
    true
}

#[tauri::command]
pub fn open_folder(path: String, app: AppHandle) -> bool {
    let target = if path.trim().is_empty() { crate::store::app_data_dir() } else { PathBuf::from(&path) };
    let dir = if Path::new(&target).is_dir() { target } else { target.parent().map(|p| p.to_path_buf()).unwrap_or(target) };
    let _ = app.opener().open_path(dir.display().to_string(), None::<&str>);
    true
}

#[tauri::command]
pub fn open_external(url: String, app: AppHandle) -> bool {
    let _ = app.opener().open_url(url, None::<&str>);
    true
}

#[tauri::command]
pub fn show_in_folder(path: String, app: AppHandle) -> bool {
    let p = PathBuf::from(&path);
    if p.is_file() {
        let script = format!(
            "Start-Process explorer.exe -ArgumentList '/select,\"{}\"'",
            crate::ps::ps_quote(&p.display().to_string())
        );
        let _ = crate::ps::run_powershell(&script);
    } else {
        let _ = app.opener().open_path(path, None::<&str>);
    }
    true
}

#[tauri::command]
pub fn env_summary() -> Value {
    let data = crate::registry::read_all().unwrap_or(json!({}));
    let count = |list: &Value| list.as_array().map(|a| a.len()).unwrap_or(0);
    json!({
        "counts": { "user": count(&data["user"]), "machine": count(&data["machine"]), "total": count(&data["user"]) + count(&data["machine"]) },
        "config": crate::store::read_config(),
        "paths": {}
    })
}

#[tauri::command]
pub fn which_command(payload: Value) -> Result<Value, String> {
    let name = payload["name"].as_str().unwrap_or("").trim().to_string();
    let dirs = payload["dirs"].as_array().cloned().unwrap_or_default();
    if name.is_empty() {
        return Err("请输入要查找的命令名".into());
    }
    let mut script = String::from("$dirs = @(\n");
    for d in &dirs {
        script.push_str(&format!("  '{}',\n", crate::ps::ps_quote(d.as_str().unwrap_or(""))));
    }
    script.push_str(&format!(
        "  '') | Where-Object {{ $_ -ne '' }}
$name = '{}'
$exts = @('.exe','.cmd','.bat','.com','.ps1')
$result = New-Object System.Collections.ArrayList
$i = 0
foreach ($raw in $dirs) {{
  $i++
  if ([string]::IsNullOrWhiteSpace($raw)) {{ continue }}
  try {{ $exp = [Environment]::ExpandEnvironmentVariables($raw) }} catch {{ $exp = $raw }}
  foreach ($ext in $exts) {{
    $c = Join-Path $exp ($name + $ext)
    if (Test-Path -LiteralPath $c -PathType Leaf) {{
      [void]$result.Add([pscustomobject]@{{ order = $i; dir = $raw; file = $c }})
    }}
  }}
}}
@($result) | ConvertTo-Json -Depth 3 -Compress
",
        crate::ps::ps_quote(&name)
    ));
    let raw = crate::ps::run_powershell(&script)?;
    Ok(json!(crate::registry::parse_array(&raw, |i| i.clone())))
}

#[tauri::command]
pub fn list_executables(payload: Value) -> Result<Value, String> {
    let dir = payload["dir"].as_str().unwrap_or("");
    let exts: Vec<Value> = payload["exts"].as_array().cloned().unwrap_or_else(|| vec![json!(".exe"), json!(".cmd"), json!(".bat"), json!(".com")]);
    let script = format!(
        "$d = '{}'
$exts = @({})
if (-not (Test-Path -LiteralPath $d -PathType Container)) {{ @() | ConvertTo-Json -Compress; return }}
@(Get-ChildItem -LiteralPath $d -File -ErrorAction SilentlyContinue | Where-Object {{ $exts -contains $_.Extension.ToLower() }} | Select-Object -First 200 | ForEach-Object {{ [pscustomobject]@{{ file = $_.FullName; size = $_.Length }} }}) | ConvertTo-Json -Depth 3 -Compress
",
        crate::ps::ps_quote(dir),
        exts.iter().map(|e| format!("'{}'", e.as_str().unwrap_or(".exe").to_lowercase())).collect::<Vec<_>>().join(",")
    );
    let raw = crate::ps::run_powershell(&script)?;
    Ok(json!(crate::registry::parse_array(&raw, |i| i.clone())))
}

#[tauri::command]
pub async fn reset_env_defaults(payload: Value) -> Result<Value, String> {
    let scope = payload["scope"].as_str().unwrap_or("user").to_string();
    let defaults = if scope == "machine" {
        json!({
            "ComSpec": "%SystemRoot%\\system32\\cmd.exe", "OS": "Windows_NT",
            "Path": "%SystemRoot%\\system32;%SystemRoot%;%SystemRoot%\\System32\\Wbem;%SYSTEMROOT%\\System32\\WindowsPowerShell\\v1.0\\;%SYSTEMROOT%\\System32\\OpenSSH\\",
            "PATHEXT": ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC",
            "windir": "%SystemRoot%"
        })
    } else {
        json!({
            "TEMP": "%USERPROFILE%\\AppData\\Local\\Temp",
            "TMP": "%USERPROFILE%\\AppData\\Local\\Temp",
            "Path": "%USERPROFILE%\\AppData\\Local\\Microsoft\\WindowsApps"
        })
    };
    let before = crate::registry::read_scope(&scope)?;
    // 重置前强制备份
    let detailed = crate::ops::capture_env_detailed().await?;
    let _ = crate::ops::create_snapshot(&json!({ "name": "重置环境前快照", "auto": true })).await;
    let _ = crate::ops::create_backup(&json!({ "prefix": "BeforeReset", "env": detailed, "backupType": "full" })).await;

    for v in &before {
        let _ = crate::registry::delete_value(&scope, &v.name);
    }
    if let Some(obj) = defaults.as_object() {
        for (k, v) in obj {
            crate::registry::write_value(&scope, k, v.as_str().unwrap_or(""))?;
        }
    }
    crate::registry::broadcast_change()?;
    crate::store::write_log("error", &format!("重置{}变量为系统默认值", if scope == "machine" { "系统" } else { "用户" }), Some(json!({ "removed": before.len() })));
    Ok(json!({ "removed": before.len(), "restored": defaults.as_object().map(|o| o.len()).unwrap_or(0) }))
}
