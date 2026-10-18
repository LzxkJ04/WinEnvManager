//! 软件自动识别规则库（内置 JSON + 用户自定义）

use std::path::PathBuf;

const BUILTIN_JSON: &str = include_str!("../resources/rules.json");
pub const RULE_VERSION: &str = "1.0";

pub fn custom_file() -> PathBuf {
    crate::store::app_data_dir().join("scan-rules.json")
}

pub fn list_rules() -> serde_json::Value {
    let builtin: serde_json::Value = serde_json::from_str(BUILTIN_JSON).unwrap_or(serde_json::json!({}));
    let mut list: Vec<serde_json::Value> = builtin["ruleList"].as_array().cloned().unwrap_or_default();
    let custom = crate::store::read_json_file(&custom_file(), serde_json::json!({ "ruleList": [] }));
    if let Some(arr) = custom["ruleList"].as_array() {
        for r in arr {
            let id = r["id"].as_str().unwrap_or("");
            if let Some(pos) = list.iter().position(|x| x["id"].as_str() == Some(id)) {
                list[pos] = r.clone();
            } else {
                list.push(r.clone());
            }
        }
    }
    serde_json::json!({ "ruleVersion": RULE_VERSION, "rules": list })
}

pub fn get_rule(id: &str) -> Option<serde_json::Value> {
    let all = list_rules();
    all["rules"].as_array()?.iter().find(|r| r["id"].as_str() == Some(id)).cloned()
}

pub fn save_rule(rule: &serde_json::Value) -> Result<serde_json::Value, String> {
    if rule["name"].as_str().unwrap_or("").is_empty() {
        return Err("缺少 name".into());
    }
    if rule["executableName"].as_str().unwrap_or("").is_empty() {
        return Err("缺少 executableName".into());
    }
    let mut data = crate::store::read_json_file(&custom_file(), serde_json::json!({ "ruleVersion": RULE_VERSION, "ruleList": [] }));
    let list = data["ruleList"].as_array_mut().ok_or("规则文件损坏")?;
    let id = rule["id"].as_str().unwrap_or("");
    if let Some(pos) = list.iter().position(|x| x["id"].as_str() == Some(id)) {
        list[pos] = rule.clone();
    } else {
        let mut r = rule.clone();
        if r["id"].as_str().unwrap_or("").is_empty() {
            r["id"] = serde_json::json!(format!("custom-{}", uuid::Uuid::new_v4()));
        }
        list.push(r);
    }
    crate::store::write_json_file(&custom_file(), &data)?;
    Ok(rule.clone())
}

pub fn delete_rule(id: &str) -> bool {
    let mut data = crate::store::read_json_file(&custom_file(), serde_json::json!({ "ruleList": [] }));
    let before = data["ruleList"].as_array().map(|a| a.len()).unwrap_or(0);
    if let Some(list) = data["ruleList"].as_array_mut() {
        list.retain(|r| r["id"].as_str() != Some(id));
    }
    let after = data["ruleList"].as_array().map(|a| a.len()).unwrap_or(0);
    if after != before {
        let _ = crate::store::write_json_file(&custom_file(), &data);
    }
    after != before
}

pub fn import_rules(text: &str) -> Result<serde_json::Value, String> {
    let obj: serde_json::Value = serde_json::from_str(text).map_err(|e| format!("JSON 解析失败：{}", e))?;
    let list = obj["ruleList"]
        .as_array()
        .ok_or("规则文件缺少 ruleList 数组")?
        .clone();
    let mut data = crate::store::read_json_file(&custom_file(), serde_json::json!({ "ruleVersion": RULE_VERSION, "ruleList": [] }));
    let mut current = data["ruleList"].as_array().cloned().unwrap_or_default();
    let mut imported = 0usize;
    let mut skipped: Vec<serde_json::Value> = Vec::new();
    for r in list {
        if r["name"].as_str().unwrap_or("").is_empty() || r["executableName"].as_str().unwrap_or("").is_empty() {
            skipped.push(serde_json::json!({ "name": r["name"].as_str().unwrap_or("(未命名)"), "reason": "缺少必要字段" }));
            continue;
        }
        let id = r["id"].as_str().unwrap_or("");
        if let Some(pos) = current.iter().position(|x| x["id"].as_str() == Some(id)) {
            current[pos] = r;
        } else {
            current.push(r);
        }
        imported += 1;
    }
    data["ruleList"] = serde_json::Value::Array(current.clone());
    crate::store::write_json_file(&custom_file(), &data)?;
    Ok(serde_json::json!({ "imported": imported, "skipped": skipped, "total": current.len() }))
}

pub fn export_rules() -> String {
    serde_json::to_string_pretty(&list_rules()).unwrap_or_default()
}

/** 依据规则与安装目录生成环境变量计划 */
pub fn build_var_plan(rule: &serde_json::Value, install_path: &str, current_env: &serde_json::Value) -> Vec<serde_json::Value> {
    let mut plan = Vec::new();
    let templates = rule["envTemplate"].as_array().cloned().unwrap_or_default();
    for t in templates {
        let tscope = t["scope"].as_str().unwrap_or("user");
        let scope = if tscope == "system" { "machine" } else { "user" };
        let raw_value = t["varValue"].as_str().unwrap_or("").replace("{{installPath}}", install_path);
        let key = t["varKey"].as_str().unwrap_or("");
        let cur_map = &current_env[scope];
        let cur = cur_map.get(key).cloned();

        if key.eq_ignore_ascii_case("PATH") {
            let entry = raw_value.trim_end_matches(['\\', '/']).to_string();
            let items: Vec<String> = cur
                .as_ref()
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .split(';')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            let dup = items.iter().any(|i| i.trim_end_matches(['\\', '/']).eq_ignore_ascii_case(&entry));
            if dup {
                plan.push(serde_json::json!({ "scope": scope, "name": "Path", "value": cur.clone(), "remark": t["remark"], "op": "same" }));
                continue;
            }
            let next = if t["pathPosition"].as_str() == Some("prepend") {
                format!("{};{}", entry, items.join(";"))
            } else {
                let mut v = items;
                v.push(entry.clone());
                v.join(";")
            };
            let op = if cur.is_some() { "update" } else { "create" };
            plan.push(serde_json::json!({ "scope": scope, "name": "Path", "value": next, "remark": t["remark"], "op": op, "oldValue": cur, "pathEntry": entry }));
            continue;
        }

        let same = cur.as_ref().and_then(|v| v.as_str()).map(|s| s == raw_value).unwrap_or(false);
        let exists = cur.as_ref().map(|v| !v.is_null()).unwrap_or(false);
        let op = if exists && same {
            "same"
        } else if exists {
            "update"
        } else {
            "create"
        };
        plan.push(serde_json::json!({
            "scope": scope, "name": key, "value": raw_value, "remark": t["remark"].as_str().unwrap_or(""),
            "op": op, "oldValue": cur
        }));
    }
    plan
}
