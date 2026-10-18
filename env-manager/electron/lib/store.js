'use strict'
/**
 * 本地持久化：配置 / 快照 / 日志
 * Windows 环境变量存储位置：
 *   用户变量：HKCU\Environment
 *   系统变量：HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment
 */
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { app } = require('electron')

const USER_REG_KEY = 'HKCU\\Environment'
const USER_PS_KEY = 'HKCU:\\Environment'
const MACHINE_REG_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'
const MACHINE_PS_KEY = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'

const APP_DIR_NAME = 'win-env-manager'

/** 便携模式：数据跟随程序目录，不读安装登记、不做系统级写入 */
function isPortable() {
  try {
    if (process.env.WEM_PORTABLE === '1') return true
    if ((process.argv || []).includes('--portable')) return true
    const base = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'))
    return fs.existsSync(path.join(base, '.wem-portable'))
  } catch {
    return false
  }
}

/** 安装器写入的用户数据目录优先；便携模式数据跟程序走；未安装时回落 Electron 默认目录。 */
function resolveAppDir() {
  if (isPortable()) {
    const base = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'))
    return path.join(base, 'UserData')
  }
  try {
    const { execFileSync } = require('node:child_process')
    const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\WinEnvManager', '/v', 'UserDataRoot'], {
      encoding: 'utf8', windowsHide: true,
    })
    const m = out.match(/UserDataRoot\s+REG_\w+\s+(.+)/)
    if (m && m[1].trim()) return m[1].trim()
  } catch { /* 未安装或无权限 */ }
  return path.join(app.getPath('appData'), APP_DIR_NAME)
}

