#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Deserialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use winreg::enums::*;
use winreg::RegKey;

/// 编译期嵌入的 Inno 静默安装引擎
const SETUP_EXE: &[u8] = include_bytes!("../payload/setup.exe");
const NEW_VERSION: &str = env!("CARGO_PKG_VERSION");

const REG_KEY: &str = r"SOFTWARE\WinEnvManager";
const DEFAULT_APP_DIR: &str = r"C:\Program Files\WinEnvManager";
const DEFAULT_USERDATA: &str = r"%LOCALAPPDATA%\WinEnvManager";

/// 运行中的安装引擎子进程（供取消）
struct EngineState(Mutex<Option<std::process::Child>>);

// ============================================================
// 注册表读取
// ============================================================

fn reg_get(name: &str) -> Option<String> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let key = hklm.open_subkey(REG_KEY).ok()?;
    key.get_value(name).ok()
}

fn installed_version() -> Option<String> {
    reg_get("Version")
}

fn installed_path() -> Option<String> {
    reg_get("InstallPath")
}

fn user_data_root() -> Option<String> {
    reg_get("UserDataRoot")
}

fn ver_tuple(v: &str) -> Vec<u64> {
    v.split('.')
        .map(|s| s.trim().parse::<u64>().unwrap_or(0))
        .collect()
}

fn cmp_ver(a: &str, b: &str) -> std::cmp::Ordering {
    let (va, vb) = (ver_tuple(a), ver_tuple(b));
    let n = va.len().max(vb.len());
    for i in 0..n {
        let x = va.get(i).copied().unwrap_or(0);
        let y = vb.get(i).copied().unwrap_or(0);
        if x != y {
            return x.cmp(&y);
        }
    }
    std::cmp::Ordering::Equal
}

// ============================================================
// 系统检测
// ============================================================

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SysInfo {
    win_build: u32,
    win_ok: bool,
    is_admin: bool,
    webview2: bool,
    installed_version: Option<String>,
    installed_path: Option<String>,
    user_data_root: Option<String>,
    downgrade: bool,   // 已装版本 > 本引导壳版本
    upgrade: bool,     // 已装版本 < 本引导壳版本
    same_version: bool,
    proc_running: bool,
    default_user_data: String,
}

fn webview2_installed() -> bool {
    for key in [
        r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    ] {
        if let Ok(k) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(key) {
            if let Ok(pv) = k.get_value::<String, _>("pv") {
                if !pv.is_empty() && pv != "0.0.0.0" {
                    return true;
                }
            }
        }
    }
    false
}

fn is_admin() -> bool {
    // HKLM\SECURITY 即使已提权也会拒绝打开，不能用来判断管理员。
    // 这里读当前进程令牌的 TokenElevation。
    unsafe {
        let mut token: isize = 0;
        if OpenProcessToken(GetCurrentProcess(), 0x0008, &mut token) == 0 {
            return false;
        }
        let mut elevated: u32 = 0;
        let mut ret_len: u32 = 0;
        let ok = GetTokenInformation(
            token,
            20, // TokenElevation
            &mut elevated as *mut u32 as *mut u8,
            4,
            &mut ret_len,
        );
        CloseHandle(token);
        ok != 0 && elevated != 0
    }
}

fn proc_running() -> bool {
    std::process::Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq WinEnvManager.exe", "/NH"])
        .creation_flags(0x08000000)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase().contains("winenvmanager"))
        .unwrap_or(false)
}

#[tauri::command]
fn sys_info() -> SysInfo {
    let build: u32 = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion")
        .ok()
        .and_then(|k| k.get_value::<String, _>("CurrentBuildNumber").ok())
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let inst = installed_version();
    let downgrade = inst.as_deref().map(|v| cmp_ver(v, NEW_VERSION) == std::cmp::Ordering::Greater).unwrap_or(false);
    let upgrade = inst.as_deref().map(|v| cmp_ver(v, NEW_VERSION) == std::cmp::Ordering::Less).unwrap_or(true);
    let same_version = inst.as_deref().map(|v| cmp_ver(v, NEW_VERSION) == std::cmp::Ordering::Equal).unwrap_or(false);
    SysInfo {
        win_build: build,
        win_ok: build >= 18362,
        is_admin: is_admin(),
        webview2: webview2_installed(),
        downgrade,
        upgrade,
        same_version,
        proc_running: proc_running(),
        installed_version: inst,
        installed_path: installed_path(),
        user_data_root: user_data_root(),
        default_user_data: std::env::var("LOCALAPPDATA")
            .map(|p| format!("{p}\\WinEnvManager"))
            .unwrap_or_else(|_| r"C:\Users\Administrator\AppData\Local\WinEnvManager".into()),
    }
}

