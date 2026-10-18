'use strict'
/**
 * 本机开发软件自动扫描识别引擎
 * 并行读取 4 类数据源：
 *   1. Windows 注册表卸载项
 *   2. PATH 内所有目录的可执行文件
 *   3. 常用默认目录 / 自定义目录（受限深度遍历）
 *   4. 现有 HOME 类环境变量反向提取
 * 识别结果分为「已纳入管理」与「自动发现（未纳入管理）」两组。
 */
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const execFileAsync = promisify(execFile)
const registry = require('./registry')
const store = require('./store')
const rules = require('./rules')

const UNINSTALL_KEYS = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
]

const DEFAULT_SCAN_DIRS = [
  'C:\\dev\\soft',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  '%LOCALAPPDATA%\\Programs',
  '%ProgramFiles%'
]

const SKIP_DIRS = new Set([
  '$recycle.bin', 'system volume information', 'windows', 'appdata', 'node_modules',
  '$windows.~ws', 'recovery', 'perflogs', 'internet explorer', 'windowsapps',
  'windows defender', 'windows defender advanced threat protection', 'common files',
  'windows nt', 'wbem', 'dotnet', 'reference assemblies', 'microsoft shared',
  'windows media player', 'windows portable devices', 'microsoft update health tool'
])

/** 展开 %VAR%（使用进程环境，足够用于扫描） */
function expandWin(s) {
  return String(s || '').replace(/%([^%]+)%/g, (m, n) => {
    const v = process.env[n] || process.env[n.toUpperCase()]
    return v === undefined ? m : v
  })
}

function normLower(p) {
  return String(p || '').trim().replace(/[\\/]+$/, '').toLowerCase()
}

function dirExists(p) {
  try {
    return fs.statSync(p).isDirectory()
  } catch (_) {
    return false
  }
}

/** Windows、Program Files、ProgramData 及其子目录。用于「跳过系统保护目录」。 */
function isSystemProtectedDir(dir) {
  const n = normLower(expandWin(dir))
  if (!n) return false
  const roots = []
  const add = (p) => {
    const v = normLower(expandWin(p))
    if (v && !roots.includes(v)) roots.push(v)
  }
  add('C:\\Windows')
  add('C:\\Program Files')
  add('C:\\Program Files (x86)')
  add('C:\\ProgramData')
  add('%WINDIR%')
  add('%SystemRoot%')
  add('%ProgramFiles%')
  add('%ProgramFiles(x86)%')
  add('%ProgramData%')
  add(process.env.WINDIR)
  add(process.env.SystemRoot)
  add(process.env.ProgramFiles)
  add(process.env['ProgramFiles(x86)'])
  add(process.env.ProgramData)
  return roots.some((root) => n === root || n.startsWith(`${root}\\`))
}

/* --------------------------- 数据源 1：注册表卸载项 --------------------------- */

