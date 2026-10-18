//! PowerShell 执行器：注册表读写等系统操作统一走 -EncodedCommand，规避中文乱码

use base64::Engine as _;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub fn ps_quote(s: &str) -> String {
    s.replace('\'', "''")
}

fn b64_utf16le(s: &str) -> String {
    let mut bytes = Vec::with_capacity(s.len() * 2 + 2);
    for u in s.encode_utf16() {
        bytes.extend_from_slice(&u.to_le_bytes());
    }
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// 运行 PowerShell 脚本，返回 stdout（脚本内部已强制 UTF-8 输出）
pub fn run_powershell(script: &str) -> Result<String, String> {
    let full = format!(
        "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $ErrorActionPreference='Stop';\n{}",
        script
    );
    let encoded = b64_utf16le(&full);

    let out = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", &encoded])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output()
        .map_err(|e| format!("启动 PowerShell 失败：{}", e))?;

    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        let msg = if stderr.trim().is_empty() { stdout.trim() } else { stderr.trim() };
        if msg.is_empty() {
            return Err(format!("PowerShell 退出码 {:?}", out.status.code()));
        }
        return Err(msg.lines().last().unwrap_or("执行失败").to_string());
    }
    Ok(stdout)
}

/// 运行 PowerShell 并忽略错误，返回 stdout 或空串
pub fn run_powershell_lossy(script: &str) -> String {
    run_powershell(script).unwrap_or_default()
}

#[cfg(windows)]
pub fn creation_flags(cmd: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x08000000);
}

#[cfg(not(windows))]
pub fn creation_flags(_cmd: &mut std::process::Command) {}

/// 扩展 %VAR%（使用当前进程环境）
pub fn expand_win(s: &str) -> String {
    let mut out = String::from(s);
    let mut guard = 0;
    while out.contains('%') && guard < 8 {
        guard += 1;
        let mut changed = false;
        let bytes: Vec<char> = out.chars().collect();
        let mut i = 0;
        let mut buf = String::new();
        while i < bytes.len() {
            if bytes[i] == '%' {
                if let Some(end) = (i + 1..bytes.len()).find(|&j| bytes[j] == '%') {
                    let name: String = bytes[i + 1..end].iter().collect();
                    if let Ok(v) = std::env::var(&name) {
                        buf.push_str(&v);
                        i = end + 1;
                        changed = true;
                        continue;
                    }
                }
            }
            buf.push(bytes[i]);
            i += 1;
        }
        out = buf;
        if !changed {
            break;
        }
    }
    out
}
