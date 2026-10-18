//! 部署任务执行：下载 → 安装/解压 → 版本校验 → 返回变量计划（写入草稿）

use serde_json::{json, Value};
use tauri::Emitter;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::tasks::{Task, TaskManager, TaskSignal};

pub fn run_deploy(
    id: &str,
    payload: &Value,
    tasks: &Arc<Mutex<Vec<Arc<Mutex<Task>>>>>,
    app: &tauri::AppHandle,
) {
    let signal = Arc::new(Mutex::new(TaskSignal::default()));
    let mgr = TaskManager::new();

    let emit = |tasks: &Arc<Mutex<Vec<Arc<Mutex<Task>>>>>, app: &tauri::AppHandle| {
        if let Some(t) = tasks.lock().unwrap().iter().find(|t| t.lock().unwrap().id == id) {
            let snapshot = crate::tasks::serialize(&t.lock().unwrap());
            let _ = app.emit("task:change", snapshot);
        }
    };
    let update = |f: &mut dyn FnMut(&mut Task)| {
        mgr.update(id, f);
        emit(tasks, app);
    };
    let log = |text: &str, level: &str| {
        mgr.log(id, text, level);
        emit(tasks, app);
    };

    mgr.update(id, &mut |t: &mut crate::tasks::Task| t.status = "running".into());
    log("任务开始执行", "info");

    let item_id = payload["itemId"].as_str().unwrap_or("").to_string();
    let version = payload["version"].as_str().unwrap_or("").to_string();
    let scope = payload["scope"].as_str().unwrap_or("user").to_string();
    let cfg = crate::store::read_config();
    let install_dir = payload["installDir"].as_str().map(|s| s.to_string()).unwrap_or_else(|| {
        crate::store::resolved_dev_root().join(&item_id).display().to_string()
    });
    let source = payload["source"].as_str().unwrap_or(cfg["downloadSource"].as_str().unwrap_or("mirror")).to_string();

    let result = (|| -> Result<Value, String> {
        let item = crate::catalog::load_catalog()
            .as_array()
            .and_then(|a| a.iter().find(|i| i["id"].as_str() == Some(item_id.as_str())))
            .cloned()
            .ok_or("软件清单项不存在")?;

        let url = crate::catalog::resolve_url(&item, &version, &source, None);
        log(&format!("下载源：{} {}", if source == "official" { "官方源" } else { "镜像源" }, url), "info");

        let ext = Path::new(&url)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("zip")
            .to_lowercase();
        let cache_dir = crate::store::cache_dir();
        let cache_file = cache_dir.join(format!("{}-{}.{}", item_id, version.replace(['/', '+', '.'], "_"), ext));

        update(&mut |t: &mut crate::tasks::Task| {
            t.progress = 2.0;
            t.params["phase"] = json!("下载");
        });

        if cache_file.exists() && cache_file.metadata().map(|m| m.len() > 0).unwrap_or(false) {
            log(&format!("命中本地缓存：{}", cache_file.display()), "info");
        } else {
            let signal2 = signal.clone();
            let (size, sha) = crate::tasks::download_file(&url, &cache_file, &signal2, &|received, total, speed| {
                let percent = if total > 0 { (received as f64 / total as f64) * 95.0 } else { 0.0 };
                mgr.update(id, &mut |t: &mut crate::tasks::Task| {
                    t.progress = percent.clamp(0.0, 95.0);
                    t.received = received;
                    t.total = total;
                    t.speed = speed;
                });
            })?;
            log(&format!("下载完成：{}（SHA256 {}）", crate::store::fmt_size(size), &sha[..16.min(sha.len())]), "info");
        }

        update(&mut |t: &mut crate::tasks::Task| {
            t.progress = 96.0;
            t.params["phase"] = json!("安装");
        });
        let _ = std::fs::create_dir_all(&install_dir);

        if ext == "zip" || payload["mode"].as_str().unwrap_or(&item["installMode"].as_str().unwrap_or("portable")) == "portable" {
            if ext == "zip" {
                log("解压压缩包…", "info");
                crate::ps::run_powershell(&format!(
                    "Expand-Archive -LiteralPath '{}' -DestinationPath '{}' -Force",
                    crate::ps::ps_quote(&cache_file.display().to_string()),
                    crate::ps::ps_quote(&install_dir)
                ))?;
                crate::tasks::flatten_single_dir(Path::new(&install_dir));
            } else {
                return Err(format!("暂不支持该压缩格式 .{}，请使用 exe 安装包或手动解压", ext));
            }
        } else {
            let args = item["silentArgs"]
                .as_str()
                .unwrap_or("/S")
                .replace("{dir}", &install_dir);
            log(&format!("静默安装：{} {}", cache_file.file_name().and_then(|s| s.to_str()).unwrap_or(""), args), "info");
            crate::ps::run_powershell(&format!(
                "$p = Start-Process -FilePath '{}' -ArgumentList '{}' -Wait -PassThru; $p.ExitCode",
                crate::ps::ps_quote(&cache_file.display().to_string()),
                crate::ps::ps_quote(&args)
            ))?;
        }

        if payload["registerService"].as_bool().unwrap_or(false) {
            if let Some(script) = item["postInstallScript"].as_str() {
                let cmd = script.replace("{dir}", &install_dir);
                log(&format!("注册服务：{}", cmd), "info");
                let _ = crate::ps::run_powershell(&format!(
                    "Start-Process -FilePath 'cmd.exe' -ArgumentList '/c cd /d \"{}\" && {}' -Verb RunAs -Wait",
                    install_dir.replace('"', "\\\""),
                    cmd.replace('"', "\\\"")
                ));
            }
        }

        // 版本校验
        let mut verify = json!(null);
        if let Some(rule) = crate::rules::get_rule(item["ruleId"].as_str().unwrap_or("")) {
            let exe = crate::tasks::find_exe_in(&install_dir, rule["executableName"].as_str().unwrap_or(""));
            if !exe.is_empty() {
                let v = crate::scanner::detect_version_pub(&rule, &exe, &install_dir);
                let ok = !v.is_empty();
                log(&if ok { format!("版本校验通过：{}", v) } else { "版本校验未取得输出（可能需要重新打开终端）".to_string() }, if ok { "info" } else { "warn" });
                verify = json!({ "ok": ok, "version": v, "exePath": exe });
            }
        }

        // 生成变量计划（仅进入草稿区，不写注册表）
        let mut variables = Vec::new();
        if let Some(rule) = crate::rules::get_rule(item["ruleId"].as_str().unwrap_or("")) {
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
            variables = crate::rules::build_var_plan(&rule, &install_dir, &current_env)
                .into_iter()
                .filter(|v| v["op"] != "same")
                .collect();
        }

        update(&mut |t: &mut crate::tasks::Task| {
            t.progress = 100.0;
            t.params["phase"] = json!("完成");
        });
        Ok(json!({ "installDir": install_dir, "cacheFile": cache_file.display().to_string(), "variables": variables, "verify": verify }))
    })();

    match result {
        Ok(r) => {
            mgr.update(id, &mut |t: &mut crate::tasks::Task| {
                t.status = "success".into();
                t.progress = 100.0;
                t.result = r.clone();
            });
            log("任务执行成功", "info");
        }
        Err(e) => {
            let cancelled = signal.lock().unwrap().cancelled;
            mgr.update(id, &mut |t: &mut crate::tasks::Task| {
                if cancelled {
                    t.status = "cancelled".into();
                    t.error = "任务已取消".into();
                } else {
                    t.status = "failed".into();
                    t.error = e.clone();
                }
            });
            log(&format!("任务失败：{}", e), "error");
        }
    }
}
