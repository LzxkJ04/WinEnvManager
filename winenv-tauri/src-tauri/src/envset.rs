//! 环境配置集：多套环境变量配置 + 互斥组

use serde_json::json;
use std::path::{Path, PathBuf};

fn file() -> PathBuf {
    crate::store::app_data_dir().join("configsets.json")
}

fn load() -> serde_json::Value {
    crate::store::read_json_file(&file(), serde_json::json!({ "version": 1, "sets": [], "mutexGroups": [], "ignorePrompts": [] }))
}

fn save(data: &serde_json::Value) -> Result<(), String> {
    crate::store::write_json_file(&file(), data)
}

pub fn list() -> serde_json::Value {
    let d = load();
    serde_json::json!({ "sets": d["sets"], "mutex": d["mutexGroups"] })
}

pub fn list_all() -> serde_json::Value {
    load()
}

pub fn get(id: &str) -> Option<serde_json::Value> {
    load()["sets"].as_array()?.iter().find(|s| s["id"].as_str() == Some(id)).cloned()
}

pub fn create(payload: &serde_json::Value) -> Result<serde_json::Value, String> {
    let mut d = load();
    let set = serde_json::json!({
        "id": format!("cs-{}", uuid::Uuid::new_v4().to_string()[..8].to_string()),
        "name": payload["name"].as_str().unwrap_or("新配置集"),
        "type": if payload["type"].as_str() == Some("project") { "project" } else { "global" },
        "comment": payload["comment"].as_str().unwrap_or(""),
        "group": payload["group"].as_str().unwrap_or(""),
        "readOnly": false,
        "projectDir": payload["projectDir"].as_str().unwrap_or(""),
        "folderWatch": payload["folderWatch"].as_bool().unwrap_or(false),
        "mutexId": payload["mutexId"].as_str().unwrap_or(""),
        "variables": payload["variables"].as_array().cloned().unwrap_or_default(),
        "createdAt": chrono::Utc::now().timestamp_millis(),
        "updatedAt": chrono::Utc::now().timestamp_millis()
    });
    {
        if let Some(arr) = d["sets"].as_array_mut() {
            arr.push(set.clone());
        }
    }
    save(&d)?;
    Ok(set)
}

pub fn update(id: &str, patch: &serde_json::Value) -> Result<serde_json::Value, String> {
    let mut d = load();
    let sets = d["sets"].as_array_mut().ok_or("配置集文件损坏")?;
    let set = sets.iter_mut().find(|s| s["id"].as_str() == Some(id)).ok_or("配置集不存在")?;
    if set["readOnly"].as_bool().unwrap_or(false) && patch["_force"].as_bool() != Some(true) {
        return Err("该配置集已锁定为只读，不能修改".into());
    }
    for key in ["name", "comment", "group", "type", "projectDir", "folderWatch", "variables", "mutexId", "readOnly"] {
        if let Some(v) = patch.get(key) {
            set[key] = v.clone();
        }
    }
    set["updatedAt"] = serde_json::json!(chrono::Utc::now().timestamp_millis());
    let snapshot = set.clone();
    save(&d)?;
    Ok(snapshot)
}

pub fn delete(id: &str) -> Result<bool, String> {
    let mut d = load();
    let sets_len;
    {
        let sets = d["sets"].as_array_mut().ok_or("配置集文件损坏")?;
        let before = sets.len();
        sets.retain(|s| s["id"].as_str() != Some(id));
        sets_len = (sets.len() != before, ());
        if sets.len() == before {
            return Ok(false);
        }
    }
    save(&d)?;
    Ok(true)
}

pub fn duplicate(id: &str) -> Result<serde_json::Value, String> {
    let mut src = get(id).ok_or("配置集不存在")?;
    src["name"] = serde_json::json!(format!("{} 副本", src["name"].as_str().unwrap_or("")));
    src["readOnly"] = serde_json::json!(false);
    src["mutexId"] = serde_json::json!("");
    create(&src)
}

pub fn list_mutex() -> serde_json::Value {
    load()["mutexGroups"].clone()
}

pub fn create_mutex(payload: &serde_json::Value) -> Result<serde_json::Value, String> {
    let mut d = load();
    let g = serde_json::json!({
        "id": format!("mg-{}", uuid::Uuid::new_v4().to_string()[..8].to_string()),
        "name": payload["name"].as_str().unwrap_or("新互斥组"),
        "comment": payload["comment"].as_str().unwrap_or(""),
        "autoClean": payload["autoClean"].as_bool().unwrap_or(true),
        "forceBlock": payload["forceBlock"].as_bool().unwrap_or(false),
        "snapshotBefore": payload["snapshotBefore"].as_bool().unwrap_or(true),
        "createdAt": chrono::Utc::now().timestamp_millis()
    });
    d["mutexGroups"].as_array_mut().ok_or("配置集文件损坏")?.push(g.clone());
    save(&d)?;
    Ok(g)
}