#[tauri::command]
fn disk_free(path: String) -> Result<(u64, u64), String> {
    // 取盘符前缀
    let root = if path.len() >= 2 && path.as_bytes()[1] == b':' {
        format!("{}\\", &path[..2])
    } else {
        return Err("路径缺少盘符".into());
    };
    let mut root_w: Vec<u16> = root.encode_utf16().collect();
    root_w.push(0);
    let mut free: u64 = 0;
    let mut total: u64 = 0;
    let mut _dummy: u64 = 0;
    let ret = unsafe {
        GetDiskFreeSpaceExW(
            root_w.as_ptr(),
            &mut _dummy,
            &mut total,
            &mut free,
        )
    };
    if ret == 0 {
        return Err(format!("无法读取磁盘空间: {}", root));
    }
    Ok((free, total))
}

/// WebView2 缺失时一键安装（下载 Evergreen Bootstrapper 后静默执行）
#[tauri::command]
fn webview2_install(window: tauri::Window) -> Result<(), String> {
    let dir = std::env::temp_dir().join("winenv_bootstrapper");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let exe = dir.join("MicrosoftEdgeWebview2Setup.exe");
    let _ = window.emit("wv2phase", "downloading");
    let dl = std::process::Command::new("curl")
        .args(["-sL", "--max-time", "300", "-o"])
        .arg(&exe)
        .arg("https://go.microsoft.com/fwlink/?linkid=2124703")
        .creation_flags(0x08000000)
        .output();
    match dl {
        Ok(o) if o.status.success() && exe.metadata().map(|m| m.len() > 1_000_000).unwrap_or(false) => {}
        _ => return Err("WebView2 运行时下载失败，请检查网络后重试".into()),
    }
    let _ = window.emit("wv2phase", "installing");
    let out = std::process::Command::new(&exe)
        .args(["/silent", "/install"])
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| format!("WebView2 安装程序启动失败: {e}"))?;
    if !out.status.success() || !webview2_installed() {
        return Err("WebView2 安装未成功，请手动安装后重试".into());
    }
    let _ = window.emit("wv2phase", "done");
    Ok(())
}

#[tauri::command]
fn kill_proc() -> bool {
    std::process::Command::new("taskkill")
        .args(["/F", "/IM", "WinEnvManager.exe", "/T"])
        .creation_flags(0x08000000)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[tauri::command]
fn install_log() -> String {
    let log = std::env::temp_dir()
        .join("winenv_bootstrapper")
        .join("install.log");
    std::fs::read_to_string(&log).unwrap_or_else(|_| "暂无安装日志".into())
}

#[tauri::command]
fn open_path(path: String) {
    let _ = std::process::Command::new("explorer").arg(&path).spawn();
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn launch_app() -> Result<(), String> {
    let exe = PathBuf::from(installed_path().unwrap_or_else(|| DEFAULT_APP_DIR.into()))
        .join("WinEnvManager.exe");
    std::process::Command::new(&exe)
        .spawn()
        .map_err(|e| format!("启动失败: {e}"))?;
    Ok(())
}

// ============================================================
// 迁移助手
// ============================================================

fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ty = entry.file_type().map_err(|e| e.to_string())?;
        let target = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), &target).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn migrate_data(src: String, dst: String, delete_old: bool) -> Result<(), String> {
    let s = PathBuf::from(&src);
    let d = PathBuf::from(&dst);
    if !s.exists() {
        return Err(format!("源目录不存在: {src}"));
    }
    // 只迁移用户业务数据子目录
    for sub in ["config", "exports", "snapshots", "presets"] {
        let ss = s.join(sub);
        if ss.exists() {
            copy_dir_recursive(&ss, &d.join(sub))?;
        }
    }
    if delete_old {
        std::fs::remove_dir_all(&s).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ============================================================
// 静默安装
// ============================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallOpts {
    app_dir: String,
    user_data: String,
    components: Vec<String>,
    tasks: Vec<String>,
    enable_log: bool,
}

fn extract_engine() -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join("winenv_bootstrapper");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let exe = dir.join("setup-engine.exe");
    std::fs::write(&exe, SETUP_EXE).map_err(|e| e.to_string())?;
    Ok(exe)
}

