'use strict'
/**
 * 通用注册表底层服务（regsvc）
 *
 * 与 registry.js 的分工：
 *   registry.js  —— 只服务环境变量两个分支（HKCU\Environment、HKLM\...\Environment），
 *                   供原有环境变量 / 快照 / 配置集链路使用，保持不变。
 *   regsvc.js    —— 通用注册表浏览、键值读写、导入导出、备份对比，
 *                   供新增的注册表模块使用。
 *
 * 实现要点：
 * - 一律走 PowerShell -EncodedCommand（复用 lib/ps.js），避免中文与引号问题。
 * - 输出统一 UTF-8，回读按 UTF-8 解析。
 * - 读取键值时保留原始类型（REG_SZ / REG_EXPAND_SZ / REG_MULTI_SZ / REG_DWORD /
 *   REG_QWORD / REG_BINARY / REG_NONE），不做降级转换。
 * - 写 REG_EXPAND_SZ 必须用 ExpandString，否则会降级成 REG_SZ。
 */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { runPowerShell, runPowerShellJson, psQuote, wrapJson } = require('./ps')
const store = require('./store')

/* ------------------------------ 常量 ------------------------------ */

/** 根项短名 => PowerShell PSDrive 路径前缀 */
const ROOTS = {
  HKCR: 'Registry::HKEY_CLASSES_ROOT',
  HKCU: 'Registry::HKEY_CURRENT_USER',
  HKLM: 'Registry::HKEY_LOCAL_MACHINE',
  HKU: 'Registry::HKEY_USERS',
  HKCC: 'Registry::HKEY_CURRENT_CONFIG'
}

/** 环境变量所在的两个注册表路径（短名形式） */
const ENV_PATHS = {
  user: 'HKCU\\Environment',
  machine: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'
}

/** 需要管理员权限才能写入的根项 */
const ADMIN_ROOTS = new Set(['HKLM', 'HKCR', 'HKU', 'HKCC'])

const VALUE_TYPES = [
  'REG_SZ', 'REG_EXPAND_SZ', 'REG_MULTI_SZ', 'REG_DWORD', 'REG_QWORD', 'REG_BINARY', 'REG_NONE'
]

/* --------------------------- 路径处理 --------------------------- */

/**
 * 规范化用户输入的注册表路径：去掉尾部反斜杠、统一根项短名。
 * 接受 HKCU\Environment / HKEY_CURRENT_USER\Environment / Registry::HKEY_CURRENT_USER\Environment
 * @param {string} raw
 * @returns {{ ok: boolean, root?: string, sub?: string, full?: string, psPath?: string, message?: string }}
 */
