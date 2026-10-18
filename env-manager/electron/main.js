'use strict'
/**
 * Electron 主进程入口
 * 负责：窗口 / 托盘 / 权限 / 单一实例 / IPC 注册 / 配置持久化
 * 所有注册表与文件读写逻辑均在本进程（或本进程派生的子进程）中执行。
 */
const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, shell, nativeTheme, screen, globalShortcut } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const store = require('./lib/store')
const registry = require('./lib/registry')
const { registerAll } = require('./ipc')
const { TaskManager } = require('./lib/tasks')
const devenvIpc = require('./ipc/devenv')

const APP_TITLE = 'WinEnv管家'
const MIN_WIDTH = 1000
const MIN_HEIGHT = 640
const DEFAULT_WIDTH = 1200
const DEFAULT_HEIGHT = 750

let mainWindow = null
let tray = null
let isQuitting = false
let saveBoundsTimer = null
let externalTimer = null
const taskManager = new TaskManager()

/* --------------------------- 窗口位置持久化 --------------------------- */

function isVisibleOnSomeDisplay(bounds) {
  if (!bounds || typeof bounds.x !== 'number' || typeof bounds.y !== 'number') return false
  return screen.getAllDisplays().some((d) => {
    const wa = d.workArea
    return (
      bounds.x < wa.x + wa.width &&
      bounds.x + (bounds.width || DEFAULT_WIDTH) > wa.x &&
      bounds.y < wa.y + wa.height &&
      bounds.y + (bounds.height || DEFAULT_HEIGHT) > wa.y
    )
  })
}

function getInitialBounds() {
  const cfg = store.readConfig()
  if (cfg.rememberWindow === false) return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }
  const saved = cfg.windowBounds
  if (saved && isVisibleOnSomeDisplay(saved)) {
    return {
      x: saved.x,
      y: saved.y,
      width: Math.max(saved.width || DEFAULT_WIDTH, MIN_WIDTH),
      height: Math.max(saved.height || DEFAULT_HEIGHT, MIN_HEIGHT)
    }
  }
  return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }
}

function persistBounds() {
  if (store.readConfig().rememberWindow === false) return
  if (saveBoundsTimer) clearTimeout(saveBoundsTimer)
  saveBoundsTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const maximized = mainWindow.isMaximized()
    const bounds = maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds()
    store.writeConfig({ windowBounds: { ...bounds, maximized } })
  }, 400)
}

/* ------------------------------- 图标 ------------------------------- */

function iconPath() {
  const candidates = [
    path.join(__dirname, '..', 'dist', 'icon.ico'),
    path.join(__dirname, '..', 'build', 'icon.ico'),
    path.join(process.resourcesPath || '', 'icon.ico')
  ]
  return candidates.find((p) => p && fs.existsSync(p)) || null
}

function appIcon() {
  const p = iconPath()
  if (p) {
    const img = nativeImage.createFromPath(p)
    if (!img.isEmpty()) return img
  }
  return nativeImage.createEmpty()
}

/** 托盘图标按设置选择深浅版本：跟随系统 / 固定浅色 / 固定深色；无对应资源时回退默认图标
 *  缩放按系统 DPI 走，固定 16px 在 150%/200% 屏上会被系统放大变糊。
 *  ico 内含 16/24/32/48，resize 时按当前缩放挑最接近的基础尺寸。 */
function trayIconImage() {
  const theme = store.readConfig().trayIconTheme || 'auto'
  const preferDark = theme === 'dark' || (theme === 'auto' && nativeTheme.shouldUseDarkColors)
  const candidates = preferDark
    ? [path.join(__dirname, '..', 'dist', 'icon-dark.ico'), path.join(__dirname, '..', 'build', 'icon-dark.ico')]
    : [path.join(__dirname, '..', 'dist', 'icon-light.ico'), path.join(__dirname, '..', 'build', 'icon-light.ico')]
  candidates.push(path.join(__dirname, '..', 'dist', 'icon.ico'), path.join(__dirname, '..', 'build', 'icon.ico'), path.join(process.resourcesPath || '', 'icon.ico'))
  const p = candidates.find((x) => x && fs.existsSync(x))
  if (p) {
    const img = nativeImage.createFromPath(p)
    if (!img.isEmpty()) {
      // 16 逻辑像素 × 缩放比例，吸附到 ico 里实际包含的 16/24/32/48，
      // 避免 40px 这类没有对应位图的中间值被插值放大。
      const scale = (screen.getPrimaryDisplay() || {}).scaleFactor || 1
      const want = 16 * scale
      const sizes = [16, 24, 32, 48]
      const target = sizes.reduce((best, s) => (Math.abs(s - want) < Math.abs(best - want) ? s : best), 16)
      return img.resize({ width: target, height: target, quality: 'best' })
    }
  }
  return nativeImage.createEmpty()
}