#[tauri::command]
async fn run_install(
    app: tauri::AppHandle,
    window: tauri::Window,
    opts: InstallOpts,
) -> Result<(), String> {
    // 降级拦截
    if let Some(old) = installed_version() {
        if cmp_ver(&old, NEW_VERSION) == std::cmp::Ordering::Greater {
            let _ = window.emit("phase", "failed");
            return Err(format!("已安装 v{old} 高于本包 v{NEW_VERSION}，禁止降级"));
        }
    }
    let engine = extract_engine().map_err(|e| format!("解压安装引擎失败: {e}"))?;
    let log = std::env::temp_dir()
        .join("winenv_bootstrapper")
        .join("install.log");
    let _ = std::fs::remove_file(&log);

    let mut cmd_args = vec![
        "/VERYSILENT".to_string(),
        "/SUPPRESSMSGBOXES".to_string(),
        "/NORESTART".to_string(),
        format!("/DIR={}", opts.app_dir),
        format!("/USERDATA={}", opts.user_data),
    ];
    if !opts.components.is_empty() {
        cmd_args.push(format!("/COMPONENTS={}", opts.components.join(",")));
    }
    if !opts.tasks.is_empty() {
        cmd_args.push(format!("/TASKS={}", opts.tasks.join(",")));
    }
    // 进度页靠解析日志驱动，始终写日志
    cmd_args.push(format!("/LOG={}", log.display()));
    let _ = opts.enable_log;

    let _ = window.emit("phase", "installing");
    let app2 = app.clone();
    let w2 = window.clone();
    let child = std::process::Command::new(&engine)
        .args(&cmd_args)
        .creation_flags(0x08000000)
        .spawn()
        .map_err(|e| format!("安装引擎启动失败: {e}"))?;

    *app.state::<EngineState>().0.lock().unwrap() = Some(child);

    // 后台等待线程：结束即回发事件
    std::thread::spawn(move || {
        let mut code: Option<i32> = None;
        loop {
            let st = app2.state::<EngineState>();
            let mut guard = st.0.lock().unwrap();
            match guard.as_mut() {
                Some(c) => match c.try_wait() {
                    Ok(Some(status)) => { code = status.code(); break; }
                    Ok(None) => {}
                    Err(_) => { code = Some(-1); break; }
                },
                None => { code = Some(-1); break; }
            }
            drop(guard);
            drop(st);
            std::thread::sleep(std::time::Duration::from_millis(300));
        }
        let ok = code == Some(0) && installed_version().is_some();
        if ok {
            if let Some(dir) = installed_path() {
                install_self(&dir);
            }
        }
        let _ = w2.emit("phase", if ok { "done" } else { "failed" });
    });
    Ok(())
}

#[tauri::command]
fn cancel_install(app: tauri::AppHandle) -> bool {
    let st = app.state::<EngineState>();
    let mut guard = st.0.lock().unwrap();
    if let Some(child) = guard.as_mut() {
        let _ = child.kill();
        *guard = None;
        true
    } else {
        false
    }
}

