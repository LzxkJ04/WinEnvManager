'use strict'
/**
 * Windows 注册表环境变量读写
 * 用户变量：HKCU\Environment
 * 系统变量：HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment
 *
 * 普通权限：可读取用户 + 系统变量，不能写入系统变量
 * 管理员权限：用户变量、系统变量均可读写
 */
const { runPowerShell, runPowerShellJson, psQuote } = require('./ps')
const store = require('./store')

const DUMP_FN = `
function __dumpEnv([string]$p) {
  $list = New-Object System.Collections.ArrayList
  if (Test-Path -LiteralPath $p) {
    $k = Get-Item -LiteralPath $p
    foreach ($n in $k.GetValueNames()) {
      if ([string]::IsNullOrEmpty($n)) { continue }
      $v = $k.GetValue($n, '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      if ($null -eq $v) { $v = '' }
      if ($v -is [array]) { $v = ($v -join ';') }
      [void]$list.Add([pscustomobject]@{ name = [string]$n; value = [string]$v })
    }
  }
  return ,$list
}
`

function toArray(x) {
  if (x === null || x === undefined) return []
  return Array.isArray(x) ? x : [x]
}

/** 读取一份作用域下的全部环境变量 */
async function readScope(scope) {
  const key = scope === 'machine' ? store.MACHINE_PS_KEY : store.USER_PS_KEY
  const script = `${DUMP_FN}
( (__dumpEnv '${key}') | ForEach-Object { $_ } ) | ConvertTo-Json -Depth 4 -Compress`
  const raw = await runPowerShell(script, { timeout: 60000 })
  const text = (raw || '').trim()
  if (!text) return []
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (_) {
    return []
  }
  return toArray(parsed).map((item) => ({
    name: String(item.name || ''),
    value: item.value === null || item.value === undefined ? '' : String(item.value),
    scope
  }))
}

/** 读取全部环境变量 */
async function readAllEnv() {
  const [user, machine] = await Promise.all([readScope('user'), readScope('machine')])
  user.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  machine.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  return { user, machine }
}

/** 名称合法性校验：拦截 = % 等非法字符 */
function validateName(name) {
  const n = String(name == null ? '' : name).trim()
  if (!n) return { ok: false, message: '变量名称不能为空' }
  if (n.includes('=')) return { ok: false, message: '变量名称不能包含等号 “=”' }
  if (n.includes('%')) return { ok: false, message: '变量名称不能包含百分号 “%”' }
  if (/[\u0000-\u001f]/.test(n)) return { ok: false, message: '变量名称包含不可见控制字符' }
  if (n.length > 255) return { ok: false, message: '变量名称过长（超过 255 字符）' }
  if (n === 'Path' || n.toUpperCase() === 'PATH') return { ok: true, isPath: true }
  return { ok: true, isPath: false }
}

function pickKind(name, value) {
  const isPath = String(name).toUpperCase() === 'PATH'
  if (isPath) return 'ExpandString'
  return String(value).includes('%') ? 'ExpandString' : 'String'
}

/** 写入单个环境变量 */
async function writeValue(scope, name, value) {
  const check = validateName(name)
  if (!check.ok) throw new Error(check.message)

  const keyPath = scope === 'machine' ? store.MACHINE_PS_KEY : store.USER_PS_KEY
  const kind = pickKind(name, value)
  const script = `
$p = '${keyPath}'
if (-not (Test-Path -LiteralPath $p)) { New-Item -Path $p -Force | Out-Null }
Set-ItemProperty -LiteralPath $p -Name '${psQuote(name)}' -Value '${psQuote(value)}' -Type ${kind}
'ok'
`
  const out = await runPowerShell(script, { timeout: 60000 })
  if (!out.includes('ok')) throw new Error('写入注册表未返回预期结果')
  return true
}

