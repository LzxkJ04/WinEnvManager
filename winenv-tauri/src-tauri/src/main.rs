//! WinEnv管家 · Tauri 主程序

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod analyze;
mod catalog;
mod commands;
mod deploy;
mod envset;
mod meta;
mod ops;
mod parse;
mod ps;
mod registry;
mod rules;
mod scanner;
mod store;
mod tasks;

use serde_json::json;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

pub struct AppState {
    pub draft: Arc<Mutex<serde_json::Value>>,
    pub tasks: tasks::TaskManager,
}

fn main() {
    store::ensure_all_dirs();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(AppState {
            draft: Arc::new(Mutex::new(load_draft())),
            tasks: tasks::TaskManager::new(),
        })
        .invoke_handler(tauri::generate_handler![
            // 环境变量
            commands::read_env, commands::read_env_detailed, commands::apply_changes,
            commands::write_one, commands::is_admin, commands::reload_explorer,
            commands::broadcast_change, commands::validate_paths, commands::validate_pathext,
            commands::expand_string, commands::path_items, commands::save_path_items,
            // 元数据
            commands::meta_all, commands::meta_set, commands::meta_remove, commands::meta_history,
            commands::meta_path_set, commands::meta_toggle_favorite, commands::meta_set_tags,
            commands::meta_set_locked, commands::meta_mark_sensitive,
            // 分析
            commands::sensitive_scan, commands::var_refs, commands::broken_refs,
            commands::external_check, commands::registry_acl, commands::terminal_env,
            commands::path_perf, commands::storage_stats,
            // 快照
            commands::create_snapshot, commands::list_snapshots, commands::read_snapshot,
            commands::delete_snapshot, commands::compare_env, commands::prepare_restore,
            commands::set_baseline, commands::get_baseline,
            // 备份
            commands::create_backup, commands::list_backups, commands::delete_backup,
            commands::read_backup, commands::read_text_file, commands::parse_text,
            commands::prune_backups, commands::set_backup_tag, commands::copy_to_remote,
            // 开发环境
            commands::list_catalog, commands::get_catalog_item, commands::resolve_url,
            commands::scan_env, commands::cancel_scan, commands::validate_item,
            commands::validate_batch, commands::build_plan, commands::create_deploy_task,
            commands::create_uninstall_task, commands::list_ignore, commands::add_ignore,
            commands::remove_ignore, commands::run_audit, commands::open_dev_dir,
            commands::cache_stats, commands::clear_cache,
            // 规则
            commands::list_rules_cmd, commands::save_rule, commands::delete_rule,
            commands::export_rules, commands::import_rules,
            // 任务
            commands::list_tasks, commands::get_task, commands::cancel_task,
            commands::pause_task, commands::resume_task, commands::retry_task,
            commands::clear_finished_tasks, commands::pause_all_tasks,
            commands::resume_all_tasks, commands::set_concurrency,
            // 配置集
            commands::envset_list, commands::envset_get, commands::envset_create,
            commands::envset_update, commands::envset_delete, commands::envset_duplicate,
            commands::envset_export, commands::envset_import, commands::envset_export_file,
            commands::envset_list_mutex, commands::envset_create_mutex,
            commands::envset_update_mutex, commands::envset_delete_mutex,
            commands::envset_assign_mutex, commands::envset_members, commands::envset_templates,
            commands::envset_template, commands::envset_ignore_prompt, commands::launch_terminal,
            commands::start_watch, commands::stop_watch,
            // 文件
            commands::pick_folder, commands::pick_file, commands::pick_save,
            commands::read_text_file, commands::write_text_file,
            // 配置
            commands::get_config, commands::set_config, commands::write_log,
            commands::list_logs, commands::clear_logs, commands::open_log_dir,
            // 应用
            commands::app_info, commands::set_auto_launch, commands::get_auto_launch,
            commands::win_minimize, commands::win_close, commands::win_hide,
            // 工具
            commands::elevate, commands::open_reg_env, commands::open_native_panel,
            commands::open_folder, commands::open_external, commands::show_in_folder,
            commands::env_summary, commands::which_command, commands::reset_env_defaults,
            commands::list_executables
        ])
        .setup(|app| {
            store::write_log("info", "程序启动", Some(json!({
                "version": app.package_info().version.to_string(),
                "exe": std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_default()
            })));

            // 外部注册表变更检测（30 秒轮询）
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(30));
                let cfg = store::read_config();
                if cfg["detectExternal"].as_bool() == Some(false) {
                    continue;
                }
                if let Ok(fp) = tauri::async_runtime::block_on(ops::env_fingerprint()) {
                    let last = meta::get_external();
                    let old = last["lastHash"].as_str().unwrap_or("");
                    if !old.is_empty() && old != fp {
                        let _ = handle.emit("env:external-changed", json!({}));
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动 WinEnv管家 失败");
}

fn load_draft() -> serde_json::Value {
    let mut d = store::read_json_file(
        &store::app_data_dir().join("draft.json"),
        json!({ "working": { "user": [], "machine": [] }, "changeMeta": {} }),
    );
    if d["working"].is_null() {
        d["working"] = json!({ "user": [], "machine": [] });
    }
    d
}