/* ------------------------------ 主窗口 ------------------------------ */

function createWindow() {
  const bounds = getInitialBounds()
  const cfg = store.readConfig()

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    title: APP_TITLE,
    icon: appIcon(),
    backgroundColor: cfg.theme === 'dark' ? '#141414' : '#f5f6f8',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      webSecurity: true
    }
  })

  // 页面 <title> 不能把窗口标题改回旧文案
  mainWindow.on('page-title-updated', (e) => {
    e.preventDefault()
    mainWindow.setTitle(APP_TITLE)
  })

  mainWindow.setAutoHideMenuBar(false)
  mainWindow.setMenuBarVisibility(true)

  const devUrl = process.env.WEM_DEV_SERVER
  if (devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    const minimized = cfg.startMinimized || process.argv.includes('--minimized') || process.argv.includes('--hidden')
    if (minimized) mainWindow.hide()
    else mainWindow.show()
  })

  mainWindow.on('resize', persistBounds)
  mainWindow.on('move', persistBounds)

  // 最小化按钮行为：可配置为隐藏到托盘
  mainWindow.on('minimize', () => {
    const c = store.readConfig()
    if (c.minBtnAction === 'tray') {
      mainWindow.hide()
    }
  })

  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximize-changed', true))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximize-changed', false))

  // 关闭行为由设置页的托盘行为开关决定
  mainWindow.on('close', (e) => {
    const c = store.readConfig()
    if (!isQuitting && c.trayAction === 'minimize') {
      e.preventDefault()
      mainWindow.hide()
      return false
    }
    // 有未保存草稿时询问（渲染进程通过 before-quit 钩子自行处理）
    return true
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 外链一律用系统浏览器打开，禁止在应用内导航
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  return mainWindow
}

function getWindow() {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

function showWindow() {
  const w = getWindow() || createWindow()
  if (w.isMinimized()) w.restore()
  w.show()
  w.focus()
}

/* ------------------------------- 托盘 ------------------------------- */

function createTray() {
  tray = new Tray(trayIconImage())
  tray.setToolTip(APP_TITLE)
  refreshTrayMenu()
  tray.on('click', () => showWindow())
  // 双击动作可配置：主窗口 / 快照面板 / PATH 面板
  tray.on('double-click', () => {
    const action = store.readConfig().trayDblClick || 'show'
    if (action === 'snapshot') navigateTo('#/snapshot')
    else if (action === 'path') navigateTo('#/path')
    else showWindow()
  })
  // 系统深浅色变化时重建托盘图标（跟随系统模式）
  nativeTheme.on('updated', () => {
    try { tray?.setImage(trayIconImage()) } catch { /* ignore */ }
  })
}

function navigateTo(hash) {
  showWindow()
  getWindow()?.webContents.executeJavaScript(`location.hash = '${hash}';`).catch(() => {})
}

function refreshTray() {
  if (!tray) return
  try { tray.setImage(trayIconImage()) } catch { /* 图标文件缺失时保留当前图标 */ }
  refreshTrayMenu()
}

function refreshTrayMenu() {
  if (!tray) return
  const cfg = store.readConfig()
  if (cfg.trayMenuEnabled === false) {
    // 菜单总开关关闭：右键只剩「显示主窗口 / 退出」
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => showWindow() },
      { type: 'separator' },
      { label: '退出程序', click: () => { isQuitting = true; app.quit() } }
    ]))
    return
  }
  const items = cfg.trayMenuItems || {}
  const menu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => showWindow() },
    { type: 'separator' },
    ...(items.backup === false ? [] : [{
      label: '立即执行环境变量备份',
      click: async () => {
        try {
          const ops = require('./lib/ops')
          const c = store.readConfig()
          const res = await ops.createBackupV2({
            format: c.autoBackupFormat || 'json',
            prefix: 'TrayBackup',
            backupType: 'increment',
            password: c.backupPassword || ''
          })
          if (getWindow()) getWindow().webContents.send('tray:action', { type: 'backup-done', file: res.file })
        } catch (err) {
          dialog.showErrorBox('备份失败', err.message)
        }
      }
    }]),
    ...(items.explorer === false ? [] : [{
      label: '重启资源管理器',
      click: async () => {
        try {
          await registry.reloadExplorer()
          if (getWindow()) getWindow().webContents.send('tray:action', { type: 'explorer-restarted' })
        } catch (err) {
          dialog.showErrorBox('操作失败', err.message)
        }
      }
    }]),
    ...(items.toolbox === false ? [] : [{ label: '打开快捷工具箱', click: () => navigateTo('#/toolbox') }]),
    ...(items.devenv === false ? [] : [{ label: '打开开发环境管理', click: () => navigateTo('#/devenv') }]),
    { type: 'separator' },
    {
      label: '退出程序',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
}