const DEFAULT_CONFIG = {
  /* 界面与主题 */
  theme: 'light',                 // light | dark | system
  primaryColor: '#165DFF',
  language: 'zh-CN',
  pageSize: 20,
  rowHeight: 'middle',
  fontSize: 13,

  /* 启动 */
  loadOnStart: true,              // 启动自动加载变量
  startMinimized: false,          // 启动最小化到托盘
  autoLaunch: false,              // 开机自启

  /* 草稿与保存 */
  autoSnapshot: true,             // 写入系统前自动生成临时快照
  autoBackup: true,               // 写入系统前自动生成备份
  autoBackupFormat: 'json',       // json | reg | txt
  backupDir: '',                  // 空表示使用默认目录
  logEnabled: true,               // 操作日志开关
  trayAction: 'minimize',         // minimize | quit —— 关闭主窗口时行为
  confirmBeforeSave: true,        // 保存确认弹窗总开关
  undoMaxSteps: 50,               // 撤销重做栈最大步数
  saveValidatePath: true,         // 保存前强制校验 PATH 长度
  detectExternal: true,           // 检测外部注册表变更
  draftAutoSave: true,            // 草稿自动保存到本地缓存
  autoRestartExplorerAfterSave: false,
  keepDraftOnExit: true,          // 关闭软件时保留草稿

  /* 开发环境配置 */
  devRoot: 'C:\\dev\\soft',       // 默认安装根目录
  cacheDir: '',                   // 安装包缓存目录（空 = appData/cache）
  cacheMaxMB: 2048,
  downloadSource: 'mirror',       // official | mirror
  mirrorNode: '',                 // 自定义镜像，空 = 内置
  mirrorPython: '',
  mirrorGo: '',
  mirrorJdk: '',
  mirrorMaven: '',
  mirrorGradle: '',
  mirrorGithub: '',
  maxConcurrentDownloads: 2,
  deployVerifyVersion: true,
  multiVersionMode: 'coexist',    // coexist 共存 | overwrite 覆盖
  dbRegisterService: false,
  taskDepends: true,
  verifyHash: true,

  /* 自动扫描识别 */
  scanOnStart: true,
  scanOnEnterPage: true,
  deepScan: false,
  scanCustomDirs: [],
  scanExcludeDirs: [],
  scanExcludeNames: [],
  auditIntervalHours: 0,          // 0 = 关闭定时审计
  scanTimeoutSec: 90,

  /* 备份与快照 */
  backupSchedule: 'off',          // off | daily | weekly
  backupKeep: 20,
  snapshotMax: 50,
  backupPassword: '',

  /* 日志 */
  logKeepDays: 30,
  taskLogKeepDays: 30,
  logMaxSizeMB: 10,
  logLevel: 'info',

  /* 安全 */
  confirmDanger: true,
  lockProtect: true,
  avWarning: true,
  detectSensitive: true,
  desensitizeExport: false,

  /* 更新 */
  updateChannel: 'stable',
  updateUrl: '',
  checkUpdateOnStart: false,

  /* 界面细节 */
  compactMode: false,             // 更紧凑的卡片与表格
  showPathCount: true,            // 状态栏显示 PATH 条数
  confirmOnQuit: true,            // 有未保存草稿时退出确认
  rememberWindow: true,           // 记住窗口位置与大小

  /* 分组1：界面与窗口（新增） */
  minBtnAction: 'taskbar',        // taskbar 任务栏 | tray 托盘
  trayIconTheme: 'auto',          // auto | light | dark
  trayDblClick: 'show',           // show 主窗口 | snapshot 快照 | path PATH
  trayMenuEnabled: true,          // 托盘右键菜单总开关
  trayMenuItems: { backup: true, explorer: true, toolbox: true, devenv: true },
  colorSuccess: '#00b42a',
  colorWarning: '#ff7d00',
  colorError: '#f53f3f',
  colorInfo: '#165DFF',
  editorFontSize: 12,
  logFontSize: 12,
  codeLineNumbers: true,
  codeWrap: true,
  syntaxHighlight: true,
  animPage: true,
  animModal: true,
  animScrollbar: true,
  hotkeyEnabled: true,
  hotkeySearch: '',               // 全局唤起热键，默认不占用

  /* 分组2：备份与快照（新增） */
  snapshotTrigger: 'quit',        // start 启动 | quit 关闭 | timer 定时 | off
  snapshotTimerMode: 'daily',     // daily | weekly
  snapshotTimerDay: 1,            // 周几（1~7）
  snapshotTimerTime: '12:00',
  snapshotProtectedIds: [],       // 受保护快照 id
  snapshotPaused: false,          // 临时暂停自动快照（启动/关闭时机），写入前快照不受影响
  configAutoBackup: true,
  configBackupKeep: 5,
  backupEncrypt: false,
  snapshotCompress: false,

  /* 分组3：扫描与校验（新增） */
  scanThreads: 4,
  pathTimeoutSec: 10,
  pathIgnoreDirs: [],
  pathIgnoreExt: [],
  scanSkipSystemDirs: true,
  scanDetectNetworkDrive: false,
  scanDetectRemovable: true,

  /* 分组4：配置集（新增） */
  envsetSnapshotBefore: true,
  envsetImportConflict: 'merge',
  envsetShowMeta: true,
  envsetPreCheck: true,

  /* 分组5：更新与网络（新增） */
  updateSchedule: 'start',        // start | daily | weekly
  updateAllowBeta: false,
  proxyMode: 'off',               // off | http | socks5
  proxyHost: '',
  proxyPort: '',
  offlineMode: false,
  updateNotifyPopup: true,

  /* 分组6：CLI 与外部调用 */
  cliOutputFormat: 'text',        // text | json
  cliReadOnly: true,
  cliLogLevel: 'info',
  startPage: '/overview',

  /* 分组7：审计与日志（新增） */
  auditLogEnabled: true,
  perfTrace: false,
  logKeepCount: 10,

  /* 分组8：高级 */
  allowMultiInstance: false,
  configAutoRepair: true,
  portableShowHint: true,

  windowBounds: null,
  scanIgnoreList: [],             // 忽略的软件清单

  /* 运行时记录（设置开关真正生效时写入） */
  lastScheduledBackupAt: 0,
  lastAuditAt: 0,
  lastUpdateCheckAt: 0,
  lastAutoSnapshotAt: 0,
  draftCache: null
}