function parsePath(raw) {
  const text = String(raw == null ? '' : raw).trim()
  if (!text) return { ok: false, message: '注册表路径不能为空' }
  const t = text.replace(/^Registry::/i, '').replace(/\//g, '\\').replace(/\\+$/, '')
  const up = t.toUpperCase()
  let root = ''
  let rest = ''
  for (const [short, long] of Object.entries(ROOTS)) {
    // 比较与截取都要用去掉 "Registry::" 后的长名，否则长度不一致会切错位置
    const longName = long.replace(/^Registry::/i, '')
    const longUp = longName.toUpperCase()
    if (up === short) { root = short; rest = ''; break }
    if (up === longUp) { root = short; rest = ''; break }
    if (up.startsWith(short + '\\')) { root = short; rest = t.slice(short.length + 1); break }
    if (up.startsWith(longUp + '\\')) { root = short; rest = t.slice(longName.length + 1); break }
  }
  if (!root) return { ok: false, message: `无法识别的注册表根项：${text.slice(0, 60)}` }
  return {
    ok: true,
    root,
    sub: rest,
    full: rest ? `${root}\\${rest}` : root,
    psPath: rest ? `${ROOTS[root]}\\${rest}` : ROOTS[root]
  }
}

/** 拼接子项完整路径 */
function joinPath(base, child) {
  const b = String(base || '').replace(/\\+$/, '')
  const c = String(child || '').replace(/^\\+/, '').replace(/\\+$/, '')
  if (!c) return b
  return `${b}\\${c}`
}

/** 取父路径；根项返回 null */
function parentPath(full) {
  const p = parsePath(full)
  if (!p.ok) return null
  if (!p.sub) return null
  const idx = p.sub.lastIndexOf('\\')
  if (idx < 0) return p.root
  return `${p.root}\\${p.sub.slice(0, idx)}`
}

/** 名称合法性：注册表键名不允许反斜杠，不允许空；长度上限 255 */
function validateKeyName(name) {
  const n = String(name == null ? '' : name).trim()
  if (!n) return { ok: false, message: '名称不能为空' }
  if (n.length > 255) return { ok: false, message: '名称不能超过 255 个字符' }
  if (/[\\]/.test(n)) return { ok: false, message: '名称不能包含反斜杠 \\' }
  if (/[\u0000-\u001f]/.test(n)) return { ok: false, message: '名称不能包含控制字符' }
  return { ok: true, value: n }
}

/* --------------------------- 权限 --------------------------- */

/** 当前进程是否有管理员权限（带短缓存，避免频繁起进程） */
let adminCache = { at: 0, value: false }
async function isAdmin(force = false) {
  if (!force && Date.now() - adminCache.at < 15000) return adminCache.value
  try {
    const out = await runPowerShell(
      `([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)`,
      { timeout: 20000 }
    )
    const value = out.trim().toLowerCase().startsWith('true')
    adminCache = { at: Date.now(), value }
    return value
  } catch {
    return adminCache.value
  }
}

/** 判断某路径在当前权限下是否可写 */
function writable(root, admin) {
  if (!ADMIN_ROOTS.has(String(root || '').toUpperCase())) return true
  return !!admin
}

/* --------------------------- 键值类型转换 --------------------------- */

/** PowerShell 的 ValueKind 名称 => 标准 REG_* 名称 */
const KIND_MAP = {
  STRING: 'REG_SZ',
  EXPANDSTRING: 'REG_EXPAND_SZ',
  MULTISTRING: 'REG_MULTI_SZ',
  DWORD: 'REG_DWORD',
  QWORD: 'REG_QWORD',
  BINARY: 'REG_BINARY',
  NONE: 'REG_NONE',
  UNKNOWN: 'REG_SZ'
}

/** 把 PowerShell 的 ValueKind（ExpandString 等）统一成 REG_* 标准名 */
function normalizeKind(kind) {
  const raw = String(kind == null ? '' : kind).trim().toUpperCase().replace(/^REGISTRY::/, '')
  if (!raw) return 'REG_SZ'
  if (raw.startsWith('REG_')) return raw
  return KIND_MAP[raw] || raw
}

/** 把 PowerShell 输出规整为前端可用的键值对象 */
function normalizeValue(item) {
  const name = String(item.name == null ? '' : item.name)
  const type = normalizeKind(item.kind || item.type)
  let data = item.value
  if (data == null) data = ''
  if (Array.isArray(data)) data = data.join('\n')
  if (typeof data === 'object') data = JSON.stringify(data)
  let text = String(data)
  let binary = ''
  if (type === 'REG_BINARY') {
    // PowerShell 会把 byte[] 转成 base64 或数字数组，统一成十六进制字符串
    if (typeof item.value === 'string' && /^[A-Za-z0-9+/=]+$/.test(item.value)) {
      try {
        binary = Buffer.from(item.value, 'base64').toString('hex').toUpperCase()
      } catch { binary = '' }
    } else if (Array.isArray(item.raw)) {
      binary = item.raw.map((b) => Number(b).toString(16).padStart(2, '0')).join('').toUpperCase()
    } else if (typeof item.value === 'string' && /^[0-9a-fA-F\s,]*$/.test(item.value)) {
      binary = item.value.replace(/[^0-9a-fA-F]/g, '').toUpperCase()
    }
    text = binary
  }
  return {
    name,
    type,
    value: text,
    binary,
    isDefault: name === '' || name === '(默认)' || name === '(Default)'
  }
}

/** 把前端提交的值转成 PowerShell 侧可写的字面量片段 */
function valueToPs(type, value) {
  const t = String(type || 'REG_SZ').toUpperCase()
  if (t === 'REG_DWORD' || t === 'REG_QWORD') {
    const n = Number(String(value).trim())
    if (!Number.isFinite(n)) throw new Error('数值类型必须是数字')
    if (t === 'REG_DWORD' && (n < 0 || n > 4294967295)) throw new Error('REG_DWORD 取值范围为 0 ~ 4294967295')
    if (n < 0) throw new Error('数值不能为负数')
    return { psType: t === 'REG_DWORD' ? 'DWord' : 'QWord', literal: String(Math.trunc(n)) }
  }
  if (t === 'REG_MULTI_SZ') {
    const arr = String(value == null ? '' : value).split(/\r?\n/).filter((s) => s !== '')
    return { psType: 'MultiString', literal: `@(${arr.map((s) => `'${psQuote(s)}'`).join(',') || "''"})` }
  }
  if (t === 'REG_BINARY') {
    const hex = String(value == null ? '' : value).replace(/[\s,]/g, '')
    if (hex && !/^[0-9a-fA-F]+$/.test(hex)) throw new Error('REG_BINARY 必须是十六进制字符串')
    if (hex.length % 2 !== 0) throw new Error('REG_BINARY 十六进制长度必须为偶数')
    const bytes = hex.match(/.{1,2}/g) || []
    return { psType: 'Binary', literal: `[byte[]]@(${bytes.map((b) => parseInt(b, 16)).join(',') || '0'})` }
  }
  if (t === 'REG_EXPAND_SZ') {
    return { psType: 'ExpandString', literal: `'${psQuote(value)}'` }
  }
  return { psType: 'String', literal: `'${psQuote(value)}'` }
}

/* --------------------------- 读取：子项 / 键值 --------------------------- */

/**
 * 读取某路径下的直接子项（不递归），带超时保护。
 * @param {string} fullPath
 * @param {{timeout?: number}} [options]
 */
async function listSubKeys(fullPath, options = {}) {
  const p = parsePath(fullPath)
  if (!p.ok) throw new Error(p.message)
  const script = wrapJson(`
    $base = '${psQuote(p.psPath)}'
    if (-not (Test-Path -LiteralPath $base)) {
      @{ ok = $false; message = '注册表项不存在'; path = '${psQuote(p.full)}' } | ConvertTo-Json -Depth 4 -Compress
      return
    }
    $out = @()
    try {
      $out = @(Get-ChildItem -LiteralPath $base -ErrorAction Stop | ForEach-Object {
        $hasSub = $false
        try { $hasSub = @(Get-ChildItem -LiteralPath $_.PSPath -ErrorAction SilentlyContinue).Count -gt 0 } catch { $hasSub = $false }
        [pscustomobject]@{ name = $_.PSChildName; hasChildren = $hasSub }
      })
    } catch {
      @{ ok = $false; message = $_.Exception.Message; denied = $true } | ConvertTo-Json -Depth 4 -Compress
      return
    }
    @{ ok = $true; path = '${psQuote(p.full)}'; children = $out } | ConvertTo-Json -Depth 5 -Compress
  `)
  const res = await runPowerShellJson(script, { timeout: options.timeout || 30000 })
  if (!res || res.ok === false) {
    throw new Error(res && res.message ? res.message : '读取子项失败')
  }
  return (res.children || []).map((c) => ({
    name: String(c.name),
    fullPath: joinPath(p.full, String(c.name)),
    hasChildren: !!c.hasChildren
  }))
}

/**
 * 读取某路径下的键值列表，保留原生类型。
 * @param {string} fullPath
 * @param {{timeout?: number}} [options]
 * @returns {Promise<Array<{name:string,type:string,value:string,binary:string,isDefault:boolean}>>}
 */
async function listValues(fullPath, options = {}) {
  const p = parsePath(fullPath)
  if (!p.ok) throw new Error(p.message)
  const script = wrapJson(`
    $base = '${psQuote(p.psPath)}'
    if (-not (Test-Path -LiteralPath $base)) {
      @{ ok = $false; message = '注册表项不存在'; path = '${psQuote(p.full)}' } | ConvertTo-Json -Depth 4 -Compress
      return
    }
    try {
      $item = Get-Item -LiteralPath $base -ErrorAction Stop
    } catch {
      @{ ok = $false; message = $_.Exception.Message; denied = $true } | ConvertTo-Json -Depth 4 -Compress
      return
    }
    $out = @()
    foreach ($n in $item.GetValueNames()) {
      $kind = 'REG_SZ'
      try { $kind = $item.GetValueKind($n).ToString() } catch { $kind = 'REG_SZ' }
      $val = $null
      try { $val = $item.GetValue($n) } catch { $val = '' }
      $b64 = ''
      if ($kind -eq 'Binary') {
        try {
          if ($val -is [byte[]]) { $b64 = [Convert]::ToBase64String($val) }
          elseif ($val -ne $null) { $b64 = [Convert]::ToBase64String([byte[]]$val) }
        } catch { $b64 = '' }
      }
      $out += [pscustomobject]@{
        name = $n
        kind = $kind
        value = if ($kind -eq 'Binary') { $b64 } elseif ($kind -eq 'MultiString') { ($val -join "\\n") } else { [string]$val }
        raw = if ($kind -eq 'Binary' -and $val -is [byte[]]) { @($val) } else { $null }
      }
    }
    @{ ok = $true; path = '${psQuote(p.full)}'; values = $out } | ConvertTo-Json -Depth 6 -Compress
  `)
  const res = await runPowerShellJson(script, { timeout: options.timeout || 30000 })
  if (!res || res.ok === false) {
    throw new Error(res && res.message ? res.message : '读取键值失败')
  }
  return (res.values || []).map(normalizeValue)
}

/**
 * 递归读取整个分支（供备份 / 对比 / 搜索使用）。
 * 采用栈式遍历，避免一次性 Get-ChildItem -Recurse 在超大分支上爆内存。
 * @param {string} fullPath
 * @param {{onProgress?: Function, maxDepth?: number, maxKeys?: number, signal?: {cancelled: boolean}}} [options]
 * @returns {Promise<{path:string, values:Array, subKeys:string[], truncated:boolean, scanned:number}>}
 */
async function readTree(fullPath, options = {}) {
  const p = parsePath(fullPath)
  if (!p.ok) throw new Error(p.message)
  const maxDepth = Number(options.maxDepth) > 0 ? Number(options.maxDepth) : 64
  const maxKeys = Number(options.maxKeys) > 0 ? Number(options.maxKeys) : 200000
  const script = wrapJson(`
    $root = '${psQuote(p.psPath)}'
    $maxDepth = ${maxDepth}
    $maxKeys = ${maxKeys}
    if (-not (Test-Path -LiteralPath $root)) {
      @{ ok = $false; message = '注册表项不存在'; path = '${psQuote(p.full)}' } | ConvertTo-Json -Depth 4 -Compress
      return
    }
    $result = @()
    $stack = New-Object System.Collections.Stack
    $stack.Push(@{ ps = $root; depth = 0 })
    $count = 0
    $truncated = $false
    $denied = @()
    while ($stack.Count -gt 0) {
      if ($count -ge $maxKeys) { $truncated = $true; break }
      $cur = $stack.Pop()
      try {
        $item = Get-Item -LiteralPath $cur.ps -ErrorAction Stop
      } catch {
        $denied += $cur.ps
        continue
      }
      $vals = @()
      foreach ($n in $item.GetValueNames()) {
        $kind = 'REG_SZ'
        try { $kind = $item.GetValueKind($n).ToString() } catch { $kind = 'REG_SZ' }
        $val = $null
        try { $val = $item.GetValue($n) } catch { $val = '' }
        $b64 = ''
        if ($kind -eq 'Binary') {
          try { if ($val -is [byte[]]) { $b64 = [Convert]::ToBase64String($val) } } catch { $b64 = '' }
        }
        $vals += [pscustomobject]@{
          name = $n
          kind = $kind
          value = if ($kind -eq 'Binary') { $b64 } elseif ($kind -eq 'MultiString') { ($val -join "\\n") } else { [string]$val }
        }
      }
      $result += [pscustomobject]@{ psPath = $cur.ps; keyPath = ($cur.ps -replace '^Registry::HKEY_[A-Z_]+', ''); values = $vals }
      $count++
      if ($cur.depth -lt $maxDepth) {
        try {
          foreach ($child in @(Get-ChildItem -LiteralPath $cur.ps -ErrorAction Stop)) {
            $stack.Push(@{ ps = $child.PSPath; depth = $cur.depth + 1 })
          }
        } catch { $denied += $cur.ps }
      } else {
        $truncated = $true
      }
    }
    @{ ok = $true; nodes = $result; truncated = $truncated; scanned = $count; denied = $denied } | ConvertTo-Json -Depth 7 -Compress
  `)
  // 递归读取可能耗时较长，超时按规模放宽
  const timeout = Math.min(300000, 60000 + maxKeys * 2)
  const res = await runPowerShellJson(script, { timeout })
  if (!res || res.ok === false) {
    throw new Error(res && res.message ? res.message : '递归读取注册表失败')
  }
  return {
    path: p.full,
    nodes: (res.nodes || []).map((n) => ({
      path: normalizeKeyPath(String(n.keyPath || '')),
      values: (n.values || []).map(normalizeValue)
    })),
    truncated: !!res.truncated,
    scanned: Number(res.scanned) || 0,
    denied: res.denied || []
  }
}

/** 把 PowerShell 侧的 keyPath（\Software\...）补回根项短名 */
function normalizeKeyPath(raw) {
  const t = String(raw || '')
  if (!t) return ''
  const m = t.match(/^HKEY_([A-Z_]+)(.*)$/i)
  if (m) {
    const map = { CURRENT_USER: 'HKCU', LOCAL_MACHINE: 'HKLM', CLASSES_ROOT: 'HKCR', USERS: 'HKU', CURRENT_CONFIG: 'HKCC' }
    const short = map[`${m[1]}`.toUpperCase()] || m[1]
    return `${short}${m[2] || ''}`.replace(/^([A-Z]+)\\/, '$1\\')
  }
  return t.replace(/^\\+/, '')
}

/** 环境变量两个分支的完整路径 */
function envPaths() {
  return { ...ENV_PATHS }
}

/** 该路径是否属于环境变量分支 */
function isEnvPath(fullPath) {
  const p = parsePath(fullPath)
  if (!p.ok) return false
  const f = p.full.toUpperCase()
  return f === ENV_PATHS.user.toUpperCase() || f === ENV_PATHS.machine.toUpperCase()
}

/** 该路径是否需要管理员权限才能写 */
function needsAdmin(fullPath) {
  const p = parsePath(fullPath)
  if (!p.ok) return false
  return ADMIN_ROOTS.has(p.root)
}

/* --------------------------- 写入 --------------------------- */

/**
 * 创建注册表项（可带初始键值）
 * @param {string} parentPath
 * @param {string} keyName
 * @param {Array<{name:string,type:string,value:string}>} [values]
 */
async function createKey(parentPath, keyName, values = []) {
  const parent = parsePath(parentPath)
  if (!parent.ok) throw new Error(parent.message)
  const check = validateKeyName(keyName)
  if (!check.ok) throw new Error(check.message)
  const full = joinPath(parent.full, check.value)
  const w = parsePath(full)
  const admin = await isAdmin()
  if (!writable(w.root, admin)) throw new Error('当前分支需要管理员权限才能创建注册表项')

  const setters = []
  for (const v of values || []) {
    const nm = validateKeyName(v.name)
    if (!nm.ok) throw new Error(`键值名称不合法：${nm.message}`)
    const { psType, literal } = valueToPs(v.type, v.value)
    setters.push(`New-ItemProperty -Path $key -Name '${psQuote(nm.value)}' -PropertyType ${psType} -Value ${literal} -Force | Out-Null`)
  }
  const script = wrapJson(`
    $key = '${psQuote(w.psPath)}'
    if (Test-Path -LiteralPath $key) {
      @{ ok = $false; message = '该注册表项已存在' } | ConvertTo-Json -Depth 4 -Compress
      return
    }
    New-Item -Path $key -Force | Out-Null
    ${setters.join('\n    ')}
    @{ ok = $true; path = '${psQuote(w.full)}' } | ConvertTo-Json -Depth 4 -Compress
  `)
  const res = await runPowerShellJson(script, { timeout: 30000 })
  if (!res || res.ok === false) throw new Error((res && res.message) || '创建注册表项失败')
  audit('registryCreateKey', { path: w.full })
  return { path: w.full }
}

/**
 * 写入一个键值（存在则覆盖，类型一并更新）
 * 注意：REG_EXPAND_SZ 必须用 ExpandString，否则会被降级成 REG_SZ。
 */
async function setValue(fullPath, name, type, value) {
  const p = parsePath(fullPath)
  if (!p.ok) throw new Error(p.message)
  const nm = String(name == null ? '' : name)
  if (nm !== '') {
    const chk = validateKeyName(nm)
    if (!chk.ok) throw new Error(chk.message)
  }
  const admin = await isAdmin()
  if (!writable(p.root, admin)) throw new Error('当前分支需要管理员权限才能修改')

  // 读取旧值用于审计
  let before = null
  try {
    const cur = await listValues(p.full, { timeout: 20000 })
    before = cur.find((x) => x.name.toLowerCase() === (nm || '').toLowerCase()) || null
  } catch { /* 读不到旧值不阻断 */ }

  const { psType, literal } = valueToPs(type, value)
  const valueName = nm === '' ? '(default)' : `'${psQuote(nm)}'`
  const script = wrapJson(`
    $key = '${psQuote(p.psPath)}'
    if (-not (Test-Path -LiteralPath $key)) { New-Item -Path $key -Force | Out-Null }
    New-ItemProperty -Path $key -Name ${valueName} -PropertyType ${psType} -Value ${literal} -Force | Out-Null
    @{ ok = $true } | ConvertTo-Json -Depth 4 -Compress
  `)
  const res = await runPowerShellJson(script, { timeout: 30000 })
  if (!res || res.ok === false) throw new Error((res && res.message) || '写入键值失败')
  audit('registryEditValue', {
    path: p.full, name: nm, type,
    before: before ? before.value : '',
    after: String(value == null ? '' : value).slice(0, 2000)
  })
  return { ok: true }
}

/** 删除键值 */
async function deleteValue(fullPath, name) {
  const p = parsePath(fullPath)
  if (!p.ok) throw new Error(p.message)
  const nm = String(name == null ? '' : name)
  const admin = await isAdmin()
  if (!writable(p.root, admin)) throw new Error('当前分支需要管理员权限才能删除')

  let before = null
  try {
    const cur = await listValues(p.full, { timeout: 20000 })
    before = cur.find((x) => x.name.toLowerCase() === nm.toLowerCase()) || null
  } catch { /* ignore */ }

  const valueName = nm === '' ? '(default)' : `'${psQuote(nm)}'`
  const script = wrapJson(`
    $key = '${psQuote(p.psPath)}'
    try {
      Remove-ItemProperty -LiteralPath $key -Name ${valueName} -Force -ErrorAction Stop
    } catch {
      @{ ok = $false; message = $_.Exception.Message } | ConvertTo-Json -Depth 4 -Compress
      return
    }
    @{ ok = $true } | ConvertTo-Json -Depth 4 -Compress
  `)
  const res = await runPowerShellJson(script, { timeout: 30000 })
  if (!res || res.ok === false) throw new Error((res && res.message) || '删除键值失败')
  audit('registryDeleteValue', { path: p.full, name: nm, before: before ? before.value : '' })
  return { ok: true }
}

/**
 * 删除注册表项（递归或仅当为空）
 * @param {string} fullPath
 * @param {{recursive?: boolean}} [options]
 */
async function deleteKey(fullPath, options = {}) {
  const p = parsePath(fullPath)
  if (!p.ok) throw new Error(p.message)
  const admin = await isAdmin()
  if (!writable(p.root, admin)) throw new Error('当前分支需要管理员权限才能删除')
  if (!p.sub) throw new Error('不允许删除注册表根项')

  let subCount = 0
  let valueCount = 0
  try {
    subCount = (await listSubKeys(p.full, { timeout: 20000 })).length
    valueCount = (await listValues(p.full, { timeout: 20000 })).length
  } catch { /* ignore */ }

  if (!options.recursive && (subCount > 0 || valueCount > 0)) {
    throw new Error(`该项下还有 ${subCount} 个子项、${valueCount} 个键值，必须显式指定递归删除`)
  }
  const script = wrapJson(`
    $key = '${psQuote(p.psPath)}'
    try {
      Remove-Item -LiteralPath $key -Recurse -Force -ErrorAction Stop
    } catch {
      @{ ok = $false; message = $_.Exception.Message } | ConvertTo-Json -Depth 4 -Compress
      return
    }
    @{ ok = $true } | ConvertTo-Json -Depth 4 -Compress
  `)
  const res = await runPowerShellJson(script, { timeout: 60000 })
  if (!res || res.ok === false) throw new Error((res && res.message) || '删除注册表项失败')
  audit('registryDeleteKey', { path: p.full, subKeys: subCount, values: valueCount, recursive: !!options.recursive })
  return { ok: true, subKeys: subCount, values: valueCount }
}

/** 检查某路径是否存在 */
async function keyExists(fullPath) {
  const p = parsePath(fullPath)
  if (!p.ok) return false
  try {
    const out = await runPowerShell(
      `if (Test-Path -LiteralPath '${psQuote(p.psPath)}') { 'yes' } else { 'no' }`,
      { timeout: 15000 }
    )
    return out.trim() === 'yes'
  } catch {
    return false
  }
}

/* --------------------------- .reg 导出 / 导入 --------------------------- */

/** 转义 .reg 字符串值 */
function regEscape(text) {
  return String(text == null ? '' : text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * 生成标准 .reg 文件文本
 * @param {Array<{path:string, values:Array}>} nodes readTree 的输出
 * @param {{encoding?: 'utf8'|'ansi'}} [options]
 */
function buildRegText(nodes, options = {}) {
  const lines = ['Windows Registry Editor Version 5.00', '']
  for (const node of nodes || []) {
    const p = parsePath(node.path)
    if (!p.ok) continue
    lines.push(`[${p.full}]`)
    for (const v of node.values || []) {
      const name = v.name === '' ? '@' : `"${regEscape(v.name)}"`
      const t = String(v.type || 'REG_SZ').toUpperCase()
      if (t === 'REG_DWORD') {
        const n = Number(v.value) || 0
        lines.push(`${name}=dword:${(n >>> 0).toString(16).padStart(8, '0')}`)
      } else if (t === 'REG_QWORD') {
        const b = Buffer.alloc(8)
        b.writeBigUInt64LE(BigInt(Math.max(0, Math.trunc(Number(v.value) || 0))))
        const hex = b.toString('hex').toUpperCase()
        lines.push(`${name}=hex(b):${hex.match(/.{2}/g).join(',')}`)
      } else if (t === 'REG_BINARY') {
        const hex = String(v.binary || v.value || '').replace(/[^0-9a-fA-F]/g, '')
        const bytes = hex.match(/.{1,2}/g) || []
        lines.push(`${name}=hex:${bytes.join(',')}`)
      } else if (t === 'REG_MULTI_SZ') {
        const arr = String(v.value || '').split(/\r?\n/).filter((s) => s !== '')
        const parts = [...arr, ''].map((s) => `"${regEscape(s)}"`)
        lines.push(`${name}=hex(7):${multiSzHex(arr)}`)
        void parts
      } else if (t === 'REG_EXPAND_SZ') {
        const s = String(v.value || '')
        lines.push(`${name}=hex(2):${utf16Hex(s + '\u0000')}`)
      } else if (t === 'REG_NONE') {
        lines.push(`${name}=hex(0):`)
      } else {
        lines.push(`${name}="${regEscape(v.value)}"`)
      }
    }
    lines.push('')
  }
  return lines.join('\r\n')
}

/** 字符串转 UTF-16LE 逗号十六进制 */
function utf16Hex(str) {
  const b = Buffer.from(String(str), 'utf16le')
  const bytes = []
  for (let i = 0; i < b.length; i++) bytes.push(b[i].toString(16).padStart(2, '0'))
  return bytes.join(',')
}

/** 多字符串转 UTF-16LE 十六进制（每项以 \0 分隔，末尾双 \0） */
function multiSzHex(arr) {
  const text = (arr.length ? arr.join('\u0000') : '') + '\u0000\u0000'
  return utf16Hex(text)
}

/**
 * 导出为 .reg
 * @param {Array} nodes
 * @param {string} targetFile
 * @param {{encoding?: 'utf8'|'ansi'}} [options]
 */
async function exportReg(nodes, targetFile, options = {}) {
  const text = buildRegText(nodes, options)
  store.ensureDir(path.dirname(targetFile))
  if (options.encoding === 'ansi') {
    // .reg 的 ANSI 版本按系统代码页写；用 PowerShell 转码保证中文正确
    const tmp = `${targetFile}.utf8.tmp`
    fs.writeFileSync(tmp, '\ufeff' + text, 'utf8')
    const script = wrapJson(`
      $src = '${psQuote(tmp)}'
      $dst = '${psQuote(targetFile)}'
      $content = Get-Content -LiteralPath $src -Raw -Encoding UTF8
      [System.IO.File]::WriteAllText($dst, $content, [System.Text.Encoding]::Default)
      @{ ok = $true } | ConvertTo-Json -Compress
    `)
    const res = await runPowerShellJson(script, { timeout: 30000 })
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
    if (!res || res.ok === false) throw new Error((res && res.message) || 'ANSI 编码导出失败')
  } else {
    // UTF-8 with BOM，Windows 注册表编辑器可直接识别
    fs.writeFileSync(targetFile, '\ufeff' + text, 'utf8')
  }
  audit('registryExportReg', { file: targetFile, keys: (nodes || []).length, encoding: options.encoding || 'utf8' })
  return { file: targetFile, bytes: fs.statSync(targetFile).size, keys: (nodes || []).length }
}

/**
 * 解析 .reg 文件为结构化数据（不写注册表）
 * @param {string} file
 * @returns {Promise<{nodes:Array<{path:string,values:Array}>, encoding:string, issues:Array}>}
 */
async function parseRegFile(file) {
  if (!fs.existsSync(file)) throw new Error('文件不存在')
  const buf = fs.readFileSync(file)
  let encoding = 'utf8'
  let text = ''
  if (buf[0] === 0xff && buf[1] === 0xfe) {
    encoding = 'utf16le'
    text = buf.toString('utf16le').replace(/^\ufeff/, '')
  } else if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    encoding = 'utf8'
    text = buf.toString('utf8').replace(/^\ufeff/, '')
  } else {
    text = buf.toString('utf8')
    // 无 BOM 且出现替换字符，按系统代码页回读
    if (text.includes('\ufffd')) {
      try {
        const out = await runPowerShell(
          `[System.IO.File]::ReadAllText('${psQuote(file)}', [System.Text.Encoding]::Default)`,
          { timeout: 20000 }
        )
        text = out.replace(/^\ufeff/, '')
        encoding = 'ansi'
      } catch { /* 保留 utf8 结果 */ }
    }
  }
  const issues = []
  const nodeMap = new Map()
  let current = null
  const lines = text.split(/\r?\n/)
  let headerSeen = false
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]
    const line = rawLine.trim()
    if (!line) continue
    if (/^Windows Registry Editor/i.test(line)) { headerSeen = true; continue }
    if (line.startsWith(';')) continue
    if (line.startsWith('[')) {
      if (!line.endsWith(']')) { issues.push({ line: i + 1, text: line, message: '方括号不完整' }); continue }
      let keyPath = line.slice(1, -1)
      if (/^-/.test(keyPath)) {
        // 删除指令 [-HKCU\xxx]
        current = null
        issues.push({ line: i + 1, text: line, message: '删除指令暂不支持导入', fatal: true })
        continue
      }
      const p = parsePath(keyPath)
      if (!p.ok) { issues.push({ line: i + 1, text: line, message: p.message, fatal: true }); continue }
      current = { path: p.full, values: [] }
      nodeMap.set(p.full.toUpperCase(), current)
      continue
    }
    const m = line.match(/^(@|"(?:[^"\\]|\\.)*")\s*=\s*(.*)$/)
    if (!m) { issues.push({ line: i + 1, text: line, message: '无法解析的行' }); continue }
    if (!current) { issues.push({ line: i + 1, text: line, message: '键值出现在任何项之前', fatal: true }); continue }
    const nameRaw = m[1]
    const dataRaw = m[2]
    const name = nameRaw === '@' ? '' : nameRaw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    const parsed = parseRegData(dataRaw)
    if (!parsed) { issues.push({ line: i + 1, text: line, message: '数据类型无法识别' }); continue }
    // 多行 hex 续行
    let data = parsed
    if (parsed.continued) {
      let buf2 = parsed.hex
      let j = i + 1
      while (j < lines.length && /\\\s*$/.test(lines[j])) {
        buf2 += lines[j].replace(/\\\s*$/, '').replace(/\s+/g, '')
        j++
      }
      if (j < lines.length && /^\s*[0-9a-fA-F]{2}/.test(lines[j])) {
        buf2 += lines[j].replace(/\s+/g, '')
        i = j
      }
      data = decodeHexType(parsed.type, buf2)
    }
    current.values.push({ name, type: data.type, value: data.value, binary: data.binary || '' })
  }
  if (!headerSeen) issues.push({ line: 1, message: '缺少「Windows Registry Editor Version 5.00」文件头', fatal: true })
  return {
    nodes: [...nodeMap.values()],
    encoding,
    issues
  }
}

