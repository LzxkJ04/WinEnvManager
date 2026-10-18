//! .env / .properties / 纯文本导入解析

use serde_json::{json, Value};

const KEY_RE_OK: &str = r"^[A-Za-z_][A-Za-z0-9_.-]*$";

fn check_key(raw: &str) -> Option<String> {
    let k = raw.trim();
    if k.is_empty() {
        return Some("禁止空键名".into());
    }
    if k.starts_with('=') {
        return Some("变量名不能以等号开头".into());
    }
    match regex::Regex::new(KEY_RE_OK) {
        Ok(re) if re.is_match(k) => None,
        _ => Some(format!("键名包含非法字符：{}", k)),
    }
}

fn unescape_env(s: &str) -> String {
    s.replace("\\n", "\n").replace("\\t", "\t").replace("\\\"", "\"").replace("\\'", "'").replace("\\\\", "\\")
}

fn unescape_props(s: &str) -> String {
    let mut out = String::new();
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '\\' && i + 1 < chars.len() {
            match chars[i + 1] {
                'u' if i + 5 < chars.len() => {
                    let hexs: String = chars[i + 2..i + 6].iter().collect();
                    if let Ok(n) = u32::from_str_radix(&hexs, 16) {
                        if let Some(c) = char::from_u32(n) {
                            out.push(c);
                            i += 6;
                            continue;
                        }
                    }
                    out.push(chars[i]);
                    i += 1;
                }
                '=' => { out.push('='); i += 2; }
                ':' => { out.push(':'); i += 2; }
                '\\' => { out.push('\\'); i += 2; }
                'n' => { out.push('\n'); i += 2; }
                't' => { out.push('\t'); i += 2; }
                other => { out.push(other); i += 2; }
            }
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    out
}

pub fn parse_dot_env(text: &str) -> Value {
    let mut entries = Vec::new();
    let mut issues = Vec::new();
    let lines: Vec<&str> = text.trim_start_matches('\u{feff}').lines().collect();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') {
            i += 1;
            continue;
        }
        let eq = match line.find('=') {
            Some(p) if p > 0 => p,
            _ => {
                issues.push(json!({ "line": i + 1, "text": line, "level": "warn", "message": "缺少等号，已跳过" }));
                i += 1;
                continue;
            }
        };
        let raw_key = line[..eq].trim().to_string();
        let mut value = line[eq + 1..].to_string();
        let first = value.trim().chars().next().unwrap_or(' ');
        if first == '"' || first == '\'' {
            let quote = first;
            let mut body = value.trim().to_string();
            body.remove(0);
            while !body.trim_end().ends_with(quote) && i + 1 < lines.len() {
                i += 1;
                body.push('\n');
                body.push_str(lines[i]);
            }
            if body.trim_end().ends_with(quote) {
                let trimmed = body.trim_end();
                value = trimmed[..trimmed.len() - 1].to_string();
                if quote == '"' {
                    value = unescape_env(&value);
                }
            }
        }
        // ${VAR} -> %VAR%
        let re = regex::Regex::new(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}").unwrap();
        value = re.replace_all(&value, "%$1%").to_string();

        if let Some(issue) = check_key(&raw_key) {
            issues.push(json!({ "line": i + 1, "text": line, "level": "error", "message": issue, "key": raw_key, "value": value }));
            entries.push(json!({ "key": raw_key, "value": value, "line": i + 1, "issues": [issue], "kind": "dotenv", "valid": false }));
            i += 1;
            continue;
        }
        entries.push(json!({
            "key": raw_key.to_uppercase(), "originalKey": raw_key, "value": value,
            "line": i + 1, "issues": [], "kind": "dotenv",
            "isPathKey": raw_key.to_uppercase() == "PATH", "valid": true
        }));
        i += 1;
    }
    json!({ "entries": entries, "issues": issues })
}