function appDataDir() {
  // 安装器登记的 %LOCALAPPDATA%\WinEnvManager；未安装时回落 %APPDATA%\win-env-manager
  return resolveAppDir()
}

function configFile() {
  return path.join(appDataDir(), 'config.json')
}

function snapshotDir() {
  return path.join(appDataDir(), 'snapshots')
}

function logDir() {
  return path.join(appDataDir(), 'logs')
}

function auditDir() {
  return path.join(appDataDir(), 'audit')
}

function configBackupDir() {
  return path.join(appDataDir(), 'config-backups')
}

function defaultBackupDir() {
  // %USERPROFILE%\Documents\EnvBackup
  return path.join(app.getPath('documents'), 'EnvBackup')
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function ensureAll() {
  ensureDir(appDataDir())
  ensureDir(snapshotDir())
  ensureDir(logDir())
  return appDataDir()
}

/* ------------------------------- 配置读写 ------------------------------- */

let cachedConfig = null
let lastConfigRepair = { repaired: false, backupUsed: '', reason: '' }

function reloadConfig() {
  cachedConfig = null
  lastConfigRepair = { repaired: false, backupUsed: '', reason: '' }
  return readConfig()
}

function configRepairInfo() {
  return { ...lastConfigRepair }
}

function readConfig() {
  if (cachedConfig) return cachedConfig
  ensureAll()
  let data = {}
  let raw = null
  try {
    if (fs.existsSync(configFile())) raw = fs.readFileSync(configFile(), 'utf8')
  } catch (_) {
    raw = null
  }
  if (raw) {
    try {
      data = JSON.parse(raw)
    } catch (_) {
      /* 配置损坏：先隔离坏文件。是否用备份由最近一次完好配置里的 configAutoRepair 决定，并立刻写回，避免每次启动重复隔离。 */
      try {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        fs.copyFileSync(configFile(), path.join(appDataDir(), `config.corrupt-${stamp}.json`))
      } catch { /* ignore */ }
      let backupData = null
      const backup = latestConfigBackup()
      if (backup) {
        try {
          const parsed = JSON.parse(fs.readFileSync(backup, 'utf8'))
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) backupData = parsed
        } catch { backupData = null }
      }
      const allowRepair = !backupData || backupData.configAutoRepair !== false
      if (allowRepair && backupData) {
        data = backupData
        lastConfigRepair = { repaired: true, backupUsed: backup, reason: '' }
      } else if (!allowRepair) {
        data = { configAutoRepair: false }
        lastConfigRepair = { repaired: true, backupUsed: '', reason: '已关闭自动修复，坏文件已隔离，当前使用默认配置' }
      } else {
        data = {}
        lastConfigRepair = { repaired: true, backupUsed: '', reason: '没有可用的配置备份，坏文件已隔离，当前使用默认配置' }
      }
      cachedConfig = { ...DEFAULT_CONFIG, ...data }
      try {
        fs.writeFileSync(configFile(), JSON.stringify(cachedConfig, null, 2), 'utf8')
      } catch { /* 写回失败时下次启动会再次处理 */ }
      try { writeLog('warn', '配置文件损坏已处理', lastConfigRepair.reason || '已用最近备份恢复') } catch { /* ignore */ }
      return cachedConfig
    }
  }
  cachedConfig = { ...DEFAULT_CONFIG, ...data }
  return cachedConfig
}

function configStampName(d = new Date()) {
  return `config-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`
}

function latestConfigBackup() {
  try {
    const files = fs.readdirSync(configBackupDir()).filter((f) => f.toLowerCase().endsWith('.json')).sort()
    return files.length ? path.join(configBackupDir(), files[files.length - 1]) : null
  } catch {
    return null
  }
}

