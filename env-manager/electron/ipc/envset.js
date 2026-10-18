'use strict'
/**
 * 环境配置集 IPC：配置集 CRUD / 互斥组 / 变量模板 / 项目文件夹监听 / 临时终端注入
 */
const { spawn, execFile } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const envset = require('../lib/envset')
const store = require('../lib/store')

let watcher = null
let watchCtx = null
let watchTick = false
/** setId -> { inside, coolUntil } 进入目录才提醒，离开后再进入才会再问 */
const watchState = new Map()
const WATCH_MS = 6000
const COOL_MS = 3 * 60 * 1000

function register(handle, ctx) {
  /* ------------------------------ 配置集 CRUD ------------------------------ */

  handle('envset:list', async () => ({ sets: envset.listSets(), mutex: envset.listMutex() }))
  handle('envset:get', async (e, id) => envset.getSet(id))
  handle('envset:create', async (e, patch) => envset.createSet(patch))
  handle('envset:update', async (e, p) => envset.updateSet(p.id, p.patch))
  handle('envset:delete', async (e, id) => envset.deleteSet(id))
  handle('envset:duplicate', async (e, id) => envset.duplicateSet(id))
  handle('envset:export', async (e, id) => envset.exportSet(id))
  handle('envset:import', async (e, json) => {
    const cfg = store.readConfig()
    const res = envset.importSet(json, { conflict: cfg.envsetImportConflict || 'merge' })
    store.writeLog('info', `导入配置集「${res.name}」`, { merged: res.merged, added: res.added })
    return res
  })

  /** 导出为文件（可去除敏感值） */
  handle('envset:exportToFile', async (e, p) => {
    const obj = envset.exportSet(p.id)
    if (p.desensitize) {
      obj.set.variables = obj.set.variables.map((v) => ({ ...v, value: maskSensitive(v.value) }))
    }
    const saved = await ctx.dialog.showSaveDialog(ctx.getWindow(), {
      title: '导出配置集',
      defaultPath: `${obj.set.name}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (saved.canceled || !saved.filePath) return { canceled: true }
    fs.writeFileSync(saved.filePath, JSON.stringify(obj, null, 2), 'utf8')
    store.writeLog('info', '导出配置集', saved.filePath)
    return { file: saved.filePath }
  })

  /* ------------------------------ 互斥组 ------------------------------ */

  handle('envset:listMutex', async () => envset.listMutex())
  handle('envset:createMutex', async (e, patch) => envset.createMutex(patch))
  handle('envset:updateMutex', async (e, p) => envset.updateMutex(p.id, p.patch))
  handle('envset:deleteMutex', async (e, id) => envset.deleteMutex(id))
  handle('envset:assignMutex', async (e, p) => envset.assignMutex(p.setId, p.mutexId))
  handle('envset:membersOf', async (e, mutexId) => envset.membersOf(mutexId))

  /* ------------------------------ 变量模板库 ------------------------------ */

  handle('envset:templates', async () => envset.listTemplates())
  handle('envset:getTemplate', async (e, name) => envset.template(name))

  /* ------------------------------ 临时终端注入 ------------------------------ */

  /**
   * 启动 CMD / PowerShell 子进程，注入环境变量后进入项目目录
   * 变量仅存在于子进程上下文，不写入注册表
   */
  handle('envset:launchTerminal', async (e, p) => {
    const { shell = 'cmd', cwd = '', env = {}, injectDraft = false, title = 'WinEnv 临时终端' } = p || {}
    const merged = buildLaunchEnv(env, injectDraft ? p.draftChanges : null)
    const requested = String(cwd || '')
    const workDir = requested && fs.existsSync(requested) ? requested : null
    const finalCwd = workDir || store.resolvedDevRoot()
    const warning = requested && !workDir ? `项目目录不存在，终端改在默认目录打开：${finalCwd}` : ''
    const safeTitle = String(title || 'WinEnv').replace(/["&|<>^\r\n]/g, ' ').slice(0, 80)
    let cmd
    let args
    if (shell === 'powershell') {
      cmd = 'powershell.exe'
      const lines = [
        `Write-Host '  [WinEnv管家] 配置集已注入当前窗口，关闭后失效，未写入注册表' -ForegroundColor Cyan`
      ]
      if (workDir) lines.unshift(`Set-Location -LiteralPath '${workDir.replace(/'/g, "''")}'`)
      args = ['-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', lines.join('; ')]
    } else {
      cmd = 'cmd.exe'
      args = ['/K', `title ${safeTitle}`]
    }

    const child = spawn(cmd, args, {
      cwd: finalCwd,
      env: merged,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      shell: false
    })
    child.unref()

    store.writeLog('info', `启动临时终端（${shell}）`, { cwd: finalCwd, vars: Object.keys(env || {}).length })
    return { pid: child.pid, shell, cwd: finalCwd, injected: Object.keys(env || {}).length, warning }
  })

  /* ------------------------------ 项目文件夹监听 ------------------------------ */

  handle('envset:syncWatch', async () => syncWatch(ctx))

  /** 兼容旧调用：保存配置集后刷新全部监听，不再只盯最后保存的那一个目录 */
  handle('envset:startWatch', async () => syncWatch(ctx))

  handle('envset:stopWatch', async () => {
    stopWatch()
    return true
  })

  handle('envset:ignorePrompt', async (e, setId) => envset.ignorePrompt(setId))

  /* 快照对比 / 基线标记支持由 snapshot 模块提供 */
}