pub fn parse_properties(text: &str) -> Value {
    let mut entries = Vec::new();
    let mut issues = Vec::new();
    let raw_lines: Vec<&str> = text.trim_start_matches('\u{feff}').lines().collect();

    // 合并反斜杠续行
    let mut lines: Vec<String> = Vec::new();
    let mut idx = 0;
    while idx < raw_lines.len() {
        let mut cur = raw_lines[idx].to_string();
        while cur.trim_end().ends_with('\\') && idx + 1 < raw_lines.len() {
            cur = cur.trim_end().trim_end_matches('\\').to_string() + raw_lines[idx + 1];
            idx += 1;
        }
        lines.push(cur);
        idx += 1;
    }

    for (n, line) in lines.iter().enumerate() {
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') || t.starts_with('!') {
            continue;
        }
        let chars: Vec<char> = line.chars().collect();
        let mut eq = None;
        let mut j = 0;
        while j < chars.len() {
            if chars[j] == '\\' {
                j += 2;
                continue;
            }
            if chars[j] == '=' || chars[j] == ':' {
                eq = Some(j);
                break;
            }
            j += 1;
        }
        let eq = match eq {
            Some(p) if p > 0 => p,
            _ => {
                issues.push(json!({ "line": n + 1, "text": line, "level": "warn", "message": "缺少键值分隔符，已跳过" }));
                continue;
            }
        };
        let raw_key: String = chars[..eq].iter().collect::<String>().trim().replace("\\", "").replace("\\:", ":").replace("\\=", "=");
        let value = unescape_props(chars[eq + 1..].iter().collect::<String>().trim());

        if let Some(issue) = check_key(&raw_key) {
            issues.push(json!({ "line": n + 1, "text": line, "level": "error", "message": issue, "key": raw_key, "value": value }));
            entries.push(json!({ "key": raw_key, "value": value, "line": n + 1, "issues": [issue], "kind": "properties", "valid": false }));
            continue;
        }
        entries.push(json!({
            "key": raw_key, "originalKey": raw_key, "value": value,
            "line": n + 1, "issues": [], "kind": "properties",
            "isPathKey": raw_key.to_uppercase() == "PATH", "valid": true
        }));
    }
    json!({ "entries": entries, "issues": issues })
}

pub fn parse_plain(text: &str) -> Value {
    let mut entries = Vec::new();
    let mut scope = "user".to_string();
    for line in text.trim_start_matches('\u{feff}').lines() {
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        if t.starts_with('[') {
            let lower = t.to_lowercase();
            scope = if lower.contains("系统") || lower.contains("machine") || lower.contains("system") {
                "machine".to_string()
            } else {
                "user".to_string()
            };
            continue;
        }
        if let Some(eq) = t.find('=') {
            if eq > 0 {
                let key = t[..eq].trim().to_string();
                let value = t[eq + 1..].to_string();
                entries.push(json!({ "key": key, "originalKey": key, "value": value, "scope": scope, "issues": [], "kind": "plain", "valid": check_key(&key).is_none() }));
            }
        }
    }
    json!({ "entries": entries, "issues": [] })
}