/** 删除环境变量 */
async function deleteValue(scope, name) {
  const keyPath = scope === 'machine' ? store.MACHINE_PS_KEY : store.USER_PS_KEY
  const script = `
$p = '${keyPath}'
Remove-ItemProperty -LiteralPath $p -Name '${psQuote(name)}' -ErrorAction Stop
'ok'
`
  const out = await runPowerShell(script, { timeout: 60000 })
  if (!out.includes('ok')) throw new Error('删除注册表项未返回预期结果')
  return true
}

/** 批量写入（新增 / 修改 / 删除），返回逐项结果 */
async function applyChanges(changes) {
  const results = []
  for (const item of changes) {
    try {
      if (item.action === 'delete') {
        await deleteValue(item.scope, item.name)
      } else if (item.action === 'rename') {
        await writeValue(item.scope, item.newName, item.value)
        await deleteValue(item.scope, item.name)
      } else {
        await writeValue(item.scope, item.name, item.value)
      }
      results.push({ name: item.name, ok: true, action: item.action })
    } catch (err) {
      results.push({ name: item.name, ok: false, action: item.action, message: err.message })
    }
  }
  return results
}

/** 根据原始清单与逐项结果，构造反向回滚清单（事务模型：任一失败后恢复系统原状） */
function buildRollbackList(list, results) {
  return list
    .filter((item, idx) => results[idx] && results[idx].ok)
    .map((item) => {
      if (item.action === 'create') return { action: 'delete', scope: item.scope, name: item.name }
      if (item.action === 'rename') {
        return { action: 'rename', scope: item.scope, name: item.newName, newName: item.name, value: item.oldValue ?? '' }
      }
      // update / delete：写回原值
      return { action: 'update', scope: item.scope, name: item.name, value: item.oldValue ?? '' }
    })
}

/* PATH 校验选项：驱动器类型（60 秒缓存）+ 按设置的预分类 */
let driveTypeCache = { at: 0, map: null }

async function getDriveTypes() {
  if (driveTypeCache.map && Date.now() - driveTypeCache.at < 60000) return driveTypeCache.map
  try {
    const script = `[System.IO.DriveInfo]::GetDrives() | ForEach-Object { "$($_.Name.TrimEnd('\\'))=$($_.DriveType)" }`
    const raw = await runPowerShell(script, { timeout: 15000 })
    const map = {}
    for (const line of String(raw || '').split('\n')) {
      const m = line.trim().match(/^([A-Za-z]:)=(\w+)$/)
      if (m) map[m[1].toUpperCase()] = m[2]
    }
    driveTypeCache = { at: Date.now(), map }
    return map
  } catch {
    return driveTypeCache.map || {}
  }
}

/**
 * PATH 校验预分类（供 PATH 页与 PATH 性能检测共用）
 * 按「程序设置 → 扫描与校验」决定网络盘 / 可移动磁盘是否真实检测。
 * @returns [{ path, exists, type }] type: ok|missing|network|network-skipped|removable-skipped|ignored
 */
async function classifyPaths(dirs, opts = {}) {
  const cfg = opts.config || {}
  const detectNetwork = cfg.scanDetectNetworkDrive === true
  const detectRemovable = cfg.scanDetectRemovable !== false
  const ignoreDirs = (cfg.pathIgnoreDirs || []).map((d) => String(d).trim().replace(/[\\/]+$/, '').toLowerCase()).filter(Boolean)
  const isIgnored = (t) => {
    const s = String(t).trim().replace(/[\\/]+$/, '').toLowerCase()
    return ignoreDirs.some((g) => s === g || (g.endsWith('*') && s.startsWith(g.slice(0, -1))))
  }
  const out = []
  const needCheck = []
  const uncRe = /^\\\\[^\\]/
  for (const d of dirs || []) {
    const t = String(d).trim()
    if (!t) continue
    if (isIgnored(t)) {
      out.push({ path: t, exists: true, type: 'ignored' })
      continue
    }
    if (uncRe.test(t)) {
      if (!detectNetwork) {
        out.push({ path: t, exists: false, type: 'network-skipped' })
      } else {
        needCheck.push(t)
      }
      continue
    }
    if (!detectRemovable && /^[A-Za-z]:/.test(t)) {
      const types = await getDriveTypes()
      if (types[t.slice(0, 2).toUpperCase()] === 'Removable') {
        out.push({ path: t, exists: false, type: 'removable-skipped' })
        continue
      }
    }
    needCheck.push(t)
  }
  if (needCheck.length) {
    const chk = await checkPathsExist(needCheck)
    for (const c of chk) out.push({ ...c, type: c.exists ? 'ok' : 'missing' })
  }
  return out
}

