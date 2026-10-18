// 适配性自测：全部落在 WEM_PORTABLE 指定的临时目录。
// 不写注册表、不清理真实日志、不改真实 config.json / tasks.json。
const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const zlib = require('node:zlib')
const { pathToFileURL } = require('node:url')

const store = require('../electron/lib/store')
const ops = require('../electron/lib/ops')
const registry = require('../electron/lib/registry')
const catalog = require('../electron/lib/catalog')
const cli = require('../electron/lib/cli')
const { TaskManager, STATUS } = require('../electron/lib/tasks')

const results = []
function check(name, pass, extra) {
  results.push({ name, pass: !!pass, extra: extra == null ? '' : String(extra) })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  :: ' + extra : ''}`)
}

function readText(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')
}

function ymd(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function hashFile(file) {
  if (!fs.existsSync(file)) return 'missing'
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function topList(dir) {
  if (!fs.existsSync(dir)) return 'missing'
  return fs.readdirSync(dir).map((name) => {
    const full = path.join(dir, name)
    let size = -1
    try { size = fs.statSync(full).size } catch { size = -1 }
    return `${name}:${size}`
  }).sort().join('|')
}

function realDataRoots() {
  const roots = []
  if (process.env.LOCALAPPDATA) roots.push(path.join(process.env.LOCALAPPDATA, 'WinEnvManager'))
  if (process.env.APPDATA) roots.push(path.join(process.env.APPDATA, 'win-env-manager'))
  return roots
}

function fingerprintFiles() {
  const out = {}
  for (const root of realDataRoots()) {
    out[root] = {
      config: hashFile(path.join(root, 'config.json')),
      tasks: hashFile(path.join(root, 'tasks.json')),
      logs: topList(path.join(root, 'logs')),
      snapshots: topList(path.join(root, 'snapshots'))
    }
  }
  return JSON.stringify(out)
}

async function fingerprintEnv() {
  const data = await registry.readAllEnv()
  const norm = (list) => (list || []).map((v) => `${v.name}\0${v.value}`).sort().join('\n')
  return `${norm(data.user)}\n---\n${norm(data.machine)}`
}

async function quiet(fn) {
  const log = console.log
  const err = console.error
  console.log = () => {}
  console.error = () => {}
  try { return await fn() } finally {
    console.log = log
    console.error = err
  }
}

function loadScannerForTest() {
  const srcPath = path.join(__dirname, '../electron/lib/scanner.js')
  const tmp = path.join(__dirname, '../electron/lib/scanner.adapt-tmp.js')
  const src = fs.readFileSync(srcPath, 'utf8').replace(
    'module.exports = {',
    'module.exports = {\n  isSystemProtectedDir,\n  filterVolumeRoots,\n  versionTimeoutMs,'
  )
  fs.writeFileSync(tmp, src)
  try {
    return require(tmp)
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}

function containsAscii(file, text) {
  const rawFs = process.versions.electron ? require('original-fs') : fs
  const needle = Buffer.from(text)
  const fd = rawFs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size
    const chunk = 1024 * 1024
    const overlap = needle.length - 1
    let prev = Buffer.alloc(0)
    for (let pos = 0; pos < size; pos += chunk) {
      const len = Math.min(chunk, size - pos)
      const buf = Buffer.alloc(len)
      rawFs.readSync(fd, buf, 0, len, pos)
      const hay = prev.length ? Buffer.concat([prev, buf]) : buf
      if (hay.includes(needle)) return true
      prev = hay.subarray(Math.max(0, hay.length - overlap))
    }
    return false
  } finally {
    rawFs.closeSync(fd)
  }
}

function staticChecks() {
  const settings = readText('src/views/Settings.vue')
  const clearFn = settings.slice(settings.indexOf('function clearScanCache()'), settings.indexOf('async function repairConfigNow()'))
  check('设置页有命令行三项', settings.includes('cliOutputFormat') && settings.includes('cliReadOnly: v ? false : true') && settings.includes('cliLogLevel'))
  check('清空扫描缓存不调用安装包清理', clearFn.includes('clearScanResultCache()') && !clearFn.includes('devenv:clearCache') && !clearFn.includes('clearInstaller'))
  check('高危确认不提供不再提示', (() => {
    const src = readText('src/components/dialogs/dialogService.js')
    const danger = src.slice(src.indexOf('export function danger'), src.indexOf('export function preview'))
    return danger.includes("kind: 'danger'") && !danger.includes('skipKey') && !danger.includes('allowSkip')
  })())
  check('普通确认才读取不再提示', readText('src/components/dialogs/dialogService.js').includes('allowSkipConfirm'))
  check('快照压缩走正式配置，本地只记哈希开关', (() => {
    const src = readText('src/components/settings/ExtraProductSettings.vue')
    return src.includes('hashCheck: snap.hashCheck === true') && src.includes('snapshotCompress: snap.compress === true')
  })())
  const css = readText('src/assets/main.css').replace(/\s+/g, ' ')
  check('日志字号变量覆盖日志面板', css.includes('.task-log') && css.includes('.log-line') && css.includes('.dlg-log')
    && css.includes('font-size: var(--wem-log-fs, 12px)') && readText('src/views/DevEnv.vue').includes('var(--wem-log-fs'))
  check('状态色和弹窗遮罩接到主题', readText('src/App.vue').includes('colorSuccess') && readText('src/App.vue').includes('applyPopupChrome')
    && readText('src/assets/main.css').includes('--wem-mask-opacity'))
  check('表格分页监听设置版本', readText('src/components/wem-table/WemTable.vue').includes('tableSettingsRev')
    && readText('src/components/wem-table/WemTable.vue').includes('initialPageSize'))
  const devStore = readText('src/store/dev.js')
  check('扫描结果缓存只清内存和识别缓存', devStore.includes("const SCAN_CACHE_KEY = 'wem-scan-cache'")
    && devStore.includes('memoryScan = null') && devStore.includes('localStorage.removeItem(SCAN_CACHE_KEY)'))

  const defaults = store.DEFAULT_CONFIG
  check('默认快照不压缩', defaults.snapshotCompress === false)
  check('默认命令行只读', defaults.cliReadOnly === true && defaults.cliOutputFormat === 'text' && defaults.cliLogLevel === 'info')
  check('默认不在启动时检查更新', defaults.checkUpdateOnStart === false && defaults.updateSchedule === 'start')
  check('默认跳过系统目录且扫描线程为 4', defaults.scanSkipSystemDirs === true && defaults.scanThreads === 4)
  check('默认不探测网络盘，但探测可移动盘', defaults.scanDetectNetworkDrive === false && defaults.scanDetectRemovable === true)
  check('默认开启配置自动修复和高危确认', defaults.configAutoRepair === true && defaults.confirmDanger === true)
  check('默认不启动即最小化', defaults.startMinimized === false)

  const portable = path.join(__dirname, '../out-release/WinEnvManager-1.1.0-portable.exe')
  const wrong = path.join(__dirname, '../out-release/WinEnvManager-v1.1.0-portable.exe')
  const asar = path.join(__dirname, '../out-release/win-unpacked/resources/app.asar')
  check('便携版文件名没有多余的 v', fs.existsSync(portable) && !fs.existsSync(wrong), portable)
  // 便携版 exe 是 7z 自解压，源码字符串在未压缩的 app.asar 里
  if (fs.existsSync(asar)) {
    check('安装包包含命令行日志级别', containsAscii(asar, 'cliLogLevel'))
    check('安装包包含扫描缓存键', containsAscii(asar, 'wem-scan-cache'))
    check('安装包包含快照压缩开关', containsAscii(asar, 'snapshotCompress'))
  } else {
    check('安装包 asar 存在', false, asar)
  }
}

async function behaviorChecks() {
  const scanner = loadScannerForTest()
  check('系统保护目录识别 Windows', scanner.isSystemProtectedDir('C:\\Windows\\System32') === true)
  check('系统保护目录识别 Program Files', scanner.isSystemProtectedDir('C:\\Program Files\\nodejs') === true)
  check('开发目录不是系统保护目录', scanner.isSystemProtectedDir('C:\\dev\\soft') === false)
  check('空路径不是系统保护目录', scanner.isSystemProtectedDir('') === false)
  check('版本超时取 1 到 30 秒', scanner.versionTimeoutMs(5, 10000) === 5000)
  check('版本超时越界回落到默认', scanner.versionTimeoutMs(0, 10000) === 10000 && scanner.versionTimeoutMs(99, 15000) === 15000 && scanner.versionTimeoutMs('x', 15000) === 15000)

  const kept = await scanner.filterVolumeRoots(['C:\\Windows', '\\\\no-such-host\\share'], { skipNetwork: true, skipUsb: false })
  check('跳过网络盘时丢掉 UNC，保留本地盘', kept.some((d) => d === 'C:\\Windows') && !kept.some((d) => d.startsWith('\\\\')))
  const unchanged = await scanner.filterVolumeRoots(['C:\\Windows', '\\\\no-such-host\\share'], {})
  check('未要求跳过时保留 UNC', unchanged.length === 2)

  store.writeConfig({ pathTimeoutSec: 3, pathIgnoreDirs: ['C:\\AdaptIgnore', 'C:\\AdaptWild*'], scanDetectNetworkDrive: false, scanDetectRemovable: false })
  const classified = await registry.classifyPaths([
    'C:\\Windows',
    'C:\\AdaptIgnore',
    'C:\\AdaptWild\\child',
    '\\\\no-such-host\\share'
  ], { config: store.readConfig() })
  const byPath = Object.fromEntries(classified.map((row) => [row.path, row.type]))
  check('忽略目录不探测', byPath['C:\\AdaptIgnore'] === 'ignored' && byPath['C:\\AdaptWild\\child'] === 'ignored', JSON.stringify(byPath))
  check('关闭网络盘探测时 UNC 标记为跳过', byPath['\\\\no-such-host\\share'] === 'network-skipped')
  check('本地目录仍做存在性检查', byPath['C:\\Windows'] === 'ok')

  store.writeConfig({ logEnabled: true, logLevel: 'info', logMaxSizeMB: 10 })
  check('info 级别丢掉 debug', store.writeLog('debug', 'ADAPT-DEBUG-HIDDEN') === false)
  check('info 级别留下 info', store.writeLog('info', 'ADAPT-INFO-VISIBLE') === true)
  store.writeConfig({ logLevel: 'error' })
  check('error 级别丢掉 info', store.writeLog('info', 'ADAPT-INFO-HIDDEN') === false)
  check('error 级别留下 error', store.writeLog('error', 'ADAPT-ERROR-VISIBLE') === true)
  store.writeConfig({ logEnabled: false })
  check('关闭日志后不再写入', store.writeLog('error', 'ADAPT-DISABLED') === false)
  const logBody = fs.readFileSync(store.logFile(), 'utf8')
  check('日志正文与级别过滤一致', logBody.includes('ADAPT-INFO-VISIBLE') && logBody.includes('ADAPT-ERROR-VISIBLE')
    && !logBody.includes('ADAPT-DEBUG-HIDDEN') && !logBody.includes('ADAPT-INFO-HIDDEN') && !logBody.includes('ADAPT-DISABLED'))
  store.writeConfig({ logEnabled: true, logLevel: 'info' })

  const logDir = store.logDir()
  const oldDay = new Date(Date.now() - 40 * 86400000)
  fs.writeFileSync(path.join(logDir, `${ymd(oldDay)}.log`), 'old\n')
  fs.writeFileSync(path.join(logDir, `${ymd(oldDay)}.log.1`), 'old-rot\n')
  const recent = [1, 2, 3].map((n) => ymd(new Date(Date.now() - n * 86400000)))
  for (const day of recent) fs.writeFileSync(path.join(logDir, `${day}.log`), 'recent\n')
  store.writeConfig({ logKeepDays: 30, logKeepCount: 10 })
  const removedOld = store.pruneLogFiles()
  check('过期日志和轮转文件一起删除', removedOld >= 2 && !fs.existsSync(path.join(logDir, `${ymd(oldDay)}.log`))
    && !fs.existsSync(path.join(logDir, `${ymd(oldDay)}.log.1`)))
  check('保留期内日志还在', recent.every((day) => fs.existsSync(path.join(logDir, `${day}.log`))))
  store.writeConfig({ logKeepDays: 0, logKeepCount: 2 })
  store.pruneLogFiles()
  const leftRecent = recent.filter((day) => fs.existsSync(path.join(logDir, `${day}.log`)))
  check('保留天数无效时不按日期删，条数仍封顶', leftRecent.length === 1, leftRecent.join(','))
  check('今天的日志不被封顶误删', fs.existsSync(store.logFile()))

  check('关闭日程不到期', store.scheduleDue('off', 0) === false && store.scheduleDue(0, 0) === false)
  check('没有上次时间则到期', store.scheduleDue('daily', 0) === true)
  check('每天：刚做过不到期，两天前到期', store.scheduleDue('daily', Date.now()) === false && store.scheduleDue('daily', Date.now() - 2 * 86400000) === true)
  check('每周：两天前不到期，八天前到期', store.scheduleDue('weekly', Date.now() - 2 * 86400000) === false && store.scheduleDue('weekly', Date.now() - 8 * 86400000) === true)

  const node = catalog.getItem('node')
  store.writeConfig({ mirrorNode: 'https://example.test/node' })
  const official = catalog.resolveUrl(node, '20.18.0', 'official', 'https://ignored.example')
  const custom = catalog.resolveUrl(node, '20.18.0', 'mirror', 'https://custom.example/node/')
  const configured = catalog.resolveUrl(node, '20.18.0', 'mirror', '')
  store.writeConfig({ mirrorNode: '' })
  const builtin = catalog.resolveUrl(node, '20.18.0', 'mirror', '   ')
  check('官方源不被镜像覆盖', official.startsWith('https://nodejs.org/dist/v20.18.0/'))
  check('显式镜像优先于配置', custom.startsWith('https://custom.example/node/v20.18.0/'))
  check('空显式镜像使用配置镜像', configured.startsWith('https://example.test/node/v20.18.0/'))
  check('配置镜像为空时用内置镜像', builtin.startsWith('https://npmmirror.com/mirrors/node/v20.18.0/'))

  store.writeConfig({ snapshotCompress: false })
  const plain = await ops.createSnapshot({ name: 'adapt-plain' }, { user: { A: '1' }, machine: {} })
  check('关闭压缩时写明文快照', plain.file.toLowerCase().endsWith('.json') && !plain.file.toLowerCase().endsWith('.json.gz'))
  store.writeConfig({ snapshotCompress: true })
  const gz = await ops.createSnapshot({ name: 'adapt-gz' }, { user: { A: '1' }, machine: { Path: 'C:\\Windows' } })
  check('打开压缩时写 gzip 快照', gz.file.toLowerCase().endsWith('.json.gz'))
  const gzRead = ops.readSnapshotAny(gz.id)
  check('压缩快照读回正文', gzRead.user.A === '1' && gzRead.checksum.ok === true)
  const same = JSON.parse(fs.readFileSync(plain.file, 'utf8'))
  same.note = 'from-gz'
  const sameGz = plain.file.replace(/\.json$/i, '.json.gz')
  fs.writeFileSync(sameGz, zlib.gzipSync(Buffer.from(JSON.stringify(same), 'utf8')))
  const dup = ops.listSnapshots().filter((s) => s.id === plain.id)
  check('同一快照明文和压缩只列一次且优先压缩', dup.length === 1 && path.resolve(dup[0].file) === path.resolve(sameGz) && dup[0].note === 'from-gz')
  const prefer = ops.readSnapshotAny(plain.id)
  check('同一编号优先读压缩文件', prefer.note === 'from-gz')

  ops.setSnapshotProtected(gz.id, true)
  check('保护标记不破坏校验', ops.readSnapshotAny(gz.id).checksum.ok === true && ops.readSnapshotAny(gz.id).protected === true)
  const tampered = JSON.parse(zlib.gunzipSync(fs.readFileSync(gz.file)).toString('utf8'))
  tampered.user.A = 'tampered'
  fs.writeFileSync(gz.file, zlib.gzipSync(Buffer.from(JSON.stringify(tampered), 'utf8')))
  let blocked = false
  try { ops.readSnapshotAny(gz.id) } catch (err) { blocked = /校验失败/.test(err.message) }
  check('校验失败默认拒绝读取', blocked)
  const skipped = ops.readSnapshotAny(gz.id, { skipHash: true })
  check('只有明确跳过校验才继续读', skipped.user.A === 'tampered' && skipped.checksum.skipped === true)

  const oldest = await ops.createSnapshot({ name: 'adapt-old', auto: true }, { user: { N: '1' }, machine: {} })
  ops.setSnapshotProtected(oldest.id, true)
  const middle = await ops.createSnapshot({ name: 'adapt-mid', auto: true }, { user: { N: '2' }, machine: {} })
  const newest = await ops.createSnapshot({ name: 'adapt-new', auto: true }, { user: { N: '3' }, machine: {} })
  const pruned = ops.pruneSnapshots(1)
  const leftIds = new Set(ops.listSnapshots().map((s) => s.id))
  check('清理保留受保护快照', pruned >= 1 && leftIds.has(oldest.id) && leftIds.has(newest.id) && !leftIds.has(middle.id), `removed=${pruned}`)
  for (const id of ops.listSnapshots().map((s) => s.id)) ops.deleteSnapshot(id)
  check('测试快照已删除', ops.listSnapshots().length === 0)

  store.writeConfig({ cacheMaxMB: 0 })
  check('缓存上限为 0 时不清理', store.pruneInstallerCache().skipped === true)
  const cacheDir = store.resolvedCacheDir()
  const keep = path.join(cacheDir, 'keep.bin')
  const oldFile = path.join(cacheDir, 'old.bin')
  fs.writeFileSync(oldFile, Buffer.alloc(300, 1))
  fs.writeFileSync(keep, Buffer.alloc(300, 2))
  const past = new Date(Date.now() - 86400000)
  fs.utimesSync(oldFile, past, past)
  store.writeConfig({ cacheMaxMB: 0.0004 })
  const cacheResult = store.pruneInstallerCache(keep)
  check('缓存清理保留正在使用的包', fs.existsSync(keep) && !fs.existsSync(oldFile) && cacheResult.removed >= 1, JSON.stringify(cacheResult))

  const tasks = new TaskManager()
  check('并发：空值回落 2，负数夹到 1，超过 5 夹到 5', tasks.setConcurrency(0) === 2 && tasks.setConcurrency(-1) === 1 && tasks.setConcurrency(9) === 5 && tasks.setConcurrency(3) === 3)
  const failedDep = { id: 'dep', name: '前置', type: 'adapt', status: STATUS.FAILED, dependsOn: [], createdAt: 1, finishedAt: Date.now(), logs: [] }
  const child = { id: 'child', name: '后续', type: 'adapt', status: STATUS.QUEUED, dependsOn: ['dep'], createdAt: 2, logs: [] }
  const missing = { id: 'missing-dep', name: '缺失依赖', type: 'adapt', status: STATUS.QUEUED, dependsOn: ['not-exist'], createdAt: 3, logs: [] }
  tasks.tasks.set(failedDep.id, failedDep)
  tasks.tasks.set(child.id, child)
  tasks.tasks.set(missing.id, missing)
  tasks.failBlocked()
  check('依赖失败会阻断后续排队任务', tasks.get('child').status === STATUS.FAILED && /前置任务未成功/.test(tasks.get('child').error))
  check('找不到的依赖不阻断', tasks.get('missing-dep').status === STATUS.QUEUED)
  const created = tasks.create({ name: '新建', type: 'adapt-unknown', maxRetries: 2 })
  check('新建任务重试次数从 0 开始', created.retries === 0)
  store.writeConfig({ taskLogKeepDays: 30 })
  tasks.tasks.set('old-done', { id: 'old-done', name: '旧任务', type: 'adapt', status: STATUS.SUCCESS, finishedAt: Date.now() - 40 * 86400000, createdAt: 1, logs: [] })
  tasks.tasks.set('old-run', { id: 'old-run', name: '旧运行', type: 'adapt', status: STATUS.RUNNING, finishedAt: 0, createdAt: Date.now() - 40 * 86400000, logs: [] })
  check('过期已结束任务被清理，运行中保留', tasks.pruneExpired() === true && !tasks.tasks.has('old-done') && tasks.tasks.has('old-run'))
  store.writeConfig({ taskLogKeepDays: 0 })
  tasks.tasks.set('keep-done', { id: 'keep-done', name: '保留', type: 'adapt', status: STATUS.SUCCESS, finishedAt: Date.now() - 40 * 86400000, createdAt: 1, logs: [] })
  check('任务保留天数为 0 时不清理', tasks.pruneExpired() === false && tasks.tasks.has('keep-done'))

  store.reloadConfig()
  store.writeConfig({ cliReadOnly: true, cliOutputFormat: 'text', cliLogLevel: 'info', logLevel: 'info', logEnabled: true })
  const denied = await quiet(() => cli.run(['set', 'WEM_ADAPT_SHOULD_NOT_EXIST', 'nope']))
  check('默认只读拒绝 set', denied === 3)
  store.writeConfig({ cliLogLevel: 'error', logLevel: 'debug' })
  const beforeHelp = fs.readFileSync(store.logFile(), 'utf8')
  await quiet(() => cli.run(['help']))
  const afterHelp = fs.readFileSync(store.logFile(), 'utf8')
  check('命令行日志级别挡住 debug', !afterHelp.slice(beforeHelp.length).includes('CLI help'))
  store.writeConfig({ cliLogLevel: 'debug', logLevel: 'info' })
  const beforeGlobal = fs.readFileSync(store.logFile(), 'utf8')
  await quiet(() => cli.run(['help']))
  check('全局日志级别比命令行更严', !fs.readFileSync(store.logFile(), 'utf8').slice(beforeGlobal.length).includes('CLI help'))
  store.writeConfig({ cliLogLevel: 'info', logLevel: 'info', cliOutputFormat: 'json' })
  const outFile = path.join(store.appDataDir(), 'cli-path-check.json')
  const code = await quiet(() => cli.run(['path-check'], { outFile }))
  const pathLog = fs.readFileSync(store.logFile(), 'utf8')
  check('path-check 成功且条数不是对象长度', code === 0 && /"count":\d+/.test(pathLog) && fs.existsSync(outFile))

  store.writeConfig({ theme: 'dark', marker: 'LIVE', configAutoRepair: true })
  fs.mkdirSync(store.configBackupDir(), { recursive: true })
  fs.writeFileSync(path.join(store.configBackupDir(), 'config-20991231.json'), JSON.stringify({ marker: 'FROMBACKUP', theme: 'dark', configAutoRepair: true }))
  fs.writeFileSync(store.configFile(), '{ this is broken', 'utf8')
  const repaired = store.reloadConfig()
  const repairInfo = store.configRepairInfo()
  check('损坏配置用最近备份修复', repaired.marker === 'FROMBACKUP' && repairInfo.repaired === true && repairInfo.backupUsed.endsWith('config-20991231.json'))
  fs.writeFileSync(path.join(store.configBackupDir(), 'config-20991231.json'), JSON.stringify({ marker: 'SHOULD-NOT-RESTORE', configAutoRepair: false }))
  fs.writeFileSync(store.configFile(), '{ still broken', 'utf8')
  const notRepaired = store.reloadConfig()
  check('关闭自动修复时不回写备份', notRepaired.configAutoRepair === false && notRepaired.marker !== 'SHOULD-NOT-RESTORE' && notRepaired.theme === 'light')
}

async function coverageChecks() {
  const helpersFile = path.join(store.appDataDir(), 'helpers.adapt.mjs')
  fs.mkdirSync(store.appDataDir(), { recursive: true })
  fs.writeFileSync(helpersFile, fs.readFileSync(path.join(__dirname, '../src/lib/helpers.js')))
  const helpers = await import(pathToFileURL(helpersFile).href)
  check('PATH 导入按条目去重且忽略大小写', helpers.mergeListValue('C:\\Windows;C:\\bin', 'c:\\bin;D:\\tools') === 'C:\\Windows;C:\\bin;D:\\tools')
  check('单值变量合并保留当前非空值', helpers.mergeImportedValue('JAVA_HOME', 'C:\\jdk17', 'C:\\jdk21') === 'C:\\jdk17')
  check('空的单值变量才采用导入值', helpers.mergeImportedValue('JAVA_HOME', '', 'C:\\jdk21') === 'C:\\jdk21')
  const script = helpers.buildScript([
    { name: 'A', value: '1', action: 'create' },
    { name: 'A', value: '2', action: 'create' }
  ], 'cmd')
  check('普通变量脚本逐条 set，后一条覆盖前一条', script.indexOf('set "A=1"') >= 0 && script.indexOf('set "A=1"') < script.indexOf('set "A=2"'))
  check('PATH 导出合成一条，不逐条覆盖', readText('src/views/PathManager.vue').includes('必须合成一条 PATH') && readText('src/views/PathManager.vue').includes("paths.join(';')"))
  check('口令类变量能识别为敏感值', helpers.detectSensitive('DB_PASSWORD', 'hunter2').includes('口令类变量'))
  check('关闭敏感检测后草稿不再因此告警', helpers.validateDraft(
    [{ name: 'DB_PASSWORD', value: 'hunter2', scope: 'user', action: 'create' }],
    { user: {}, machine: {} },
    { detectSensitive: false }
  ).warns.length === 0)

  const envsetIpc = require('../electron/ipc/envset')
  const previousNode = process.env.ELECTRON_RUN_AS_NODE
  process.env.ELECTRON_RUN_AS_NODE = '1'
  process.env.WEM_ADAPT_MARKER = 'keep-me'
  try {
    const launched = envsetIpc.buildLaunchEnv(
      { PATH: 'C:\\AdaptExtra', JAVA_HOME: 'C:\\jdk' },
      [{ name: 'WEM_ADAPT_MARKER', action: 'delete' }, { name: 'PATH', value: 'C:\\AdaptDraft', action: 'create' }]
    )
    const pathText = String(launched.Path || '')
    check('临时终端去掉 Node 模式标记', !Object.prototype.hasOwnProperty.call(launched, 'ELECTRON_RUN_AS_NODE'))
    check('临时终端 PATH 只追加，不替换现有路径', pathText.toLowerCase().includes('c:\\adaptextra') && pathText.toLowerCase().includes('c:\\adaptdraft')
      && pathText.length > 'C:\\AdaptExtra;C:\\AdaptDraft'.length)
    check('临时终端普通变量写入，删除动作生效', launched.JAVA_HOME === 'C:\\jdk' && !Object.prototype.hasOwnProperty.call(launched, 'WEM_ADAPT_MARKER'))
  } finally {
    if (previousNode == null) delete process.env.ELECTRON_RUN_AS_NODE
    else process.env.ELECTRON_RUN_AS_NODE = previousNode
    delete process.env.WEM_ADAPT_MARKER
  }

  const projectEnv = require('../electron/ipc/projectenv')
  const dotDir = path.join(store.appDataDir(), 'adapt-project')
  fs.mkdirSync(dotDir, { recursive: true })
  fs.writeFileSync(path.join(dotDir, '.env'), 'FROM_DOTENV=yes\r\n', 'utf8')
  process.env.ELECTRON_RUN_AS_NODE = '1'
  try {
    const inherited = projectEnv.buildLaunchEnv({
      inheritGlobal: true,
      autoDotenv: true,
      folder: dotDir,
      vars: [{ name: 'Path', value: 'C:\\OnlyProject', enabled: true }, { name: 'OFF', value: 'x', enabled: false }]
    })
    const inheritedNames = Object.keys(inherited).map((key) => key.toUpperCase())
    check('项目终端继承当前环境并去掉 Node 模式标记', inheritedNames.includes('SYSTEMROOT') && !inheritedNames.includes('ELECTRON_RUN_AS_NODE'))
    check('项目 .env 注入，禁用变量不注入', inherited.FROM_DOTENV === 'yes' && !Object.prototype.hasOwnProperty.call(inherited, 'OFF'))
    const bare = projectEnv.buildLaunchEnv({ inheritGlobal: false, autoDotenv: false, folder: dotDir, vars: [{ name: 'ONLY', value: '1', enabled: true }] })
    check('关闭继承和 .env 后只保留项目变量', bare.ONLY === '1' && !bare.SystemRoot && !bare.FROM_DOTENV)
  } finally {
    delete process.env.ELECTRON_RUN_AS_NODE
  }

  const handlers = {}
  projectEnv.register((name, fn) => { handlers[name] = fn })
  await handlers['project:save'](null, [
    { id: 'adapt-a', name: '甲', terminal: 'pwsh', vars: [{ name: 'A', value: '1' }] },
    { id: 'adapt-b', name: '乙', terminal: 'wt' }
  ])
  await handlers['project:save'](null, [{ id: 'adapt-b', name: '乙改名', terminal: 'cmd' }])
  const projects = await handlers['project:list']()
  check('项目整表保存按传入列表替换', projects.length === 1 && projects[0].id === 'adapt-b' && projects[0].name === '乙改名' && projects[0].terminal === 'cmd')

  const envset = require('../electron/lib/envset')
  const group = envset.createMutex({ name: '适配互斥' })
  const first = envset.createSet({ name: '适配甲', variables: [{ name: 'A', value: '1', scope: 'user' }] })
  const second = envset.createSet({ name: '适配乙', variables: [{ name: 'B', value: '2', scope: 'user' }] })
  envset.assignMutex(first.id, group.id)
  envset.assignMutex(second.id, group.id)
  check('同一互斥组可以有多个成员', envset.membersOf(group.id).length === 2)
  envset.importSet({ set: { name: '适配甲', variables: [{ name: 'A', value: '9', scope: 'user' }, { name: 'C', value: '3', scope: 'user' }] } }, { conflict: 'merge' })
  const merged = envset.getSet(first.id)
  const byName = Object.fromEntries(merged.variables.map((v) => [v.name, v.value]))
  check('配置集导入合并只追加同名里没有的变量', byName.A === '1' && byName.C === '3')
  envset.importSet({ set: { name: '适配甲', variables: [{ name: 'A', value: '9', scope: 'user' }] } }, { conflict: 'overwrite' })
  const overwritten = envset.getSet(first.id)
  check('配置集导入覆盖替换整套变量', overwritten.variables.length === 1 && overwritten.variables[0].value === '9')

  const devenv = require('../electron/ipc/devenv')
  check('版本号 v 前缀和数字核心视为相同', devenv.versionMatches('v20.18.0', '20.18.0') === true && devenv.versionMatches('1.0.0', '2.0.0') === false)
  const hashFile = path.join(store.appDataDir(), 'adapt-hash.bin')
  fs.writeFileSync(hashFile, 'adapt-hash')
  const good = crypto.createHash('sha256').update('adapt-hash').digest('hex')
  const logs = []
  const tctx = { log: (text) => logs.push(text) }
  await devenv.assertDownloadHash(hashFile, good, true, tctx)
  check('哈希一致时保留安装包', fs.existsSync(hashFile) && logs.some((line) => line.includes('哈希校验通过')))
  let hashThrew = false
  try { await devenv.assertDownloadHash(hashFile, 'deadbeef', true, tctx) } catch (err) { hashThrew = /哈希校验失败/.test(err.message) }
  check('哈希不一致时失败并删除缓存', hashThrew && !fs.existsSync(hashFile))
  fs.writeFileSync(hashFile, 'adapt-hash')
  await devenv.assertDownloadHash(hashFile, 'deadbeef', false, tctx)
  check('关闭哈希校验时不删除安装包', fs.existsSync(hashFile) && logs.some((line) => line.includes('跳过下载哈希校验')))

  const envSets = readText('src/views/EnvSets.vue')
  const activateFn = envSets.slice(envSets.indexOf('async function onMutexActivate'), envSets.indexOf('function openImport'))
  check('互斥激活成功后才标记', activateFn.includes('const res = await loadOne(set)') && activateFn.includes('res.ok') && activateFn.includes('markActive(set.id)'))
  check('高危确认关闭只跳过系统变量和重置', readText('src/components/VariableTable.vue').includes("targets.every((t) => t.scope === 'machine')")
    && readText('src/views/Toolbox.vue').includes('confirmDanger === false')
    && readText('src/views/DevEnv.vue').includes('confirmDanger === false'))
  check('静默安装仍只提示不阻断', readText('src/views/DevEnv.vue').includes('avWarning !== false') && readText('src/views/DevEnv.vue').includes("deployForm.mode === 'silent'"))
  check('依赖编排关闭时不自动加入 JDK 依赖', readText('src/views/DevEnv.vue').includes('taskDepends === false'))
  check('下载源和深度扫描被用户改过就不再被配置覆盖', readText('src/views/DevEnv.vue').includes('downloadSourceTouched') && readText('src/views/DevEnv.vue').includes('deepScanTouched'))
  check('启动自动扫描跟随开关', readText('src/App.vue').includes('scanOnStart !== false'))
  check('新建项目读取继承全局设置', readText('src/views/Projects.vue').includes('defaultInheritGlobal'))
  check('关闭文件夹检查后不再标记缺失', readText('src/views/Projects.vue').includes('watchFolder === false'))
  check('启动最小化只隐藏窗口', readText('electron/main.js').includes('startMinimized') && readText('electron/main.js').includes("hide()"))
  check('更新通道 pre 或允许测试版才读预发布', readText('electron/ipc/system.js').includes("cfg.updateChannel === 'pre' || cfg.updateAllowBeta"))
}

app.whenReady().then(async () => {
  const portableRoot = process.env.PORTABLE_EXECUTABLE_DIR || ''
  const expected = path.join(portableRoot, 'UserData')
  if (process.env.WEM_PORTABLE !== '1' || !store.isPortable() || !portableRoot || path.resolve(store.appDataDir()).toLowerCase() !== path.resolve(expected).toLowerCase()) {
    console.error('REFUSE  未进入隔离目录，测试中止')
    app.exit(2)
    return
  }
  const filesBefore = fingerprintFiles()
  const envBefore = await fingerprintEnv()
  try {
    staticChecks()
    await behaviorChecks()
    await coverageChecks()
  } catch (err) {
    check('测试过程没有抛出未捕获异常', false, err && err.stack ? err.stack : String(err))
  }
  const filesAfter = fingerprintFiles()
  const envAfter = await fingerprintEnv()
  check('真实配置、任务、日志、快照未被改动', filesBefore === filesAfter)
  check('真实环境变量未被改动', envBefore === envAfter)
  const failed = results.filter((item) => !item.pass)
  const summary = { total: results.length, failed: failed.length, items: results }
  fs.writeFileSync(path.join(__dirname, 'test-adapt-result.json'), JSON.stringify(summary, null, 2), 'utf8')
  console.log(`\n${failed.length ? 'FAILED' : 'OK'}  ${results.length - failed.length}/${results.length}`)
  for (const item of failed) console.log(` - ${item.name}${item.extra ? ' :: ' + item.extra.split('\n')[0] : ''}`)
  try { fs.rmSync(store.appDataDir(), { recursive: true, force: true }) } catch { /* 临时目录留着也不影响真实数据 */ }
  app.exit(failed.length ? 1 : 0)
}).catch((err) => {
  console.error(err)
  app.exit(1)
})
