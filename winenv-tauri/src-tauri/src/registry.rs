//! 注册表读写：全部通过 PowerShell，写入保持 REG_EXPAND_SZ 类型

use serde::{Deserialize, Serialize};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub const USER_PS_KEY: &str = "HKCU:\\Environment";
pub const MACHINE_PS_KEY: &str = "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvVar {
    pub name: String,
    pub value: String,
    pub scope: String,
}

pub fn ps_key(scope: &str) -> &'static str {
    if scope == "machine" {
        MACHINE_PS_KEY
    } else {
        USER_PS_KEY
    }
}

pub fn is_admin() -> bool {
    let s = crate::ps::run_powershell(
        "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
    )
    .unwrap_or_default();
    s.trim().eq_ignore_ascii_case("true")
}

/// 读取某个作用域的全部环境变量
pub fn read_scope(scope: &str) -> Result<Vec<EnvVar>, String> {
    let script = format!(
        r#"$k = Get-Item -LiteralPath '{}'
$out = New-Object System.Collections.ArrayList
foreach ($n in $k.GetValueNames()) {{
  $raw = $k.GetValue($n, '', 'DoNotExpandEnvironmentNames')
  $kind = $k.GetValueKind($n)
  if ($kind -ne [Microsoft.Win32.RegistryValueKind]::String -and $kind -ne [Microsoft.Win32.RegistryValueKind]::ExpandString) {{ continue }}
  [void]$out.Add([pscustomobject]@{{ name = $n; value = [string]$raw }})
}}
@($out) | ConvertTo-Json -Depth 3 -Compress
"#,
        ps_key(scope)
    );
    let raw = crate::ps::run_powershell(&script)?;
    let text = raw.trim();
    if text.is_empty() || text == "[]" {
        return Ok(vec![]);
    }
    let parsed: serde_json::Value = serde_json::from_str(text)
        .map_err(|e| format!("解析注册表数据失败：{}", e))?;
    let mut out = Vec::new();
    match parsed {
        serde_json::Value::Array(list) => {
            for item in list {
                if let (Some(n), Some(v)) = (item["name"].as_str(), item["value"].as_str()) {
                    out.push(EnvVar { name: n.to_string(), value: v.to_string(), scope: scope.to_string() });
                }
            }
        }
        serde_json::Value::Object(_) => {
            if let (Some(n), Some(v)) = (parsed["name"].as_str(), parsed["value"].as_str()) {
                out.push(EnvVar { name: n.to_string(), value: v.to_string(), scope: scope.to_string() });
            }
        }
        _ => {}
    }
    Ok(out)
}

pub fn read_all() -> Result<serde_json::Value, String> {
    let user = read_scope("user")?;
    let machine = read_scope("machine")?;
    let admin = is_admin();
    Ok(serde_json::json!({
        "user": user,
        "machine": machine,
        "admin": admin,
        "readAt": chrono::Utc::now().timestamp_millis()
    }))
}

fn value_kind(value: &str) -> &'static str {
    if value.contains('%') {
        "ExpandString"
    } else {
        "String"
    }
}

pub fn write_value(scope: &str, name: &str, value: &str) -> Result<(), String> {
    if name.is_empty() || name.contains('=') || name.contains('%') {
        return Err(format!("变量名非法：{}", name));
    }
    let script = format!(
        "New-ItemProperty -LiteralPath '{}' -Name '{}' -Value '{}' -PropertyType {} -Force | Out-Null",
        ps_key(scope),
        crate::ps::ps_quote(name),
        crate::ps::ps_quote(value),
        value_kind(value)
    );
    crate::ps::run_powershell(&script)?;
    Ok(())
}

pub fn delete_value(scope: &str, name: &str) -> Result<(), String> {
    let script = format!(
        "Remove-ItemProperty -LiteralPath '{}' -Name '{}' -ErrorAction Stop",
        ps_key(scope),
        crate::ps::ps_quote(name)
    );
    crate::ps::run_powershell(&script)?;
    Ok(())
}