pub fn parse_text_content(text: &str) -> Value {
    let clean = text.trim_start_matches('\u{feff}');
    let trimmed = clean.trim();
    if trimmed.is_empty() {
        return json!({ "entries": [], "issues": [] });
    }
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        // JSON 备份
        if let Ok(obj) = serde_json::from_str::<Value>(trimmed) {
            let mut entries = Vec::new();
            for scope_key in ["userVariables", "user"] {
                if let Some(list) = obj["envData"][scope_key].as_array() {
                    for v in list {
                        entries.push(json!({ "name": v["key"], "value": v["value"], "scope": "user" }));
                    }
                } else if let Some(m) = obj[scope_key].as_object() {
                    for (k, v) in m {
                        entries.push(json!({ "name": k, "value": v, "scope": "user" }));
                    }
                }
            }
            for scope_key in ["systemVariables", "machine"] {
                if let Some(list) = obj["envData"][scope_key].as_array() {
                    for v in list {
                        entries.push(json!({ "name": v["key"], "value": v["value"], "scope": "machine" }));
                    }
                } else if let Some(m) = obj[scope_key].as_object() {
                    for (k, v) in m {
                        entries.push(json!({ "name": k, "value": v, "scope": "machine" }));
                    }
                }
            }
            if let Some(list) = obj["vars"].as_array() {
                for v in list {
                    entries.push(json!({ "name": v["name"], "value": v["value"], "scope": v["scope"].as_str().unwrap_or("user") }));
                }
            }
            return json!({ "entries": entries, "issues": [] });
        }
    }
    if trimmed.starts_with("Windows Registry Editor") || trimmed.contains("[HKEY_") {
        return parse_reg(trimmed);
    }
    // 启发式：点号键名较多 → properties
    let sample: Vec<&str> = clean.lines().filter(|l| !l.trim().is_empty() && !l.trim().starts_with('#')).take(30).collect();
    let dot_keys = sample.iter().filter(|l| regex::Regex::new(r"^[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]*\s*[=:]").unwrap().is_match(l)).count();
    let upper_keys = sample.iter().filter(|l| regex::Regex::new(r"^[A-Z_][A-Z0-9_]*=").unwrap().is_match(l.trim())).count();
    if dot_keys > upper_keys {
        parse_properties(clean)
    } else {
        parse_dot_env(clean)
    }
}

fn parse_reg(text: &str) -> Value {
    let mut entries = Vec::new();
    let mut scope: Option<String> = None;

    // 合并续行
    let mut logical: Vec<String> = Vec::new();
    for raw in text.lines() {
        let t = raw.trim_end();
        if let Some(last) = logical.last_mut() {
            if last.ends_with('\\') && !t.starts_with('[') {
                last.pop();
                last.push_str(t.trim());
                continue;
            }
        }
        logical.push(t.to_string());
    }

    let re_val = regex::Regex::new(r#"^"((?:[^"\\]|\\.)*)"=(.*)$"#).unwrap();
    for line in &logical {
        let line = line.trim();
        if line.is_empty() || line.starts_with(';') {
            continue;
        }
        if line.starts_with('[') {
            let key = line.trim_start_matches('[').trim_end_matches(']').to_lowercase();
            scope = if key.contains("hkey_current_user\\environment") || key.contains("hkcu\\environment") {
                Some("user".into())
            } else if key.contains("session manager\\environment") {
                Some("machine".into())
            } else {
                None
            };
            continue;
        }
        let sc = match &scope {
            Some(s) => s.clone(),
            None => continue,
        };
        if let Some(cap) = re_val.captures(line) {
            let unesc = |s: &str| s.replace("\\\\", "\\").replace("\\\"", "\"");
            let name = unesc(cap.get(1).map(|m| m.as_str()).unwrap_or(""));
            let rest = cap.get(2).map(|m| m.as_str()).unwrap_or("").trim();
            if let Some(v) = rest.strip_prefix('"') {
                let value = v.trim_end_matches('"');
                entries.push(json!({ "name": name, "value": unesc(value), "scope": sc }));
            } else if let Some(h) = rest.strip_prefix("hex") {
                let digits: String = h
                    .trim_start_matches(|c: char| c == '(' || c.is_ascii_digit() || c == ')')
                    .trim_start_matches(':')
                    .replace(['\\', ' ', '\n'], "");
                let bytes: Vec<u8> = digits
                    .split(',')
                    .filter(|b| !b.is_empty())
                    .filter_map(|b| u8::from_str_radix(b, 16).ok())
                    .collect();
                if bytes.len() >= 2 {
                    let utf16: Vec<u16> = bytes[..bytes.len() - bytes.len() % 2]
                        .chunks(2)
                        .map(|c| u16::from_le_bytes([c[0], c[1]]))
                        .collect();
                    let value = String::from_utf16_lossy(&utf16).trim_end_matches('\0').to_string();
                    entries.push(json!({ "name": name, "value": value, "scope": sc }));
                }
            }
        }
    }
    json!({ "entries": entries, "issues": [] })
}