function pruneConfigBackups(keep) {
  try {
    const limit = Number(keep) || 5
    const files = fs.readdirSync(configBackupDir()).filter((f) => f.toLowerCase().endsWith('.json')).sort()
    let n = 0
    for (const f of files.slice(0, Math.max(0, files.length - limit))) {
      try { fs.rmSync(path.join(configBackupDir(), f), { force: true }); n += 1 } catch { /* ignore */ }
    }
    return n
  } catch {
    return 0
  }
}

function backupConfigDaily() {
  try {
    if (readConfig().configAutoBackup === false) return
    ensureDir(configBackupDir())
    const target = path.join(configBackupDir(), configStampName())
    // 同一天已备份过就跳过，避免每次写配置都复制文件
    if (fs.existsSync(target)) return
    if (fs.existsSync(configFile())) fs.copyFileSync(configFile(), target)
    pruneConfigBackups(readConfig().configBackupKeep)
  } catch { /* ignore */ }
}

function writeConfig(patch) {
  const current = readConfig()
  cachedConfig = { ...current, ...patch }
  ensureAll()
  backupConfigDaily()
  fs.writeFileSync(configFile(), JSON.stringify(cachedConfig, null, 2), 'utf8')
  return cachedConfig
}

function resolvedBackupDir() {
  const cfg = readConfig()
  const dir = cfg.backupDir && cfg.backupDir.trim() ? cfg.backupDir : defaultBackupDir()
  return ensureDir(dir)
}

function resolvedCacheDir() {
  const cfg = readConfig()
  const dir = cfg.cacheDir && cfg.cacheDir.trim() ? cfg.cacheDir : path.join(appDataDir(), 'cache')
  return ensureDir(dir)
}

function listFilesRecursive(dir) {
  const out = []
  const walk = (d) => {
    let entries = []
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) walk(full)
      else {
        try {
          const st = fs.statSync(full)
          out.push({ file: full, size: st.size, mtime: st.mtimeMs })
        } catch { /* 读不到的文件跳过 */ }
      }
    }
  }
  walk(dir)
  return out
}

/** 安装包缓存超过 cacheMaxMB 时，按修改时间删最旧的文件。keepFile 是当前正在用的包，不删。 */
function pruneInstallerCache(keepFile) {
  const maxMB = Number(readConfig().cacheMaxMB)
  if (!Number.isFinite(maxMB) || maxMB <= 0) return { removed: 0, skipped: true }
  const limit = maxMB * 1024 * 1024
  const keep = keepFile ? path.resolve(keepFile) : ''
  const files = listFilesRecursive(resolvedCacheDir())
  let total = files.reduce((n, f) => n + f.size, 0)
  if (total <= limit) return { removed: 0, size: total }
  files.sort((a, b) => a.mtime - b.mtime)
  let removed = 0
  for (const f of files) {
    if (total <= limit) break
    if (keep && path.resolve(f.file) === keep) continue
    try {
      fs.rmSync(f.file, { force: true })
      total -= f.size
      removed += 1
    } catch { /* 占用中的文件留到下次 */ }
  }
  if (removed) writeLog('info', `安装包缓存超过 ${maxMB} MB，已删除 ${removed} 个旧文件`)
  return { removed, size: total, over: total > limit }
}

function resolvedDevRoot() {
  const cfg = readConfig()
  const dir = cfg.devRoot && cfg.devRoot.trim() ? cfg.devRoot : 'C:\\dev\\soft'
  return ensureDir(dir)
}

/* ------------------------------- 操作日志 ------------------------------- */

function logFile() {
  const d = new Date()
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return path.join(logDir(), `${stamp}.log`)
}

/* --------------------------- 审计日志（JSONL，按月分文件） ---------------------------
 * 记录所有写系统环境变量的操作，软件内只读不删，防篡改；只能手动去目录删文件。
 */