/// 批量应用变更：[{action, scope, name, value}]
pub fn apply_changes(changes: &[serde_json::Value]) -> Result<Vec<serde_json::Value>, String> {
    let mut results = Vec::new();
    for c in changes {
        let action = c["action"].as_str().unwrap_or("");
        let scope = c["scope"].as_str().unwrap_or("user");
        let name = c["name"].as_str().unwrap_or("");
        let value = c["value"].as_str().unwrap_or("");
        let ok = match action {
            "delete" => delete_value(scope, name).is_ok(),
            "create" | "update" => write_value(scope, name, value).is_ok(),
            "rename" => {
                let new_name = c["newName"].as_str().unwrap_or(name);
                let old = c["oldValue"].as_str().unwrap_or(value);
                delete_value(scope, name).is_ok() && write_value(scope, new_name, old).is_ok()
            }
            _ => false,
        };
        results.push(serde_json::json!({
            "name": name, "ok": ok, "action": action,
            "message": if ok { "" } else { "写入失败" }
        }));
    }
    let _ = broadcast_change();
    Ok(results)
}

pub fn broadcast_change() -> Result<(), String> {
    let _ = crate::ps::run_powershell(
        "Add-Type -Namespace Win32 -Name NativeMethods -MemberDefinition '[DllImport(\"user32.dll\", SetLastError = true, CharSet = CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);'; \
$r=[UIntPtr]::Zero; \
[Win32.NativeMethods]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$r)",
    );
    Ok(())
}

pub fn reload_explorer() -> Result<(), String> {
    let _ = std::process::Command::new("taskkill")
        .args(["/F", "/IM", "explorer.exe"])
        .creation_flags(0x08000000)
        .output();
    std::thread::sleep(std::time::Duration::from_millis(600));
    let _ = std::process::Command::new("cmd")
        .args(["/C", "start", "explorer.exe"])
        .creation_flags(0x08000000)
        .spawn();
    Ok(())
}

/// 校验目录是否存在（支持 %VAR%）
pub fn check_paths_exist(paths: &[String]) -> Vec<serde_json::Value> {
    let list = paths
        .iter()
        .map(|p| format!("'{}'", crate::ps::ps_quote(&crate::ps::expand_win(p))))
        .collect::<Vec<_>>()
        .join(",");
    if list.is_empty() {
        return vec![];
    }
    let script = format!(
        "$paths = @({list})
@($paths) | ForEach-Object {{ [pscustomobject]@{{ path = $_; exists = (Test-Path -LiteralPath $_ -PathType Container) }} }} | ConvertTo-Json -Depth 3 -Compress
"
    );
    let raw = crate::ps::run_powershell(&script).unwrap_or_default();
    parse_array(&raw, |item| {
        serde_json::json!({
            "path": item["path"].as_str().unwrap_or(""),
            "exists": item["exists"].as_bool().unwrap_or(false)
        })
    })
}

/// 把 ConvertTo-Json 输出统一解析为数组（单对象也会被包装）
pub fn parse_array<F>(text: &str, mut f: F) -> Vec<serde_json::Value>
where
    F: FnMut(&serde_json::Value) -> serde_json::Value,
{
    let t = text.trim();
    if t.is_empty() {
        return vec![];
    }
    let parsed: serde_json::Value = match serde_json::from_str(t) {
        Ok(v) => v,
        Err(_) => return vec![],
    };
    match parsed {
        serde_json::Value::Array(list) => list.iter().map(|x| f(x)).collect(),
        obj @ serde_json::Value::Object(_) => vec![f(&obj)],
        _ => vec![],
    }
}

/// PATH 校验
pub fn validate_paths(paths: &[String]) -> Result<serde_json::Value, String> {
    let trimmed: Vec<String> = paths
        .iter()
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect();
    let result = check_paths_exist(&trimmed);
    let invalid: Vec<String> = result
        .iter()
        .filter(|r| !r["exists"].as_bool().unwrap_or(false))
        .filter_map(|r| r["path"].as_str().map(|s| s.to_string()))
        .collect();
    Ok(serde_json::json!({ "result": result, "invalid": invalid }))
}

/// 展开 %VAR%（以注册表真实值为准）
pub fn expand_string(text: &str) -> Result<String, String> {
    let script = format!(
        "[Environment]::ExpandEnvironmentVariables('{}')",
        crate::ps::ps_quote(text)
    );
    Ok(crate::ps::run_powershell(&script)?.trim_end().to_string())
}
