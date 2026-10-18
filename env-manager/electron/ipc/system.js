'use strict'
/**
 * 系统类 IPC：文件对话框 / 配置 / 日志 / 窗口控制 / 应用信息
 * fs:selectFolder / fs:selectFile / fs:saveFile / config:get / config:set / log:write
 */
const fs = require('node:fs')
const path = require('node:path')
const { app, shell } = require('electron')
const store = require('../lib/store')
const { realExePath } = require('./tool')

const startedAt = Date.now()

function register(handle, ctx) {
  /* ------------------------- 文件对话框 ------------------------- */

  handle('fs:selectFolder', async (event, options) => {
    const o = options || {}
    const res = await ctx.dialog.showOpenDialog(ctx.getWindow(), {
      title: o.title || '选择文件夹',
      defaultPath: o.defaultPath || undefined,
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || !res.filePaths.length) return { canceled: true }
    return { canceled: false, path: res.filePaths[0] }
  })

  handle('fs:selectFile', async (event, options) => {
    const o = options || {}
    const res = await ctx.dialog.showOpenDialog(ctx.getWindow(), {
      title: o.title || '选择文件',
      defaultPath: o.defaultPath || undefined,
      filters: o.filters || [{ name: '所有文件', extensions: ['*'] }],
      properties: o.multiple ? ['openFile', 'multiSelections'] : ['openFile']
    })
    if (res.canceled || !res.filePaths.length) return { canceled: true }
    return { canceled: false, path: res.filePaths[0], paths: res.filePaths }
  })

  handle('fs:saveFile', async (event, options) => {
    const o = options || {}
    const res = await ctx.dialog.showSaveDialog(ctx.getWindow(), {
      title: o.title || '保存文件',
      defaultPath: o.defaultPath || undefined,
      filters: o.filters || [{ name: '所有文件', extensions: ['*'] }]
    })
    if (res.canceled || !res.filePath) return { canceled: true }
    return { canceled: false, path: res.filePath }
  })

  /* 读写纯文本文件（导入导出清单用） */
  handle('fs:readTextFile', async (event, file) => {
    if (!file || !fs.existsSync(file)) throw new Error('文件不存在')
    const buf = fs.readFileSync(file)
    if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le').replace(/^\uFEFF/, '')
    return buf.toString('utf8').replace(/^\uFEFF/, '')
  })

  handle('fs:writeTextFile', async (event, payload) => {
    const { file, content, bom } = payload || {}
    if (!file) throw new Error('目标路径为空')
    store.ensureDir(path.dirname(file))
    fs.writeFileSync(file, (bom ? '\uFEFF' : '') + String(content ?? ''), 'utf8')
    store.writeLog('info', '写入文件', file)
    return { file, size: fs.statSync(file).size }
  })

  /* ------------------------- 程序配置 ------------------------- */

  handle('config:get', async () => {
    return {
      config: store.readConfig(),
      paths: {
        appData: store.appDataDir(),
        config: store.configFile(),
        snapshots: store.snapshotDir(),
        logs: store.logDir(),
        auditDir: store.auditDir(),
        backupDir: store.resolvedBackupDir(),
        defaultBackupDir: store.defaultBackupDir(),
        cacheDir: store.resolvedCacheDir(),
        devRoot: store.resolvedDevRoot(),
        exports: path.join(store.appDataDir(), 'exports')
      },
      install: store.readInstallInfo()
    }
  })

  handle('config:set', async (event, patch) => {
    const next = store.writeConfig(patch || {})
    // 全局快捷键相关配置变化时即时重注册
    const keys = patch || {}
    let hotkey = null
    if ('hotkeySearch' in keys || 'hotkeyEnabled' in keys) {
      try { hotkey = require('electron').app.rebuildHotkeys?.() || null } catch { /* ignore */ }
    }
    if ('trayMenuEnabled' in keys || 'trayMenuItems' in keys || 'trayIconTheme' in keys) {
      try { require('electron').app.refreshTray?.() } catch { /* ignore */ }
    }
    if ('maxConcurrentDownloads' in keys) {
      try { require('electron').app.setDownloadConcurrency?.(keys.maxConcurrentDownloads) } catch { /* ignore */ }
    }
    if ('logKeepDays' in keys || 'logKeepCount' in keys) {
      try { store.pruneLogFiles() } catch { /* 清理失败不回滚已保存的设置 */ }
    }
    if ('snapshotMax' in keys) {
      try { require('../lib/ops').pruneSnapshots(next.snapshotMax) } catch { /* 清理失败不回滚设置 */ }
    }
    if ('backupKeep' in keys) {
      try { require('../lib/ops').pruneBackups(next.backupKeep) } catch { /* 清理失败不回滚设置 */ }
    }
    return { config: next, paths: { backupDir: store.resolvedBackupDir() }, hotkey }
  })

  /* ------------------------- 日志 ------------------------- */

  handle('log:write', async (event, payload) => {
    const { level, message, detail } = payload || {}
    return store.writeLog(level || 'info', message || '', detail)
  })

  handle('log:list', async () => ({ dir: store.logDir(), files: store.listLogFiles() }))

  handle('log:clear', async () => store.clearLogs())

  handle('log:openDir', async () => {
    store.ensureDir(store.logDir())
    await shell.openPath(store.logDir())
    return store.logDir()
  })

  handle('win:resetBounds', async () => {
    const w = ctx.getWindow()
    const { screen } = require('electron')
    const wa = screen.getPrimaryDisplay().workArea
    const bounds = {
      x: Math.max(0, wa.x + Math.round((wa.width - 1200) / 2)),
      y: Math.max(0, wa.y + Math.round((wa.height - 750) / 2)),
      width: Math.min(1200, wa.width),
      height: Math.min(750, wa.height)
    }
    if (w) {
      w.unmaximize()
      w.setBounds(bounds)
    }
    store.writeConfig({ windowBounds: { ...bounds, maximized: false } })
    return bounds
  })

  /* ------------------------- 应用信息 ------------------------- */

  handle('app:getInfo', async () => ({
    name: 'WinEnvManager',
    title: 'WinEnv管家',
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
    platform: `${process.platform} ${process.arch}`,
    exe: realExePath(),
    packaged: app.isPackaged,
    resources: process.resourcesPath,
    uptime: Date.now() - startedAt,
    startedAt
  }))

  /* ------------------------- 窗口控制 ------------------------- */

  handle('win:minimize', async () => {
    const w = ctx.getWindow()
    if (w) w.minimize()
    return true
  })

  handle('win:maximizeToggle', async () => {
    const w = ctx.getWindow()
    if (!w) return false
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
    return w.isMaximized()
  })

  handle('win:isMaximized', async () => {
    const w = ctx.getWindow()
    return !!(w && w.isMaximized())
  })

  handle('win:close', async () => {
    const w = ctx.getWindow()
    if (w) w.close()
    return true
  })

  handle('win:hideToTray', async () => {
    const w = ctx.getWindow()
    if (w) w.hide()
    return true
  })

  /* 渲染进程确认退出：只有用户点「继续退出」才真正退出；退出前按设置生成关闭快照 */
  handle('app:quitDecision', async (event, proceed) => {
    if (!proceed) return false
    try {
      const cfg = store.readConfig()
      if (cfg.snapshotTrigger === 'quit' && !cfg.snapshotPaused) {
        const ops = require('../lib/ops')
        await ops.createSnapshotV2({ name: '退出自动快照', note: '软件关闭时自动生成', auto: true })
        ops.pruneSnapshots(cfg.snapshotMax)
      }
    } catch { /* 快照失败不阻断退出 */ }
    ctx.allowQuit()
    return true
  })

  /* 审计日志：只读查看 + 打开目录（软件内不提供删除入口） */
  handle('audit:list', async (event, limit) => ({ items: store.listAudit(Number(limit) || 500), dir: store.auditDir() }))

  handle('audit:openDir', async () => {
    store.ensureDir(store.auditDir())
    await shell.openPath(store.auditDir())
    return store.auditDir()
  })

  /* 一键重置全部设置（不删快照 / 备份 / 审计） */
  handle('config:resetSettings', async () => {
    const keep = {
      windowBounds: store.readConfig().windowBounds,
      lastScheduledBackupAt: store.readConfig().lastScheduledBackupAt,
      lastAuditAt: store.readConfig().lastAuditAt
    }
    const next = { ...store.DEFAULT_CONFIG, ...keep }
    store.writeConfig(next)
    return next
  })

  /* 手动触发配置完整性检查：清缓存重读，损坏时才按 configAutoRepair 修复并写回 */
  handle('config:repairNow', async () => {
    const cfg = store.reloadConfig()
    const info = store.configRepairInfo()
    return {
      repaired: !!info.repaired,
      backupUsed: info.backupUsed || '',
      reason: info.reason || '',
      config: cfg
    }
  })

  /* 启动检查更新：离线模式下直接跳过；只读版本清单，不下载、不安装 */
  handle('app:checkUpdate', async () => checkForUpdate())

  /* 开机自启 */
  handle('app:setAutoLaunch', async (event, enabled) => {
    const exe = realExePath()
    app.setLoginItemSettings({
      openAtLogin: !!enabled,
      path: exe,
      args: ['--minimized']
    })
    const settings = app.getLoginItemSettings()
    store.writeConfig({ autoLaunch: !!enabled })
    return settings.openAtLogin
  })

  handle('app:getAutoLaunch', async () => {
    const s = app.getLoginItemSettings()
    return s.openAtLogin
  })
}

function compareVer(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
  }
  return 0
}