async function readUninstallEntries(signal) {
  const script = `
$out = New-Object System.Collections.ArrayList
$keys = @(
${UNINSTALL_KEYS.map((k) => `  '${k.replace(/'/g, "''")}'`).join(',\n')}
)
foreach ($root in $keys) {
  if (-not (Test-Path -LiteralPath $root)) { continue }
  foreach ($sub in (Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue)) {
    $p = Get-ItemProperty -LiteralPath $sub.PSPath -ErrorAction SilentlyContinue
    if ($null -eq $p) { continue }
    $name = [string]$p.DisplayName
    if ([string]::IsNullOrWhiteSpace($name)) { continue }
    [void]$out.Add([pscustomobject]@{
      name = $name
      version = [string]$p.DisplayVersion
      location = [string]$p.InstallLocation
      icon = [string]$p.DisplayIcon
      uninstall = [string]$p.UninstallString
      publisher = [string]$p.Publisher
      root = $root
    })
  }
}
@($out) | ConvertTo-Json -Depth 4 -Compress
`
  if (signal && signal.cancelled) return []
  const { runPowerShell } = require('./ps')
  try {
    const raw = await runPowerShell(script, { timeout: 45000 })
    const text = (raw || '').trim()
    if (!text) return []
    const parsed = JSON.parse(text)
    const list = Array.isArray(parsed) ? parsed : [parsed]
    return list.map((e) => ({
      name: String(e.name || ''),
      version: String(e.version || ''),
      location: String(e.location || ''),
      icon: String(e.icon || ''),
      uninstall: String(e.uninstall || ''),
      publisher: String(e.publisher || '')
    }))
  } catch (_) {
    return []
  }
}

/* --------------------------- 数据源 3：目录扫描 --------------------------- */

/** 受限深度遍历目录，返回 {dir, depth} 列表。skipSystem 时系统保护目录只记自身，不再向下。 */
function walkDirs(roots, maxDepth, budget, signal, onProgress, walkOpts = {}) {
  const skipSystem = !!walkOpts.skipSystem
  const out = []
  const queue = roots
    .map((r) => expandWin(r))
    .filter((r) => r && dirExists(r))
    .map((r) => ({ dir: r, depth: 0 }))
  const seen = new Set()

  while (queue.length) {
    if (signal && signal.cancelled) break
    if (out.length > budget) break
    const { dir, depth } = queue.shift()
    const key = normLower(dir)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ dir, depth })
    if (skipSystem && isSystemProtectedDir(dir)) {
      if (onProgress && out.length % 150 === 0) onProgress(out.length)
      continue
    }

    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch (_) {
      continue
    }
    if (depth >= maxDepth) continue
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const n = e.name.toLowerCase()
      if (n.startsWith('.') || SKIP_DIRS.has(n)) continue
      const child = path.join(dir, e.name)
      if (skipSystem && isSystemProtectedDir(child)) continue
      queue.push({ dir: child, depth: depth + 1 })
    }
    if (onProgress && out.length % 150 === 0) onProgress(out.length)
  }
  return out
}

/* --------------------------- 版本检测 --------------------------- */

function versionTimeoutMs(versionTimeoutSec, fallback) {
  const sec = Number(versionTimeoutSec)
  if (Number.isFinite(sec) && sec >= 1 && sec <= 30) return Math.round(sec * 1000)
  return fallback
}

async function detectVersion(rule, exePath, installPath, versionTimeoutSec) {
  // 未配置版本命令时，读取文件版本信息
  if (!rule.versionCmd) {
    try {
      const { runPowerShell } = require('./ps')
      const out = await runPowerShell(
        `(Get-Item -LiteralPath '${exePath.replace(/'/g, "''")}').VersionInfo.ProductVersion`,
        { timeout: versionTimeoutMs(versionTimeoutSec, 15000) }
      )
      const v = out.trim()
      return v || ''
    } catch (_) {
      return ''
    }
  }
  const args = rule.versionCmd.trim().split(/\s+/).filter(Boolean)
  try {
    const { stdout, stderr } = await execFileAsync(exePath, args, {
      cwd: installPath || path.dirname(exePath),
      timeout: versionTimeoutMs(versionTimeoutSec, 10000),
      windowsHide: true,
      maxBuffer: 1024 * 512
    })
    const text = `${stdout || ''}\n${stderr || ''}`
    return extractVersion(text, rule.versionRegex)
  } catch (err) {
    // 某些程序把版本输出到 stderr 且退出码非 0（如 java -version）
    const text = `${(err.stdout || '')}\n${(err.stderr || '')}`
    const v = extractVersion(text, rule.versionRegex)
    return v
  }
}

function extractVersion(text, regex) {
  if (!regex) return ''
  try {
    const re = new RegExp(regex, 'i')
    const m = text.match(re)
    if (!m) return ''
    return m[1] || m[0]
  } catch (_) {
    return ''
  }
}