/* 窗口顶栏菜单：覆盖 Electron 默认的英文 File/Edit/View/Window/Help */
function setAppMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '显示主窗口', click: () => showWindow() },
        { type: 'separator' },
        { label: '退出', accelerator: 'Alt+F4', click: () => { isQuitting = true; app.quit() } }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '删除', role: 'delete' },
        { type: 'separator' },
        { label: '全选', role: 'selectAll' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', role: 'reload' },
        { type: 'separator' },
        { label: '实际大小', role: 'resetZoom' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { type: 'separator' },
        { label: '切换全屏', role: 'togglefullscreen' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { label: '最小化', role: 'minimize' },
        { label: '关闭', role: 'close' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: '环境变量总览', click: () => navigateTo('#/overview') },
        { label: '程序设置', click: () => navigateTo('#/settings') },
        { type: 'separator' },
        { label: '关于 WinEnv管家', click: () => navigateTo('#/about') }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/* --------------------------- 单一实例 / CLI 启动 --------------------------- */

app.setAppUserModelId('com.winenvmanager.app')

/* CLI 模式：--cli 不启动界面、不请求单实例锁，与运行中的图形界面互不干扰，执行完立即退出。
 * portable 单文件 exe 是 GUI 子系统，双击直接运行时 stdout/stderr 不一定接回终端，
 * 看不到任何输出也不像报错。没带 --cli 时直接显示用法，避免看起来像「点了没反应」。
 */
const cliIdx = process.argv.indexOf('--cli')
/* 系统任务计划唤起：--scheduled-run <taskId>，无界面执行后立即退出。
 * 只允许备份 / 扫描 / 导出类只读任务，修改类操作不得由定时任务触发。
 */
const schedIdx = process.argv.indexOf('--scheduled-run')
if (cliIdx >= 0) {
  app.whenReady().then(async () => {
    const { run } = require('./lib/cli')
    const outIdx = process.argv.indexOf('--cli-out')
    const outFile = outIdx >= 0 ? process.argv[outIdx + 1] : ''
    const cliArgs = process.argv
      .slice(cliIdx + 1)
      .filter((a, i) => !(a === '--cli-out' || (outIdx >= 0 && i === outIdx - cliIdx - 1)))
    let code = 0
    try {
      code = await run(cliArgs, { outFile })
    } catch (err) {
      writeCliErr(err)
      code = 1
    }
    app.exit(Number(code) || 0)
  }).catch((err) => {
    writeCliErr(err)
    app.exit(1)
  })
} else if (schedIdx >= 0) {
  // 由 Windows 任务计划程序唤起，后台执行一个定时任务，完成即退出
  const taskId = process.argv[schedIdx + 1] || ''
  app.whenReady().then(async () => {
    let code = 0
    try {
      if (!taskId) throw new Error('缺少任务 ID')
      store.ensureAll()
      const mod = require('./ipc/reg-extra')
      const runner = mod.runScheduledTask
      if (typeof runner !== 'function') throw new Error('定时任务执行器不可用')
      await runner(taskId)
      store.writeLog('info', '定时任务由系统计划执行完成', taskId)
    } catch (err) {
      code = 1
      try {
        store.writeLog('error', '定时任务由系统计划执行失败', { taskId, message: err && err.message })
      } catch { /* ignore */ }
    }
    app.exit(code)
  }).catch(() => app.exit(1))
} else {
  // 多实例开关（高级设置）：默认禁止多开，防止配置文件读写冲突
  const allowMultiInstance = store.readConfig().allowMultiInstance === true
  const gotLock = allowMultiInstance ? true : app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
  } else {
    app.on('second-instance', () => showWindow())
  }

  app.whenReady().then(() => startApp())
}

function writeCliErr(err) {
  try { console.error('CLI 执行失败:', err && err.message) } catch { /* ignore */ }
}

function startApp() {
  store.ensureAll()
  store.writeLog('info', '程序启动', {
    version: app.getVersion(),
    packaged: app.isPackaged,
    exe: process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe')
  })

  registerAll({
    dialog,
    shell,
    getWindow,
    allowQuit: () => {
      isQuitting = true
      app.quit()
    }
  })

  // 任务队列：注册处理器并推送进度到渲染进程
  devenvIpc.registerTaskHandlers(taskManager)
  taskManager.setConcurrency(store.readConfig().maxConcurrentDownloads || 2)
  taskManager.on('change', (task) => {
    getWindow()?.webContents.send('task:change', task)
  })

  setAppMenu()
  createWindow()
  createTray()

  nativeTheme.on('updated', () => {
    getWindow()?.webContents.send('theme:system-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
  })

  // 外部注册表变更检测
  startExternalWatcher()
  // 全局快捷键（可在设置里自定义或关闭）
  registerHotkeys()
  // 日志按保留天数和数量清理旧文件
  store.pruneLogFiles()
  // 启动自动快照（可配置时机）
  runStartupSnapshot()
  // 定时备份 / 定时审计：启动后跑一次，之后每小时检查是否到期。启动当次的更新检查由界面负责，避免重复弹窗。
  runScheduledJobs({ skipUpdate: true })
  setInterval(() => runScheduledJobs(), 60 * 60 * 1000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else showWindow()
  })
}

/** 全局快捷键：唤起主窗口并跳到全局搜索页；设置里可改键或整体关闭 */
function registerHotkeys() {
  try {
    globalShortcut.unregisterAll()
    const cfg = store.readConfig()
    if (cfg.hotkeyEnabled === false) return { ok: true, registered: false }
    const key = String(cfg.hotkeySearch || '').trim()
    if (!key) return { ok: true, registered: false }
    const registered = globalShortcut.register(key, () => {
      showWindow()
      getWindow()?.webContents.executeJavaScript("location.hash = '#/search';").catch(() => {})
    })
    if (!registered) {
      store.writeLog('warn', '全局快捷键注册失败', key)
      return { ok: false, message: `快捷键「${key}」无法注册，可能已被占用或格式不正确` }
    }
    store.writeLog('info', '全局快捷键已注册', key)
    return { ok: true, registered: true }
  } catch (err) {
    store.writeLog('warn', '全局快捷键注册失败', err && err.message)
    return { ok: false, message: (err && err.message) || '快捷键注册失败' }
  }
}
// 设置页改热键或托盘外观后即时生效
app.rebuildHotkeys = registerHotkeys
app.refreshTray = refreshTray
app.setDownloadConcurrency = (n) => {
  try { taskManager.setConcurrency(n) } catch { /* ignore */ }
}

async function runStartupSnapshot() {
  const cfg = store.readConfig()
  if (cfg.snapshotTrigger !== 'start' || cfg.snapshotPaused) return
  const t0 = Date.now()
  try {
    const ops = require('./lib/ops')
    await ops.createSnapshotV2({ name: '启动自动快照', note: '软件启动时自动生成', auto: true })
    ops.pruneSnapshots(cfg.snapshotMax)
    if (cfg.perfTrace) store.writeLog('info', '性能: 启动自动快照耗时', `${Date.now() - t0} ms`)
    store.writeLog('info', '启动自动快照完成')
  } catch (err) {
    store.writeLog('error', '启动自动快照失败', err && err.message)
  }
}

async function runScheduledUpdate(cfg) {
  const mode = cfg.updateSchedule || 'start'
  if (cfg.offlineMode || (mode !== 'daily' && mode !== 'weekly')) return
  if (!store.scheduleDue(mode, cfg.lastUpdateCheckAt)) return
  try {
    const { checkForUpdate } = require('./ipc/system')
    const res = await checkForUpdate()
    if (res && res.checked && res.hasUpdate) {
      getWindow()?.webContents.send('app:scheduled', {
        type: 'update',
        current: res.current,
        latest: res.latest,
        notes: res.notes || '',
        channel: res.channel || 'stable'
      })
      store.writeLog('info', '定时检查发现新版本', { latest: res.latest, channel: res.channel })
    }
  } catch (err) {
    store.writeLog('warn', '定时检查更新失败', err && err.message)
  }
}

async function runScheduledJobs(opts = {}) {
  const cfg = store.readConfig()
  if (!opts.skipUpdate) await runScheduledUpdate(cfg)
  if (store.scheduleDue(cfg.backupSchedule, cfg.lastScheduledBackupAt)) {
    try {
      const ops = require('./lib/ops')
      const res = await ops.createBackupV2({
        format: cfg.autoBackupFormat || 'json',
        prefix: 'ScheduledBackup',
        backupType: 'full',
        password: cfg.backupPassword || '',
        silent: true
      })
      if (Number(cfg.backupKeep) > 0) ops.pruneBackups(cfg.backupKeep)
      store.writeConfig({ lastScheduledBackupAt: Date.now() })
      store.writeLog('info', '定时备份完成', res && res.file)
      getWindow()?.webContents.send('app:scheduled', { type: 'backup', file: res && res.file })
    } catch (err) {
      store.writeLog('error', '定时备份失败', err && err.message)
    }
  }
  const auditMode = Number(cfg.auditIntervalHours) >= 168 ? 'weekly' : (Number(cfg.auditIntervalHours) > 0 ? 'daily' : 'off')
  if (store.scheduleDue(auditMode, cfg.lastAuditAt)) {
    try {
      const scanner = require('./lib/scanner')
      const result = await scanner.scan({
        deep: false,
        customDirs: cfg.scanCustomDirs || [],
        excludeDirs: cfg.scanExcludeDirs || [],
        excludeNames: cfg.scanExcludeNames || []
      })
      const issues = (result.items || []).filter((i) => i.managed === false && !i.ignored)
      store.writeConfig({ lastAuditAt: Date.now(), lastScanAt: Date.now() })
      store.writeLog('info', '定时审计完成', { total: (result.items || []).length, issues: issues.length })
      if (issues.length) {
        getWindow()?.webContents.send('app:scheduled', {
          type: 'audit',
          issues: issues.length,
          names: issues.slice(0, 8).map((i) => i.name || i.id)
        })
      }
    } catch (err) {
      store.writeLog('error', '定时审计失败', err && err.message)
    }
  }
}

function startExternalWatcher() {
  if (externalTimer) clearInterval(externalTimer)
  const tick = async () => {
    const cfg = store.readConfig()
    if (cfg.detectExternal === false) return
    try {
      const { envFingerprint } = require('./lib/ops')
      const fp = await envFingerprint()
      const last = require('./lib/meta').getExternal()
      if (last.lastHash && last.lastHash !== fp) {
        getWindow()?.webContents.send('env:external-changed', { at: Date.now() })
      }
    } catch (_) { /* ignore */ }
  }
  externalTimer = setInterval(tick, 30000)
}

app.on('window-all-closed', () => {
  const cfg = store.readConfig()
  if (cfg.trayAction === 'minimize' && !isQuitting) return
  app.quit()
})

app.on('before-quit', (e) => {
  const cfg = store.readConfig()
  if (isQuitting) {
    getWindow()?.webContents.send('app:before-quit')
    return
  }
  const win = getWindow()
  if (!win || cfg.confirmOnQuit === false) {
    isQuitting = true
    win?.webContents.send('app:before-quit')
    return
  }
  e.preventDefault()
  win.webContents.send('app:quit-query')
})

process.on('uncaughtException', (err) => {
  try {
    store.writeLog('error', '主进程未捕获异常', err && err.stack ? err.stack : String(err))
  } catch (_) { /* ignore */ }
})