/// 读取 Inno 日志尾部 → 前端轮询渲染进度
#[tauri::command]
fn read_progress() -> (i32, String) {
    let log = std::env::temp_dir()
        .join("winenv_bootstrapper")
        .join("install.log");
    let content = std::fs::read_to_string(&log).unwrap_or_default();
    let extracts = content.matches("Extracting ").count();
    let done = content.contains("Installation process succeeded");
    let pct = if done {
        100
    } else if content.contains("Starting the installation process") {
        (18 + (extracts as i32) * 6).min(90)
    } else if content.contains("Log opened") {
        8
    } else {
        2
    };
    let status = if done {
        "安装完成".to_string()
    } else if let Some(line) = content.lines().rev().find(|l| !l.trim().is_empty()) {
        let l = line.trim();
        if l.contains("Extracting ") {
            "正在复制程序文件".to_string()
        } else if l.contains("Creating directory") || l.contains("Directory for") {
            "创建目录结构".to_string()
        } else if l.contains("uninstall key") || l.contains("Writing uninstall") {
            "写入注册表配置".to_string()
        } else {
            "正在准备".to_string()
        }
    } else {
        "等待安装引擎".to_string()
    };
    (pct, status)
}

// ============================================================
// 静默卸载
// ============================================================

#[tauri::command]
async fn run_uninstall(
    _app: tauri::AppHandle,
    window: tauri::Window,
    delete_data: bool,
    user_data_dir: Option<String>,
) -> Result<(), String> {
    if installed_version().is_none() {
        let _ = window.emit("phase", "failed");
        return Err("未检测到已安装的 WinEnv管家".into());
    }
    let app_dir = installed_path().unwrap_or_else(|| DEFAULT_APP_DIR.into());
    let uninst = PathBuf::from(&app_dir).join("unins000.exe");
    if !uninst.exists() {
        let _ = window.emit("phase", "failed");
        return Err(format!("卸载器不存在: {}", uninst.display()));
    }
    let _ = window.emit("phase", "uninstalling");

    let out = std::process::Command::new(&uninst)
        .args(["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"])
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| format!("卸载器启动失败: {e}"))?;

    if !out.status.success() {
        let _ = window.emit("phase", "failed");
        return Err(format!("卸载器退出码: {:?}", out.status.code()));
    }
    // 用户数据删除由引导壳负责
    if delete_data {
        if let Some(ud) = user_data_dir.or_else(user_data_root) {
            let _ = std::fs::remove_dir_all(&ud);
        }
    }
    let _ = window.emit("phase", "done");
    Ok(())
}

/// 安装成功后把引导壳自己复制到程序目录，开始菜单「卸载」才能再打开卸载向导。
fn install_self(app_dir: &str) {
    if let Ok(me) = std::env::current_exe() {
        let dest = PathBuf::from(app_dir).join("winenv-setup.exe");
        if me != dest {
            let _ = std::fs::copy(&me, &dest);
        }
    }
}

fn flag(name: &str) -> bool {
    std::env::args().any(|a| {
        a.trim_start_matches(['/', '-']).eq_ignore_ascii_case(name)
    })
}

fn arg_value(name: &str) -> Option<String> {
    let prefix = format!("{}=", name.to_ascii_lowercase());
    std::env::args().find_map(|a| {
        let bare = a.trim_start_matches(['/', '-']).to_ascii_lowercase();
        let orig = a.trim_start_matches(['/', '-']);
        if bare.starts_with(&prefix) {
            Some(orig[prefix.len()..].trim_matches('"').to_string())
        } else {
            None
        }
    })
}