/* --------------------------- 变量计划生成 --------------------------- */

/**
 * 依据规则与安装目录，生成将要新增 / 修改的环境变量计划
 * @returns {Array<{scope,name,value,remark,op,oldValue,pathPosition}>}
 */
function buildVarPlan(ruleObj, installPath, currentEnv) {
  const plan = []
  const curUser = (currentEnv && currentEnv.user) || {}
  const curMachine = (currentEnv && currentEnv.machine) || {}

  for (const t of ruleObj.envTemplate || []) {
    const scope = t.scope === 'system' ? 'machine' : 'user'
    const value = String(t.varValue || '').replace(/\{\{installPath\}\}/g, installPath).replace(/\{\{installPath\}\}/g, installPath)
    const curMap = scope === 'machine' ? curMachine : curUser
    const has = Object.prototype.hasOwnProperty.call(curMap, t.varKey)
    const cur = has ? curMap[t.varKey] : null

    if (t.varKey.toUpperCase() === 'PATH') {
      const entry = value.replace(/[\\/]+$/, '')
      const items = String(cur || '')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
      const dup = items.some((i) => normLower(i) === normLower(entry))
      if (dup) {
        plan.push({ scope, name: 'Path', value: cur, remark: t.remark || '', op: 'same', oldValue: cur, pathPosition: t.pathPosition })
        continue
      }
      const next = t.pathPosition === 'prepend' ? [entry, ...items].join(';') : [...items, entry].join(';')
      plan.push({
        scope, name: 'Path', value: next, remark: t.remark || '', op: has ? 'update' : 'create',
        oldValue: cur, pathPosition: t.pathPosition, pathEntry: entry
      })
      continue
    }

    if (has && cur === value) {
      plan.push({ scope, name: t.varKey, value, remark: t.remark || '', op: 'same', oldValue: cur })
    } else {
      plan.push({
        scope, name: t.varKey, value, remark: t.remark || '',
        op: has ? 'update' : 'create', oldValue: cur
      })
    }
  }
  return plan
}

/** 依据规则判断该软件是否已被本工具接管 */
function isManaged(ruleObj, installPath, currentEnv) {
  const plan = buildVarPlan(ruleObj, installPath, currentEnv)
  const homeVars = plan.filter((p) => p.name.toUpperCase() !== 'PATH' && p.op !== 'same')
  // 所有 HOME 类变量均已存在且值一致，且 PATH 条目已存在 => 已纳入管理
  if (homeVars.length > 0) return false
  const pathPlan = plan.find((p) => p.name.toUpperCase() === 'PATH')
  if (pathPlan && pathPlan.op !== 'same') return false
  return plan.length > 0
}