pub fn update_mutex(id: &str, patch: &serde_json::Value) -> Result<serde_json::Value, String> {
    let mut d = load();
    let groups = d["mutexGroups"].as_array_mut().ok_or("配置集文件损坏")?;
    let g = groups.iter_mut().find(|x| x["id"].as_str() == Some(id)).ok_or("互斥组不存在")?;
    for key in ["name", "comment", "autoClean", "forceBlock", "snapshotBefore"] {
        if let Some(v) = patch.get(key) {
            g[key] = v.clone();
        }
    }
    let snapshot = g.clone();
    save(&d)?;
    Ok(snapshot)
}

pub fn delete_mutex(id: &str) -> Result<bool, String> {
    let mut d = load();
    if let Some(groups) = d["mutexGroups"].as_array_mut() {
        groups.retain(|g| g["id"].as_str() != Some(id));
    }
    if let Some(sets) = d["sets"].as_array_mut() {
        for s in sets.iter_mut() {
            if s["mutexId"].as_str() == Some(id) {
                s["mutexId"] = serde_json::json!("");
            }
        }
    }
    save(&d)?;
    Ok(true)
}

pub fn assign_mutex(set_id: &str, mutex_id: &str) -> Result<serde_json::Value, String> {
    let mut d = load();
    if !mutex_id.is_empty() && !d["mutexGroups"].as_array().map(|a| a.iter().any(|g| g["id"].as_str() == Some(mutex_id))).unwrap_or(false) {
        return Err("互斥组不存在".into());
    }
    if !mutex_id.is_empty() {
        if let Some(owner) = d["sets"].as_array().and_then(|a| a.iter().find(|s| s["mutexId"].as_str() == Some(mutex_id) && s["id"].as_str() != Some(set_id))) {
            let gname = d["mutexGroups"].as_array().and_then(|a| a.iter().find(|g| g["id"].as_str() == Some(mutex_id)).map(|g| g["name"].as_str().unwrap_or("").to_string())).unwrap_or_default();
            return Err(format!("配置集「{}」已归属互斥组「{}」，请先移出原互斥组", owner["name"].as_str().unwrap_or(""), gname));
        }
    }
    {
        let sets = d["sets"].as_array_mut().ok_or("配置集文件损坏")?;
        let set = sets.iter_mut().find(|s| s["id"].as_str() == Some(set_id)).ok_or("配置集不存在")?;
        set["mutexId"] = serde_json::json!(mutex_id);
    }
    let snapshot = get(set_id).ok_or("配置集不存在")?;
    save(&d)?;
    Ok(snapshot)
}

pub fn ignore_prompt(id: &str) -> bool {
    let mut d = load();
    if let Some(list) = d["ignorePrompts"].as_array_mut() {
        if !list.iter().any(|x| x.as_str() == Some(id)) {
            list.push(serde_json::json!(id));
            let _ = save(&d);
        }
    }
    true
}

const TEMPLATES_JSON: &str = r#"[
  {"id":"java","name":"Java / JDK","desc":"JAVA_HOME + PATH","vars":[{"key":"JAVA_HOME","value":"C:\\dev\\soft\\jdk-17","remark":"JDK 主目录","scope":"user"},{"key":"PATH","value":"{{JAVA_HOME}}\\bin","remark":"JDK bin","scope":"user","isPathEntry":true}]},
  {"id":"node","name":"Node.js","desc":"NODE_HOME + PATH","vars":[{"key":"NODE_HOME","value":"C:\\dev\\soft\\node-v22","remark":"Node 主目录","scope":"user"},{"key":"PATH","value":"{{NODE_HOME}}","remark":"Node 目录","scope":"user","isPathEntry":true}]},
  {"id":"python","name":"Python","desc":"PYTHON_HOME + Scripts","vars":[{"key":"PYTHON_HOME","value":"C:\\dev\\soft\\python313","remark":"Python 主目录","scope":"user"},{"key":"PYTHONPATH","value":"%PYTHON_HOME%;%PYTHON_HOME%\\Lib","remark":"模块搜索路径","scope":"user"},{"key":"PATH","value":"{{PYTHON_HOME}}\\Scripts","remark":"pip 脚本目录","scope":"user","isPathEntry":true}]},
  {"id":"goenv","name":"Go","desc":"GOROOT / GOPATH","vars":[{"key":"GOROOT","value":"C:\\dev\\soft\\go","remark":"Go 安装目录","scope":"user"},{"key":"GOPATH","value":"%USERPROFILE%\\go","remark":"Go 工作区","scope":"user"}]},
  {"id":"maven","name":"Maven","desc":"MAVEN_HOME / MAVEN_OPTS","vars":[{"key":"MAVEN_HOME","value":"C:\\dev\\soft\\maven","remark":"Maven 主目录","scope":"user"},{"key":"MAVEN_OPTS","value":"-Xms128m -Xmx512m","remark":"Maven JVM 参数","scope":"user"}]},
  {"id":"gradle","name":"Gradle","desc":"GRADLE_HOME","vars":[{"key":"GRADLE_HOME","value":"C:\\dev\\soft\\gradle","remark":"Gradle 主目录","scope":"user"},{"key":"GRADLE_USER_HOME","value":"%USERPROFILE%\\.gradle","remark":"Gradle 用户目录","scope":"user"}]},
  {"id":"android","name":"Android SDK","desc":"ANDROID_HOME","vars":[{"key":"ANDROID_HOME","value":"C:\\dev\\soft\\android-sdk","remark":"SDK 根目录","scope":"user"}]},
  {"id":"cuda","name":"CUDA","desc":"CUDA_HOME","vars":[{"key":"CUDA_HOME","value":"C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.4","remark":"CUDA 主目录","scope":"user"}]},
  {"id":"ffmpeg","name":"FFmpeg","desc":"PATH 条目","vars":[{"key":"PATH","value":"C:\\dev\\soft\\ffmpeg\\bin","remark":"FFmpeg 可执行目录","scope":"user","isPathEntry":true}]},
  {"id":"proxy","name":"代理变量","desc":"http_proxy / https_proxy / no_proxy","vars":[{"key":"http_proxy","value":"http://127.0.0.1:7890","remark":"HTTP 代理","scope":"user"},{"key":"https_proxy","value":"http://127.0.0.1:7890","remark":"HTTPS 代理","scope":"user"},{"key":"no_proxy","value":"localhost,127.0.0.1","remark":"不走代理的地址","scope":"user"}]}
]"#;