/** 当前进程是否具备管理员权限 */async function isAdmin() {
  const script = `([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)`
  const out = await runPowerShell(script, { timeout: 20000 })
  return out.trim().toLowerCase().startsWith('true')
}

/** 批量校验路径是否存在 */
async function checkPathsExist(paths) {
  const list = toArray(paths).filter((p) => typeof p === 'string' && p.trim() !== '')
  if (list.length === 0) return []
  const lines = list.map((p) => `  '${psQuote(p)}'`).join(',' + String.fromCharCode(10))
  const script = `
$targets = @(
${lines}
)
$targets | ForEach-Object {
  $raw = $_
  try { $exp = [Environment]::ExpandEnvironmentVariables($raw) } catch { $exp = $raw }
  [pscustomobject]@{ path = $raw; expanded = $exp; exists = (Test-Path -LiteralPath $exp -PathType Container) }
} | ConvertTo-Json -Depth 4 -Compress
`
  const perPath = Math.min(60, Math.max(2, Number(store.readConfig().pathTimeoutSec) || 10))
  const timeout = Math.min(180000, Math.max(perPath * 1000, perPath * 1000 * Math.ceil(list.length / 40)))
  const raw = await runPowerShell(script, { timeout })
  const text = (raw || '').trim()
  if (!text) return []
  try {
    return toArray(JSON.parse(text)).map((r) => ({
      path: String(r.path),
      expanded: String(r.expanded),
      exists: !!r.exists
    }))
  } catch (_) {
    return []
  }
}

/** 解析带 %VAR% 的字符串 */
async function expandString(text) {
  const script = `[Environment]::ExpandEnvironmentVariables('${psQuote(text)}')`
  const out = await runPowerShell(script, { timeout: 20000 })
  return out.replace(/\r?\n$/, '')
}

/** 重启资源管理器，使新环境变量对部分程序生效 */
async function reloadExplorer() {
  const script = `
Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 1200
if (-not (Get-Process -Name explorer -ErrorAction SilentlyContinue)) {
  Start-Process explorer.exe
}
'ok'
`
  const out = await runPowerShell(script, { timeout: 60000 })
  return out.includes('ok')
}

/** 广播 WM_SETTINGCHANGE，让新进程立即读取到最新环境变量 */
async function broadcastChange() {
  const script = `
Add-Type -Namespace WEM -Name Native -MemberDefinition @"
[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
"@ -ErrorAction SilentlyContinue
$r = [UIntPtr]::Zero
[void][WEM.Native]::SendMessageTimeout([IntPtr]0xffff, 0x001A, [UIntPtr]::Zero, 'Environment', 2, 3000, [ref]$r)
'ok'
`
  try {
    const out = await runPowerShell(script, { timeout: 30000 })
    return out.includes('ok')
  } catch (_) {
    return false
  }
}

module.exports = {
  readAllEnv,
  readScope,
  writeValue,
  deleteValue,
  applyChanges,
  validateName,
  isAdmin,
  checkPathsExist,
  classifyPaths,
  getDriveTypes,
  buildRollbackList,
  expandString,
  reloadExplorer,
  broadcastChange,
  runPowerShellJson
}