function pickManifestVersion(json, channel) {
  if (!json || typeof json !== 'object') return { latest: '', notes: '' }
  if (channel === 'pre') {
    return {
      latest: String(json.pre || json.prerelease || json.beta || json.preview || json.version || json.latest || ''),
      notes: String(json.preNotes || json.betaNotes || json.notes || json.changelog || '')
    }
  }
  return {
    latest: String(json.stable || json.version || json.latest || ''),
    notes: String(json.notes || json.changelog || '')
  }
}

/** 只读版本清单。预发布通道优先读 pre / beta，没有时回落正式版本号。 */
async function checkForUpdate() {
  const cfg = store.readConfig()
  const install = store.readInstallInfo()
  const current = install.version || app.getVersion()
  const channel = cfg.updateChannel === 'pre' || cfg.updateAllowBeta ? 'pre' : 'stable'
  store.writeConfig({ lastUpdateCheckAt: Date.now() })
  if (cfg.offlineMode) {
    return { checked: false, current, latest: current, hasUpdate: false, channel, reason: '离线模式已开启，不发起网络请求' }
  }
  const url = String(cfg.updateUrl || install.updateUrl || '').trim()
  if (!url) {
    return { checked: false, current, latest: current, hasUpdate: false, channel, reason: '未配置更新地址' }
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`更新清单请求失败（${res.status}）`)
  const text = await res.text()
  let latest = ''
  let notes = ''
  try {
    const picked = pickManifestVersion(JSON.parse(text), channel)
    latest = picked.latest
    notes = picked.notes
  } catch {
    const m = text.match(/(\d+\.\d+\.\d+)/)
    latest = m ? m[1] : ''
  }
  if (!latest) throw new Error('更新清单里没有版本号')
  return { checked: true, current, latest, notes, channel, hasUpdate: compareVer(latest, current) > 0, url }
}

module.exports = { register, checkForUpdate }