function driveLetterOf(dir) {
  const m = String(expandWin(dir) || '').replace(/\//g, '\\').match(/^([A-Za-z]:)/)
  return m ? m[1].toUpperCase() : ''
}

function isUncPath(dir) {
  return /^\\\\[^\\]/.test(String(expandWin(dir) || '').replace(/\//g, '\\'))
}

/** 仅在调用方明确要求时跳过网络盘 / U 盘。盘符类型读不到时保留本地路径。 */
async function filterVolumeRoots(dirs, options) {
  const skipNetwork = options.skipNetwork === true
  const skipUsb = options.skipUsb === true
  if (!skipNetwork && !skipUsb) return dirs
  let types = {}
  try { types = await registry.getDriveTypes() } catch { types = {} }
  return dirs.filter((dir) => {
    if (skipNetwork && isUncPath(dir)) return false
    const letter = driveLetterOf(dir)
    const kind = letter ? types[letter] : ''
    if (skipNetwork && kind === 'Network') return false
    if (skipUsb && kind === 'Removable') return false
    return true
  })
}

/* ------------------------------ 主扫描流程 ------------------------------ */

/**
 * @param {{deep?:boolean, customDirs?:string[], excludeDirs?:string[], excludeNames?:string[],
 *          signal?:{cancelled:boolean}, onProgress?:(info:object)=>void}} options
 */
async function scan(options = {}) {
  const signal = options.signal || { cancelled: false }
  const deep = !!options.deep
  const maxDepth = deep ? 3 : 2
  const budget = deep ? 12000 : 5000
  const excludeDirs = (options.excludeDirs || []).map(normLower)
  const excludeNames = (options.excludeNames || []).map((n) => String(n).toLowerCase())

  const report = (info) => {
    if (options.onProgress) options.onProgress(info)
  }

  const envData = await registry.readAllEnv()
  const currentEnv = {
    user: Object.fromEntries(envData.user.map((v) => [v.name, v.value])),
    machine: Object.fromEntries(envData.machine.map((v) => [v.name, v.value]))
  }

  report({ phase: 'registry', message: '读取注册表卸载信息…', percent: 8 })

  /* 数据源 1：注册表卸载项 */
  const uninstallEntries = await readUninstallEntries(signal)
  report({ phase: 'registry', message: `注册表读取完成（${uninstallEntries.length} 条）`, percent: 25 })
  if (signal.cancelled) return cancelledResult()

  /* 数据源 2 + 3：PATH 目录与默认/自定义目录 */
  const pathDirs = [
    ...String(currentEnv.user.Path || '').split(';'),
    ...String(currentEnv.machine.Path || '').split(';')
  ].map((s) => s.trim()).filter(Boolean)

  const skipSystem = store.readConfig().scanSkipSystemDirs !== false && options.skipSystemDirs !== false
  const customKeys = new Set((options.customDirs || []).map((d) => normLower(expandWin(d))))
  let extraDirs = [...DEFAULT_SCAN_DIRS, ...(options.customDirs || [])]
  if (skipSystem) {
    extraDirs = extraDirs.filter((d) => customKeys.has(normLower(expandWin(d))) || !isSystemProtectedDir(d))
  }
  report({ phase: 'dirs', message: skipSystem ? '遍历候选目录（已跳过系统保护目录）…' : '遍历候选目录…', percent: 35 })

  let scanRoots = [...new Set([...pathDirs, ...extraDirs])]
  if (options.skipNetwork === true || options.skipUsb === true) {
    scanRoots = await filterVolumeRoots(scanRoots, options)
  }
  const dirHits = walkDirs(scanRoots, maxDepth, budget, signal, (n) => {
    report({ phase: 'dirs', message: `已遍历 ${n} 个目录…`, percent: 35 + Math.min(25, n / budget * 25) })
  }, { skipSystem })
  if (signal.cancelled) return cancelledResult()

  const dirList = dirHits
    .filter((d) => !excludeDirs.some((x) => normLower(d.dir).startsWith(x)))
    .map((d) => d.dir)

  /* 数据源 4：HOME 类变量 */
  const homeVars = Object.entries({ ...currentEnv.machine, ...currentEnv.user })
    .filter(([k]) => /(_HOME|_ROOT|GOROOT|CARGO_HOME|ANDROID_HOME|DOTNET_ROOT|MAVEN_HOME|GRADLE_HOME|MYSQL_HOME)$/i.test(k))
    .map(([k, v]) => ({ key: k, value: expandWin(String(v)) }))
    .filter((x) => dirExists(x.value))

  report({ phase: 'match', message: '按识别规则匹配…', percent: 65 })

  /* 匹配规则 */
  const allRules = rules.listRules().filter((r) => r.enable !== false)
  const found = new Map() // installPathLower -> item

  const addItem = (ruleObj, installPath, source, extra) => {
    if (!installPath || !dirExists(installPath)) return
    const key = normLower(installPath)
    if (excludeDirs.some((x) => key.startsWith(x))) return
    if (found.has(key)) {
      const prev = found.get(key)
      if (!prev.sources.includes(source)) prev.sources.push(source)
      return
    }
    found.set(key, {
      ruleId: ruleObj.id,
      name: ruleObj.name,
      category: ruleObj.category,
      installPath,
      sources: [source],
      version: (extra && extra.version) || '',
      exePath: (extra && extra.exePath) || '',
      uninstall: (extra && extra.uninstall) || '',
      raw: extra || {}
    })
  }

  const nameMatches = (ruleObj, text) => {
    if (!text) return false
    const t = String(text).toLowerCase()
    const hay = [ruleObj.name.toLowerCase(), ...(ruleObj.alias || []).map((a) => a.toLowerCase())]
    return hay.some((h) => h.length > 2 && t.includes(h))
  }

  // 2) PATH 目录直接命中 exe
  for (const ruleObj of allRules) {
    if (signal.cancelled) break
    const exe = ruleObj.executableName
    for (const dir of pathDirs) {
      const direct = path.join(dir, exe)
      if (fs.existsSync(direct)) {
        addItem(ruleObj, resolveInstallPath(ruleObj, dir), 'path-scan', { exePath: direct })
        break
      }
    }
  }

  // 3) 目录扫描：目录名与规则名/别名匹配，或目录内存在对应 exe
  for (const dir of dirList) {
    if (signal.cancelled) break
    for (const ruleObj of allRules) {
      const exe = ruleObj.executableName
      const direct = path.join(dir, exe)
      const bin = path.join(dir, 'bin', exe)
      if (fs.existsSync(direct)) {
        addItem(ruleObj, resolveInstallPath(ruleObj, dir), 'dir-scan', { exePath: direct })
      } else if (fs.existsSync(bin)) {
        addItem(ruleObj, resolveInstallPath(ruleObj, dir), 'dir-scan', { exePath: bin })
      }
    }
  }

  // 4) HOME 变量反向提取
  for (const ruleObj of allRules) {
    const homeVarKey = (ruleObj.envTemplate || []).map((t) => t.varKey).find((k) => /(_HOME|_ROOT)$/i.test(k))
    if (!homeVarKey) continue
    const hit = homeVars.find((h) => h.key.toUpperCase() === homeVarKey.toUpperCase())
    if (hit && dirExists(hit.value)) {
      addItem(ruleObj, resolveInstallPath(ruleObj, hit.value), 'home-var', { exePath: path.join(hit.value, ruleObj.executableName) })
    }
  }

  // 1) 注册表卸载项（按名称匹配，补充版本与卸载串）
  for (const entry of uninstallEntries) {
    if (signal.cancelled) break
    if (excludeNames.includes(entry.name.toLowerCase())) continue
    const hit = allRules.find((r) => nameMatches(r, entry.name))
    if (!hit) continue
    let loc = entry.location
    if (!dirExists(loc)) {
      // 从 DisplayIcon / UninstallString 提取目录
      const guess = extractDirFromPath(entry.icon || entry.uninstall)
      if (guess) loc = guess
    }
    if (!dirExists(loc)) continue
    addItem(hit, resolveInstallPath(hit, loc), 'registry', {
      version: entry.version,
      uninstall: entry.uninstall,
      displayName: entry.name,
      publisher: entry.publisher
    })
  }

  report({ phase: 'version', message: '检测版本信息…', percent: 78 })

  /* 版本检测 + 分组。线程数来自设置，避免几十个软件串行等版本命令。 */
  const items = [...found.values()]
  const threads = Math.min(16, Math.max(1, Number(store.readConfig().scanThreads) || 4))
  const slots = new Array(items.length)
  let done = 0
  let cursor = 0
  const worker = async () => {
    while (!signal.cancelled) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      const item = items[index]
      const ruleObj = rules.getRule(item.ruleId)
      const exePath =
        item.exePath && fs.existsSync(item.exePath)
          ? item.exePath
          : findExe(item.installPath, ruleObj.executableName)
      let version = item.version
      if (!version && exePath) version = await detectVersion(ruleObj, exePath, item.installPath, options.versionTimeoutSec)
      const plan = buildVarPlan(ruleObj, item.installPath, currentEnv)
      const managed = isManaged(ruleObj, item.installPath, currentEnv)
      slots[index] = {
        id: `${item.ruleId}::${normLower(item.installPath)}`,
        ruleId: item.ruleId,
        name: item.name,
        displayName: item.raw.displayName || item.name,
        category: item.category,
        version: version || '',
        installPath: item.installPath,
        exePath: exePath || '',
        sources: item.sources,
        managed,
        uninstall: item.uninstall,
        variables: plan,
        ignored: false
      }
      done += 1
      if (done % 3 === 0 || done === items.length) {
        report({ phase: 'version', message: `版本检测 ${done}/${items.length}…`, percent: 78 + (done / Math.max(1, items.length)) * 18 })
      }
    }
  }
  const workers = Math.min(threads, Math.max(1, items.length))
  await Promise.all(Array.from({ length: workers }, () => worker()))
  const results = slots.filter(Boolean)

  // 忽略清单
  const ignoreList = store.readConfig().scanIgnoreList || []
  for (const r of results) {
    r.ignored = ignoreList.some((x) => normLower(x) === normLower(`${r.ruleId}::${r.installPath}`)) ||
      ignoreList.some((x) => String(x).toLowerCase() === String(r.name).toLowerCase())
  }

  report({ phase: 'done', message: `扫描完成，发现 ${results.length} 项`, percent: 100 })

  return {
    scannedAt: Date.now(),
    deep,
    totalDirs: dirList.length,
    registryEntries: uninstallEntries.length,
    items: results,
    cancelled: !!signal.cancelled
  }

  function cancelledResult() {
    return { scannedAt: Date.now(), deep, items: [], cancelled: true }
  }
}

/** installPathExtract 解析 */
function resolveInstallPath(ruleObj, dir) {
  const cfg = ruleObj.installPathExtract || { mode: 'self' }
  if (cfg.mode === 'parentNLevel') {
    let p = dir
    for (let i = 0; i < (cfg.level || 1); i += 1) {
      const parent = path.dirname(p)
      if (parent === p) break
      p = parent
    }
    return p
  }
  return dir
}

/** 从 icon / uninstall 字符串提取目录 */
function extractDirFromPath(s) {
  const m = String(s || '').match(/^"?([A-Za-z]:\\[^"]*?)(\\[^\\"]+)?$/)
  if (!m) return ''
  let p = m[1]
  if (!dirExists(p)) p = path.dirname(m[0].replace(/"/g, ''))
  return dirExists(p) ? p : ''
}

/** 在目录内查找 exe（含 bin 子目录） */
function findExe(installPath, exeName) {
  const candidates = [
    path.join(installPath, exeName),
    path.join(installPath, 'bin', exeName),
    path.join(installPath, 'cmd', exeName),
    path.join(installPath, 'scripts', exeName)
  ]
  return candidates.find((c) => fs.existsSync(c)) || ''
}

/** 校验某个已安装环境（执行版本命令） */
async function validateItem(item) {
  const ruleObj = rules.getRule(item.ruleId)
  if (!ruleObj) throw new Error('识别规则不存在')
  if (!item.exePath || !fs.existsSync(item.exePath)) throw new Error('未找到可执行文件')
  const version = await detectVersion(ruleObj, item.exePath, item.installPath)
  return {
    ok: !!version,
    version,
    exePath: item.exePath,
    cmd: ruleObj.versionCmd ? `${item.exePath} ${ruleObj.versionCmd}` : item.exePath
  }
}

module.exports = {
  scan,
  validateItem,
  buildVarPlan,
  resolveInstallPath,
  detectVersion,
  extractVersion,
  DEFAULT_SCAN_DIRS,
  expandWin
}