pub fn templates() -> serde_json::Value {
    let all: serde_json::Value = serde_json::from_str(TEMPLATES_JSON).unwrap_or(serde_json::json!([]));
    let list = all
        .as_array()
        .map(|a| {
            a.iter()
                .map(|t| serde_json::json!({ "id": t["id"], "name": t["name"], "desc": t["desc"] }))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    serde_json::Value::Array(list)
}

pub fn template(name: &str) -> Option<serde_json::Value> {
    let all: serde_json::Value = serde_json::from_str(TEMPLATES_JSON).ok()?;
    all.as_array()?
        .iter()
        .find(|t| t["id"].as_str() == Some(name))
        .map(|t| t["vars"].clone())
}

/** 启动临时终端：注入环境变量后进入项目目录，仅当前进程生效 */
pub fn launch_terminal(payload: &serde_json::Value) -> Result<serde_json::Value, String> {
    use std::process::Command;

    let shell = payload["shell"].as_str().unwrap_or("cmd");
    let cwd = payload["cwd"].as_str().unwrap_or("");
    let mut env_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    // 以系统真实环境为底
    if let Ok(data) = crate::registry::read_all() {
        for scope in ["machine", "user"] {
            if let Some(arr) = data[scope].as_array() {
                for v in arr {
                    env_map.insert(v["name"].as_str().unwrap_or("").to_uppercase(), v["value"].as_str().unwrap_or("").to_string());
                }
            }
        }
    }
    if let Some(obj) = payload["env"].as_object() {
        for (k, v) in obj {
            env_map.insert(k.to_uppercase(), v.as_str().unwrap_or("").to_string());
        }
    }
    if let Some(changes) = payload["draftChanges"].as_array() {
        for c in changes {
            let key = c["name"].as_str().unwrap_or("").to_uppercase();
            if c["action"].as_str() == Some("delete") {
                env_map.remove(&key);
            } else {
                env_map.insert(key, c["value"].as_str().unwrap_or("").to_string());
            }
        }
    }

    let workdir = if !cwd.is_empty() && Path::new(cwd).exists() { cwd.to_string() } else { crate::store::resolved_dev_root().display().to_string() };
    let title = payload["title"].as_str().unwrap_or("WinEnv 临时终端");

    let (cmd, args) = if shell == "powershell" {
        (
            "powershell.exe".to_string(),
            vec![
                "-NoExit".into(),
                "-NoProfile".into(),
                "-ExecutionPolicy".into(),
                "Bypass".into(),
                "-Command".into(),
                format!("Set-Location -LiteralPath '{}'; Write-Host '  [WinEnv管家] 项目环境已注入（仅当前进程生效，关闭窗口自动失效）' -ForegroundColor Cyan", workdir.replace('\'', "''")),
            ],
        )
    } else {
        ("cmd.exe".to_string(), vec!["/K".into(), format!("title {}", title)])
    };

    let mut command = Command::new(&cmd);
    command.args(&args).current_dir(&workdir);
    command.env_remove("PROMPT");
    for (k, v) in &env_map {
        command.env(k, v);
    }
    crate::ps::creation_flags(&mut command);
    let child = command.spawn().map_err(|e| format!("启动终端失败：{}", e))?;
    let pid = child.id();
    std::mem::forget(child);

    crate::store::write_log("info", &format!("启动临时终端（{}）", shell), Some(json!({ "cwd": workdir, "vars": env_map.len() })));
    Ok(json!({ "pid": pid, "shell": shell, "cwd": workdir, "injected": env_map.len() }))
}