function auditTs(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function appendAudit(entry) {
  try {
    if (readConfig().auditLogEnabled === false) return false
    ensureDir(auditDir())
    const d = new Date()
    const file = path.join(auditDir(), `audit-${d.getFullYear()}-${pad(d.getMonth() + 1)}.jsonl`)
    const record = { at: d.getTime(), atText: auditTs(d), ...(entry || {}) }
    fs.appendFileSync(file, JSON.stringify(record) + '\n', 'utf8')
    return true
  } catch {
    return false
  }
}

function listAudit(limit = 500) {
  const out = []
  try {
    ensureDir(auditDir())
    const files = fs.readdirSync(auditDir()).filter((f) => f.toLowerCase().endsWith('.jsonl')).sort()
    for (let i = files.length - 1; i >= 0 && out.length < limit; i--) {
      const lines = fs.readFileSync(path.join(auditDir(), files[i]), 'utf8').split('\n').filter(Boolean)
      for (let j = lines.length - 1; j >= 0 && out.length < limit; j--) {
        try { out.push(JSON.parse(lines[j])) } catch { /* 跳过坏行 */ }
      }
    }
  } catch { /* ignore */ }
  return out
}

function pad(n) {
  return String(n).padStart(2, '0')
}

const LOG_RANK = { debug: 10, info: 20, warn: 30, warning: 30, error: 40 }

function logRank(level) {
  const key = String(level || 'info').toLowerCase()
  return Object.prototype.hasOwnProperty.call(LOG_RANK, key) ? LOG_RANK[key] : LOG_RANK.info
}

function writeLog(level, message, detail) {
  const cfg = readConfig()
  if (!cfg.logEnabled) return false
  if (logRank(level) < logRank(cfg.logLevel || 'info')) return false
  ensureDir(logDir())
  // 单文件超限轮转：当前 .log 改存为 .log.1，新的从空文件开始
  try {
    if (fs.existsSync(logFile())) {
      const maxMB = Number(cfg.logMaxSizeMB) || 10
      if (fs.statSync(logFile()).size > maxMB * 1024 * 1024) {
        fs.rmSync(logFile() + '.1', { force: true })
        fs.renameSync(logFile(), logFile() + '.1')
      }
    }
  } catch { /* 轮转失败不阻断写日志 */ }
  const d = new Date()
  const time = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}:${pad(d.getSeconds())}`
  let line = `[${time}] [${String(level || 'info').toUpperCase()}] ${message}`
  if (detail !== undefined && detail !== null && detail !== '') {
    let dText = typeof detail === 'string' ? detail : JSON.stringify(detail)
    if (dText.length > 2000) dText = dText.slice(0, 2000) + '...(截断)'
    line += ` :: ${dText}`
  }
  fs.appendFileSync(logFile(), line + os.EOL, 'utf8')
  return true
}

function listLogFiles() {
  ensureDir(logDir())
  return fs
    .readdirSync(logDir())
    .filter((f) => f.toLowerCase().endsWith('.log'))
    .map((f) => {
      const full = path.join(logDir(), f)
      const st = fs.statSync(full)
      return { name: f, path: full, size: st.size, mtime: st.mtimeMs }
    })
    .sort((a, b) => b.mtime - a.mtime)
}

/** 读取安装器写入的 HKLM\\SOFTWARE\\WinEnvManager。未安装时各字段为空。 */
function readInstallInfo() {
  const info = {
    installed: false,
    installPath: '',
    userDataRoot: '',
    version: '',
    installDate: '',
    updateUrl: '',
    portable: isPortable()
  }
  if (isPortable()) return info // 便携模式不读取注册表安装信息
  try {
    const { execFileSync } = require('node:child_process')
    const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\WinEnvManager'], {
      encoding: 'utf8', windowsHide: true
    })
    const pick = (name) => {
      const m = out.match(new RegExp(name + '\\s+REG_\\w+\\s+(.+)'))
      return m ? m[1].trim() : ''
    }
    info.installPath = pick('InstallPath')
    info.userDataRoot = pick('UserDataRoot')
    info.version = pick('Version')
    info.installDate = pick('InstallDate')
    info.updateUrl = pick('UpdateUrl')
    info.installed = !!(info.installPath || info.userDataRoot || info.version)
    info.source = info.installed ? 'registry' : 'fallback'
  } catch { /* 未安装或无权限 */ }
  return info
}

function scheduleDue(mode, lastAt) {
  if (!mode || mode === 'off' || mode === '0' || mode === 0) return false
  const last = Number(lastAt) || 0
  if (!last) return true
  const span = mode === 'weekly' || mode === '168' || mode === 168 ? 7 * 86400000 : 86400000
  return Date.now() - last >= span
}

/** 先按 logKeepDays 删除过期的 YYYY-MM-DD.log 与 .log.1，再按 logKeepCount 封顶。天数为 0 或非法时不按日期删。 */
function pruneLogFiles() {
  try {
    const cfg = readConfig()
    const dir = logDir()
    const keepCountRaw = Number(cfg.logKeepCount)
    const keepCount = Number.isFinite(keepCountRaw) && keepCountRaw > 0 ? Math.floor(keepCountRaw) : 10
    const keepDaysRaw = Number(cfg.logKeepDays)
    const keepDays = Number.isFinite(keepDaysRaw) && keepDaysRaw > 0 ? keepDaysRaw : 0
    const names = fs.readdirSync(dir).filter((f) => /\.log(\.\d+)?$/i.test(f))
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayMs = today.getTime()
    let removed = 0
    const left = []
    for (const name of names) {
      const m = name.match(/^(\d{4})-(\d{2})-(\d{2})\.log(?:\.\d+)?$/i)
      let expired = false
      if (keepDays && m) {
        const fileDay = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
        if (Number.isFinite(fileDay) && todayMs - fileDay > keepDays * 86400000) expired = true
      }
      if (!expired) {
        left.push(name)
        continue
      }
      try { fs.rmSync(path.join(dir, name), { force: true }); removed += 1 } catch { left.push(name) }
    }
    const primaryOf = (name) => name.replace(/\.log(?:\.\d+)?$/i, '.log')
    const primaries = [...new Set(left.map(primaryOf))].sort()
    const drop = new Set(primaries.slice(0, Math.max(0, primaries.length - keepCount)))
    for (const name of left) {
      if (!drop.has(primaryOf(name))) continue
      try { fs.rmSync(path.join(dir, name), { force: true }); removed += 1 } catch { /* ignore */ }
    }
    return removed
  } catch {
    return 0
  }
}

function clearLogs() {
  ensureDir(logDir())
  let count = 0
  for (const f of fs.readdirSync(logDir())) {
    if (/\.log(\.\d+)?$/i.test(f)) {
      fs.rmSync(path.join(logDir(), f), { force: true })
      count++
    }
  }
  return count
}

module.exports = {
  USER_REG_KEY,
  USER_PS_KEY,
  MACHINE_REG_KEY,
  MACHINE_PS_KEY,
  DEFAULT_CONFIG,
  appDataDir,
  configFile,
  snapshotDir,
  logDir,
  auditDir,
  configBackupDir,
  latestConfigBackup,
  defaultBackupDir,
  resolvedBackupDir,
  resolvedCacheDir,
  pruneInstallerCache,
  resolvedDevRoot,
  ensureDir,
  ensureAll,
  isPortable,
  readConfig,
  reloadConfig,
  configRepairInfo,
  writeConfig,
  readInstallInfo,
  appendAudit,
  listAudit,
  writeLog,
  listLogFiles,
  pruneLogFiles,
  clearLogs,
  logFile,
  scheduleDue
}
