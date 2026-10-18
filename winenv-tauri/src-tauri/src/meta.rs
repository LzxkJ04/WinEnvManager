//! 变量元数据（备注/锁定/标签/收藏/敏感/历史/来源）—— 仅软件内部保存

use std::path::PathBuf;

pub fn meta_file() -> PathBuf {
    crate::store::app_data_dir().join("meta.json")
}

fn load() -> serde_json::Value {
    let empty = serde_json::json!({ "vars": {}, "path": {}, "history": {}, "external": { "lastHash": "", "lastAt": 0 } });
    crate::store::read_json_file(&meta_file(), empty)
}

fn save(data: &serde_json::Value) -> Result<(), String> {
    crate::store::write_json_file(&meta_file(), data)
}

fn var_key(scope: &str, name: &str) -> String {
    format!("{}::{}", scope, name.to_uppercase())
}

pub fn all() -> serde_json::Value {
    let d = load();
    serde_json::json!({ "vars": d["vars"], "path": d["path"] })
}

pub fn set_var(scope: &str, name: &str, patch: &serde_json::Value) -> Result<serde_json::Value, String> {
    let mut d = load();
    let key = var_key(scope, name);
    let mut cur = d["vars"][key.clone()].clone();
    if cur.is_null() {
        cur = serde_json::json!({ "remark": "", "locked": false, "tags": [], "favorite": false, "sensitive": false, "updatedAt": 0 });
    }
    if let (Some(a), Some(b)) = (cur.as_object_mut(), patch.as_object()) {
        for (k, v) in b {
            a.insert(k.clone(), v.clone());
        }
    }
    d["vars"][key] = cur.clone();
    save(&d)?;
    Ok(cur)
}

pub fn remove_var(scope: &str, name: &str) -> bool {
    let mut d = load();
    let key = var_key(scope, name);
    let mut changed = false;
    if let Some(obj) = d["vars"].as_object_mut() {
        changed = obj.remove(&key).is_some();
    }
    let _ = save(&d);
    changed
}

pub fn history(scope: &str, name: &str) -> serde_json::Value {
    let d = load();
    d["history"][var_key(scope, name)].clone()
}

pub fn push_history(scope: &str, name: &str, op: &str, value: &str, old_value: &str) {
    let mut d = load();
    let key = var_key(scope, name);
    let mut list = d["history"][key.clone()].as_array().cloned().unwrap_or_default();
    list.insert(
        0,
        serde_json::json!({
            "at": chrono::Utc::now().timestamp_millis(),
            "op": op, "value": value, "oldValue": old_value
        }),
    );
    list.truncate(40);
    d["history"][key] = serde_json::Value::Array(list);
    let _ = save(&d);
}

pub fn set_path_meta(scope: &str, path: &str, patch: &serde_json::Value) -> serde_json::Value {
    let mut d = load();
    let key = format!("{}::{}", scope, path.trim().to_lowercase());
    let mut cur = d["path"][key.clone()].clone();
    if cur.is_null() {
        cur = serde_json::json!({ "remark": "", "sourceTag": "" });
    }
    if let (Some(a), Some(b)) = (cur.as_object_mut(), patch.as_object()) {
        for (k, v) in b {
            a.insert(k.clone(), v.clone());
        }
    }
    d["path"][key] = cur.clone();
    let _ = save(&d);
    cur
}

pub fn get_external() -> serde_json::Value {
    let d = load();
    d["external"].clone()
}

pub fn set_external(hash: &str) {
    let mut d = load();
    d["external"] = serde_json::json!({ "lastHash": hash, "lastAt": chrono::Utc::now().timestamp_millis() });
    let _ = save(&d);
}

pub fn is_locked(scope: &str, name: &str) -> bool {
    let d = load();
    d["vars"][var_key(scope, name)]["locked"].as_bool().unwrap_or(false)
}