/** 解析 reg 行右侧数据 */
function parseRegData(text) {
  const t = String(text || '').trim()
  if (t.startsWith('"')) {
    const body = t.replace(/^"/, '').replace(/"\s*$/, '')
    return { type: 'REG_SZ', value: body.replace(/\\"/g, '"').replace(/\\\\/g, '\\'), continued: false }
  }
  const dword = t.match(/^dword:([0-9a-fA-F]{1,8})$/i)
  if (dword) return { type: 'REG_DWORD', value: String(parseInt(dword[1], 16)), continued: false }
  const hex = t.match(/^hex(\(([0-9a-fA-F]+)\))?:([0-9a-fA-F,\s\\]*)$/i)
  if (hex) {
    const sub = hex[2]
    const body = hex[3].replace(/\s+/g, '')
    const continued = /\\$/.test(t)
    const typeCode = sub ? parseInt(sub, 16) : 3
    if (continued) return { type: `HEX_${typeCode}`, hex: body.replace(/\\$/, ''), continued: true, typeCode }
    return decodeHexType(`HEX_${typeCode}`, body.replace(/\\$/, ''), typeCode)
  }
  return null
}

/** 把 hex 数据按类型解码为可读值 */
function decodeHexType(type, hexRaw, typeCodeOverride) {
  const hex = String(hexRaw || '').replace(/[^0-9a-fA-F]/g, '')
  let typeCode = typeCodeOverride
  if (typeCode == null) {
    const m = String(type).match(/^HEX_(\d+)$/)
    typeCode = m ? parseInt(m[1], 10) : 3
  }
  const bytes = Buffer.from(hex, 'hex')
  if (typeCode === 2) {
    return { type: 'REG_EXPAND_SZ', value: trimUtf16(bytes) }
  }
  if (typeCode === 7) {
    const text = trimUtf16(bytes)
    return { type: 'REG_MULTI_SZ', value: text.split('\u0000').filter((s) => s !== '').join('\n') }
  }
  if (typeCode === 4) {
    const n = bytes.length >= 4 ? bytes.readUInt32LE(0) : 0
    return { type: 'REG_DWORD', value: String(n) }
  }
  if (typeCode === 11) {
    const n = bytes.length >= 8 ? Number(bytes.readBigUInt64LE(0)) : 0
    return { type: 'REG_QWORD', value: String(n) }
  }
  if (typeCode === 0) {
    return { type: 'REG_NONE', value: '' }
  }
  if (typeCode === 1) {
    return { type: 'REG_SZ', value: trimUtf16(bytes) }
  }
  return { type: 'REG_BINARY', value: hex.toUpperCase(), binary: hex.toUpperCase() }
}

/** 去掉 UTF-16LE 的尾部 \0 并转字符串 */
function trimUtf16(bytes) {
  let end = bytes.length
  while (end >= 2 && bytes[end - 1] === 0 && bytes[end - 2] === 0) end -= 2
  const slice = bytes.subarray(0, end)
  const parts = []
  for (let i = 0; i + 1 < slice.length; i += 2) {
    const code = slice[i] | (slice[i + 1] << 8)
    if (code === 0) continue
    parts.push(String.fromCharCode(code))
  }
  return parts.join('')
}

/**
 * 把解析后的 reg 数据与当前状态对比，生成导入预览。
 * @param {Array} nodes
 * @param {'merge'|'append'} mode
 */
async function previewRegImport(nodes, mode = 'merge') {
  const rows = []
  for (const node of nodes || []) {
    let exists = false
    let current = []
    try {
      exists = await keyExists(node.path)
      if (exists) current = await listValues(node.path, { timeout: 20000 })
    } catch { /* 读取失败按不存在处理 */ }
    for (const v of node.values || []) {
      const hit = current.find((c) => c.name.toLowerCase() === v.name.toLowerCase())
      let status = 'new'
      if (hit) status = mode === 'append' ? 'skip' : 'conflict'
      rows.push({
        path: node.path,
        keyExists: exists,
        name: v.name,
        type: v.type,
        newValue: v.value,
        currentValue: hit ? hit.value : '',
        currentType: hit ? hit.type : '',
        status
      })
    }
    if (!node.values || node.values.length === 0) {
      rows.push({
        path: node.path, keyExists: exists, name: '', type: '', newValue: '',
        currentValue: '', currentType: '', status: exists ? 'skip' : 'new', onlyKey: true
      })
    }
  }
  return rows
}

/**
 * 执行导入（带事务回滚）。任一条失败时反向还原已写入项。
 * @param {Array} rows previewRegImport 的勾选行
 */
async function applyRegImport(rows) {
  const applied = []
  const failed = []
  for (const row of rows || []) {
    const p = parsePath(row.path)
    if (!p.ok) { failed.push({ ...row, message: p.message }); continue }
    try {
      if (row.onlyKey) {
        if (!(await keyExists(p.full))) {
          await createKey(parentPath(p.full) || p.full, p.sub.split('\\').pop() || '')
        }
        applied.push({ row, kind: 'key-add' })
        continue
      }
      const exists = await keyExists(p.full)
      if (!exists) {
        const parent = parentPath(p.full)
        const leaf = p.sub.split('\\').pop()
        await createKey(parent, leaf)
      }
      let before = null
      if (exists) {
        const cur = await listValues(p.full, { timeout: 20000 })
        before = cur.find((c) => c.name.toLowerCase() === String(row.name).toLowerCase()) || null
      }
      await setValue(p.full, row.name, row.type, row.newValue)
      applied.push({ row, kind: before ? 'value-update' : 'value-add', before })
    } catch (err) {
      failed.push({ ...row, message: err.message })
      break
    }
  }
  if (failed.length) {
    // 反向回滚
    const rollbackFailed = []
    for (const item of [...applied].reverse()) {
      try {
        if (item.kind === 'value-add') {
          await deleteValue(item.row.path, item.row.name)
        } else if (item.kind === 'value-update' && item.before) {
          await setValue(item.row.path, item.row.name, item.before.type, item.before.value)
        }
      } catch (e) {
        rollbackFailed.push({ path: item.row.path, name: item.row.name, message: e.message })
      }
    }
    await broadcastRegistryChange()
    audit('registryImportRolledBack', { applied: applied.length, failed: failed.length, rollbackFailed: rollbackFailed.length })
    throw new Error(
      `导入「${failed[0].path}\\${failed[0].name || ''}」失败：${failed[0].message}。` +
      `已回滚 ${applied.length - rollbackFailed.length} 项` +
      (rollbackFailed.length ? `，另有 ${rollbackFailed.length} 项回滚未成功` : '')
    )
  }
  await broadcastRegistryChange()
  audit('registryImportReg', { count: applied.length })
  return { applied: applied.length }
}

/** 广播注册表变更，让其他程序与自身界面刷新 */
async function broadcastRegistryChange() {
  try {
    const { runPowerShell } = require('./ps')
    const script = `
Add-Type -Namespace WEMREG -Name Native -MemberDefinition @"
[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
"@
$r = [UIntPtr]::Zero
[void][WEMREG.Native]::SendMessageTimeout([IntPtr]0xffff, 0x001A, [UIntPtr]::Zero, 'Environment', 2, 3000, [ref]$r)
'ok'
`
    await runPowerShell(script, { timeout: 15000 })
    return true
  } catch {
    return false
  }
}

/* --------------------------- 审计 --------------------------- */

/** 统一写审计，附带注册表来源标记 */
function audit(action, detail) {
  try {
    store.appendAudit({ origin: 'GUI', category: 'registry', action, ...detail })
  } catch { /* 审计失败不阻断主流程 */ }
}

/* --------------------------- 搜索 --------------------------- */

/**
 * 在指定分支递归搜索键名 / 键值。
 * @param {string} rootPath
 * @param {string} keyword
 * @param {{scope?: 'name'|'value'|'both', includeBinary?: boolean, maxResults?: number, caseSensitive?: boolean}} [options]
 */
async function search(rootPath, keyword, options = {}) {
  const kw = String(keyword == null ? '' : keyword)
  if (!kw) throw new Error('搜索关键词不能为空')
  const tree = await readTree(rootPath, { maxKeys: Number(options.maxKeys) || 50000 })
  const scope = options.scope || 'both'
  const includeBinary = !!options.includeBinary
  const maxResults = Number(options.maxResults) || 2000
  const needle = options.caseSensitive ? kw : kw.toLowerCase()
  const hit = (text) => {
    const t = options.caseSensitive ? String(text) : String(text).toLowerCase()
    return t.includes(needle)
  }
  const results = []
  for (const node of tree.nodes) {
    if (results.length >= maxResults) break
    const nameHit = scope !== 'value' && hit(node.path)
    if (nameHit) {
      results.push({ path: node.path, name: '', type: '', value: '', matchIn: 'key' })
    }
    for (const v of node.values) {
      if (results.length >= maxResults) break
      if (v.type === 'REG_BINARY' && !includeBinary) continue
      const vHit = scope !== 'name' && hit(v.value)
      const nHit = scope !== 'value' && hit(v.name)
      if (vHit || nHit) {
        results.push({
          path: node.path, name: v.name, type: v.type,
          value: v.type === 'REG_BINARY' ? '[二进制]' : v.value,
          matchIn: vHit ? 'value' : 'name'
        })
      }
    }
  }
  return { results, scanned: tree.scanned, truncated: tree.truncated, total: results.length }
}

module.exports = {
  ROOTS,
  ENV_PATHS,
  VALUE_TYPES,
  ADMIN_ROOTS,
  parsePath,
  joinPath,
  parentPath,
  validateKeyName,
  isAdmin,
  writable,
  needsAdmin,
  isEnvPath,
  envPaths,
  listSubKeys,
  listValues,
  readTree,
  createKey,
  setValue,
  deleteValue,
  deleteKey,
  keyExists,
  buildRegText,
  exportReg,
  parseRegFile,
  previewRegImport,
  applyRegImport,
  broadcastRegistryChange,
  search,
  normalizeValue,
  valueToPs,
  audit
}