function stopWatch() {
  if (watcher) {
    clearInterval(watcher)
    watcher = null
  }
  watchCtx = null
  watchState.clear()
}

function isPathName(name) {
  return String(name || '').toUpperCase() === 'PATH'
}

function splitPath(value) {
  return String(value || '').split(';').map((s) => s.trim()).filter(Boolean)
}

function joinUnique(parts) {
  const out = []
  const seen = new Set()
  for (const part of parts) {
    const key = part.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(part)
  }
  return out.join(';')
}

function deletePathKeys(env) {
  for (const key of Object.keys(env)) {
    if (isPathName(key)) delete env[key]
  }
}

/**
 * 子进程环境以当前进程为准（已含系统 PATH + 用户 PATH，且百分号已展开）。
 * 配置集里的 PATH 只追加条目，不能整段替换，否则临时终端会丢掉系统目录。
 */
function buildLaunchEnv(extra, draftChanges) {
  const merged = { ...process.env }
  delete merged.ELECTRON_RUN_AS_NODE
  const extraEntries = []
  for (const [name, value] of Object.entries(extra || {})) {
    if (!name) continue
    if (isPathName(name)) extraEntries.push(...splitPath(value))
    else merged[name] = String(value)
  }
  if (Array.isArray(draftChanges)) {
    for (const change of draftChanges) {
      const name = String(change.name || '')
      if (!name) continue
      if (isPathName(name)) {
        if (change.action !== 'delete') extraEntries.push(...splitPath(change.value))
        continue
      }
      if (change.action === 'delete') delete merged[name]
      else merged[name] = String(change.value ?? '')
    }
  }
  const current = splitPath(merged.Path || merged.PATH || '')
  deletePathKeys(merged)
  merged.Path = joinUnique([...current, ...extraEntries])
  return merged
}

function watchTargets() {
  return envset.listSets().filter((set) => {
    if (set.type !== 'project' || !set.folderWatch || !set.projectDir) return false
    if (envset.isIgnored(set.id)) return false
    try { return fs.existsSync(set.projectDir) } catch (_) { return false }
  }).map((set) => ({
    setId: set.id,
    dir: set.projectDir,
    name: set.name || set.id
  }))
}

function normDir(dir) {
  return path.resolve(String(dir || '')).replace(/[\\/]+$/, '').toLowerCase()
}

function queryExplorerDirs() {
  const script = [
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "$OutputEncoding = [System.Text.Encoding]::UTF8",
    "$ErrorActionPreference = 'SilentlyContinue'",
    "$shell = New-Object -ComObject Shell.Application",
    "foreach ($w in @($shell.Windows())) {",
    "  try {",
    "    $p = [string]$w.Document.Folder.Self.Path",
    "    if ($p) { Write-Output $p }",
    "  } catch {}",
    "}"
  ].join('\n')
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      timeout: 8000,
      encoding: 'utf8'
    }, (err, stdout) => {
      if (err) return resolve([])
      resolve(String(stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean))
    })
  })
}

function syncWatch(ctx) {
  watchCtx = ctx
  const targets = watchTargets()
  if (!targets.length) {
    stopWatch()
    return { started: false, count: 0 }
  }
  if (!watcher) watcher = setInterval(() => tickWatch(), WATCH_MS)
  return { started: true, count: targets.length }
}

async function tickWatch() {
  if (watchTick || !watchCtx) return
  watchTick = true
  try {
    const targets = watchTargets()
    if (!targets.length) {
      stopWatch()
      return
    }
    const openDirs = (await queryExplorerDirs()).map(normDir)
    const now = Date.now()
    const alive = new Set()
    for (const target of targets) {
      alive.add(target.setId)
      const key = normDir(target.dir)
      const inside = openDirs.some((dir) => dir === key || dir.startsWith(`${key}\\`))
      const prev = watchState.get(target.setId) || { inside: false, coolUntil: 0 }
      if (!inside) {
        watchState.set(target.setId, { inside: false, coolUntil: prev.coolUntil })
        continue
      }
      const entered = !prev.inside
      if (!entered || prev.coolUntil > now) {
        watchState.set(target.setId, { inside: true, coolUntil: prev.coolUntil })
        continue
      }
      watchState.set(target.setId, { inside: true, coolUntil: now + COOL_MS })
      const win = watchCtx.getWindow && watchCtx.getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('envset:project-activity', {
          setId: target.setId,
          dir: target.dir,
          name: target.name,
          reason: 'enter',
          at: now
        })
      }
    }
    for (const id of [...watchState.keys()]) {
      if (!alive.has(id)) watchState.delete(id)
    }
  } finally {
    watchTick = false
  }
}

/** 敏感值脱敏 */
function maskSensitive(value) {
  let out = String(value || '')
  out = out.replace(/([A-Za-z0-9_\-.]{20,})/g, (m) => (m.length > 12 ? `${m.slice(0, 4)}****${m.slice(-4)}` : m))
  out = out.replace(/(password|passwd|pwd|secret|token|apikey|api_key|access[_-]?key)([=:]\s*)(\S+)/gi,
    (m, a, b, c) => `${a}${b}${'*'.repeat(Math.min(10, c.length))}`)
  return out
}

module.exports = { register, maskSensitive, stopWatch, buildLaunchEnv }