/// 无界面安装：写日志后以退出码结束，供脚本调用。
fn silent_install() -> i32 {
    let app_dir = arg_value("DIR").unwrap_or_else(|| DEFAULT_APP_DIR.into());
    let user_data = arg_value("USERDATA").unwrap_or_else(|| {
        std::env::var("LOCALAPPDATA")
            .map(|p| format!("{p}\\WinEnvManager"))
            .unwrap_or_else(|_| r"C:\Users\Administrator\AppData\Local\WinEnvManager".into())
    });
    let blocked = ["\\windows\\", "\\windows", "\\program files\\windows"];
    let low = app_dir.to_ascii_lowercase();
    if blocked.iter().any(|b| low.contains(b)) || low == user_data.to_ascii_lowercase() {
        eprintln!("拒绝安装：目录不安全或与用户数据目录相同");
        return 2;
    }
    let engine = match extract_engine() {
        Ok(p) => p,
        Err(e) => { eprintln!("{e}"); return 3; }
    };
    let log = std::env::temp_dir().join("winenv_bootstrapper").join("install.log");
    let mut args = vec![
        "/VERYSILENT".into(),
        "/SUPPRESSMSGBOXES".into(),
        "/NORESTART".into(),
        format!("/DIR={app_dir}"),
        format!("/USERDATA={user_data}"),
        format!("/LOG={}", log.display()),
    ];
    if let Some(c) = arg_value("COMPONENTS") {
        args.push(format!("/COMPONENTS={c}"));
    }
    if let Some(t) = arg_value("TASKS") {
        args.push(format!("/TASKS={t}"));
    }
    let status = std::process::Command::new(&engine)
        .args(&args)
        .creation_flags(0x08000000)
        .status();
    match status {
        Ok(s) if s.success() && installed_version().is_some() => {
            install_self(&app_dir);
            0
        }
        Ok(s) => s.code().unwrap_or(1),
        Err(_) => 4,
    }
}

fn silent_uninstall() -> i32 {
    let app_dir = installed_path().unwrap_or_else(|| DEFAULT_APP_DIR.into());
    let uninst = PathBuf::from(&app_dir).join("unins000.exe");
    if !uninst.exists() {
        return 5;
    }
    let ok = std::process::Command::new(&uninst)
        .args(["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"])
        .creation_flags(0x08000000)
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if ok && flag("DELETEDATA") {
        if let Some(ud) = user_data_root() {
            let _ = std::fs::remove_dir_all(ud);
        }
    }
    if ok { 0 } else { 6 }
}

fn print_help() {
    println!("WinEnv管家 安装向导");
    println!("  （无参数）                 打开图形安装向导");
    println!("  /uninstall                 打开图形卸载向导");
    println!("  /VERYSILENT                无界面安装");
    println!("  /DIR=路径                  程序目录");
    println!("  /USERDATA=路径             用户数据目录");
    println!("  /COMPONENTS=main,cli       组件");
    println!("  /TASKS=desktopicon         附加任务");
    println!("  /VERYSILENT /uninstall     无界面卸载");
    println!("  /DELETEDATA                卸载时同时删除用户数据");
}

fn main() {
    if flag("help") || flag("?") {
        print_help();
        std::process::exit(0);
    }
    if flag("VERYSILENT") || flag("SILENT") {
        let code = if flag("uninstall") { silent_uninstall() } else { silent_install() };
        std::process::exit(code);
    }
    let uninstall_mode = flag("uninstall") || flag("u");
    tauri::Builder::default()
        .setup(move |app| {
            if uninstall_mode {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.set_title("WinEnv管家 卸载向导");
                    let _ = w.eval("window.__uninstallMode=true; if (window.enterUninstall) window.enterUninstall();");
                }
            }
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .manage(EngineState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            sys_info,
            disk_free,
            webview2_install,
            kill_proc,
            open_path,
            install_log,
            launch_app,
            quit_app,
            migrate_data,
            run_install,
            cancel_install,
            read_progress,
            run_uninstall
        ])
        .run(tauri::generate_context!())
        .expect("error while running bootstrapper");
}

// GetDiskFreeSpaceExW
#[link(name = "kernel32")]
unsafe extern "system" {
    fn GetDiskFreeSpaceExW(
        lpDirectoryName: *const u16,
        lpFreeBytesAvailableToCaller: *mut u64,
        lpTotalNumberOfBytes: *mut u64,
        lpTotalNumberOfFreeBytes: *mut u64,
    ) -> i32;
    fn GetCurrentProcess() -> isize;
    fn CloseHandle(handle: isize) -> i32;
}

#[link(name = "advapi32")]
unsafe extern "system" {
    fn OpenProcessToken(process: isize, access: u32, token: *mut isize) -> i32;
    fn GetTokenInformation(
        token: isize,
        class: u32,
        info: *mut u8,
        len: u32,
        ret: *mut u32,
    ) -> i32;
}

// CREATE_NO_WINDOW = 0x08000000
#[cfg(windows)]
use std::os::windows::process::CommandExt;
