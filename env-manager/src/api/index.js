/**
 * 渲染进程 API 访问层
 *
 * 正常情况使用 preload 暴露的 window.envAPI（经 IPC 调用主进程）。
 * 在纯浏览器中打开（无 Electron 环境）时自动降级为演示数据，便于 UI 预览；
 * 演示模式会在界面上明显标识，绝不造成"看起来像真实数据"的误解。
 */

const real = typeof window !== 'undefined' ? window.envAPI : null

export const isDemo = !real

/* ------------------------------ 演示数据 ------------------------------ */

const DEMO_USER = {
  Path: '%USERPROFILE%\\AppData\\Local\\Microsoft\\WindowsApps;%APPDATA%\\npm',
  TEMP: '%USERPROFILE%\\AppData\\Local\\Temp',
  TMP: '%USERPROFILE%\\AppData\\Local\\Temp',
  JAVA_HOME: 'C:\\dev\\soft\\jdk-17',
  MAVEN_HOME: 'C:\\dev\\soft\\apache-maven-3.9.9',
  http_proxy: 'http://127.0.0.1:7890',
  // 仅用于浏览器演示的脱敏示例值，不是真实凭据
  GITHUB_TOKEN: '<示例令牌-已脱敏>'
}
const DEMO_MACHINE = {
  Path:
    'C:\\tools\\Python315\\Scripts;C:\\tools\\Python315;C:\\tools\\nodejs;' +
    '%SystemRoot%\\system32;%SystemRoot%;%SystemRoot%\\System32\\Wbem;C:\\Windows\\System32\\OpenSSH\\',
  ComSpec: '%SystemRoot%\\system32\\cmd.exe',
  OS: 'Windows_NT',
  PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.JS;.WS;.MSC',
  PROCESSOR_ARCHITECTURE: 'AMD64',
  NUMBER_OF_PROCESSORS: '16',
  windir: '%SystemRoot%'
}

const demoState = { user: { ...DEMO_USER }, machine: { ...DEMO_MACHINE } }
let demoTableLayout = { tables: {}, formats: {}, presets: {}, settings: {} }
const demoProjects = []

const mapToArray = (m, scope) => Object.keys(m).map((k) => ({ name: k, value: m[k], scope }))
const ok = (data) => Promise.resolve({ ok: true, data })
const clone = (v) => JSON.parse(JSON.stringify(v))

function demoPlainObject(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  return clone(v)
}

function demoHasOwn(obj, key) {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined
}

function demoString(v, fallback) {
  return v == null ? fallback : String(v)
}

function demoNormalizeProject(input, prev) {
  const p = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const base = prev || {}
  const terminal = demoHasOwn(p, 'terminal') ? p.terminal : (base.terminal || 'cmd')
  if (terminal !== 'cmd' && terminal !== 'powershell' && terminal !== 'wt') {
    throw new Error('terminal 只能是 cmd、powershell 或 wt')
  }
  const cwdMode = demoHasOwn(p, 'cwdMode') ? p.cwdMode : (base.cwdMode || 'project')
  if (cwdMode !== 'project' && cwdMode !== 'custom') {
    throw new Error('cwdMode 只能是 project 或 custom')
  }
  const rawTags = demoHasOwn(p, 'tags') ? p.tags : base.tags
  const rawVars = demoHasOwn(p, 'vars') ? p.vars : base.vars
  return {
    id: demoHasOwn(p, 'id') && p.id ? String(p.id) : (base.id || `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`),
    name: demoHasOwn(p, 'name') ? demoString(p.name, '') : demoString(base.name, ''),
    folder: demoHasOwn(p, 'folder') ? demoString(p.folder, '') : demoString(base.folder, ''),
    tags: Array.isArray(rawTags) ? rawTags.map((t) => String(t)) : [],
    remark: demoHasOwn(p, 'remark') ? demoString(p.remark, '') : demoString(base.remark, ''),
    terminal,
    cwdMode,
    customCwd: demoHasOwn(p, 'customCwd') ? demoString(p.customCwd, '') : demoString(base.customCwd, ''),
    inheritGlobal: demoHasOwn(p, 'inheritGlobal') ? !!p.inheritGlobal : (base.inheritGlobal !== undefined ? !!base.inheritGlobal : true),
    vars: Array.isArray(rawVars) ? rawVars.map((v) => ({
      name: v && v.name != null ? String(v.name) : '',
      value: v && v.value != null ? String(v.value) : '',
      enabled: !v || v.enabled !== false
    })) : [],
    preScript: demoHasOwn(p, 'preScript') ? demoString(p.preScript, '') : demoString(base.preScript, ''),
    autoDotenv: demoHasOwn(p, 'autoDotenv') ? !!p.autoDotenv : (base.autoDotenv !== undefined ? !!base.autoDotenv : true),
    launchCommand: demoHasOwn(p, 'launchCommand') ? demoString(p.launchCommand, '') : demoString(base.launchCommand, ''),
    updatedAt: new Date().toISOString()
  }
}

function demoParseEnvText(text, filename) {
  const entries = []
  const errors = []
  const indexByKey = new Map()
  String(text == null ? '' : text).replace(/^\uFEFF/, '').split(/\r?\n/).forEach((raw, i) => {
    const lineNo = i + 1
    const trimmed = String(raw).trim()
    if (!trimmed || trimmed.startsWith('#')) return
    let line = String(raw)
    const exported = /^(\s*)export\s+([\s\S]*)$/.exec(line)
    if (exported && exported[2].indexOf('=') >= 0) line = exported[1] + exported[2]
    const eq = line.indexOf('=')
    if (eq < 0) {
      errors.push({ line: lineNo, message: '无法解析该行' })
      return
    }
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (value.length >= 2) {
      const q = value[0]
      if ((q === '"' || q === "'") && value.endsWith(q)) value = value.slice(1, -1)
    }
    const entry = { key, value, line: lineNo, file: filename }
    if (!key || /\s/.test(key) || key.includes('=') || key.includes(';')) {
      entry.invalid = true
      errors.push({ line: lineNo, message: '变量名不合法' })
    }
    if (indexByKey.has(key)) {
      errors.push({ line: lineNo, message: `重复变量「${key}」，已保留最后一条` })
      entries[indexByKey.get(key)] = entry
    } else {
      indexByKey.set(key, entries.length)
      entries.push(entry)
    }
  })
  return { entries, errors }
}

function demoFail(err) {
  return Promise.resolve({ ok: false, message: (err && err.message) || String(err) })
}

const demoScanItems = [
  { id: 'jdk::c:\\dev\\soft\\jdk-17', ruleId: 'jdk', name: 'JDK', category: '语言运行时', version: '17.0.12', installPath: 'C:\\dev\\soft\\jdk-17', exePath: 'C:\\dev\\soft\\jdk-17\\bin\\java.exe', sources: ['path-scan', 'home-var'], managed: true, ignored: false, variables: [] },
  { id: 'node::c:\\tools\\nodejs', ruleId: 'node', name: 'Node.js', category: '语言运行时', version: '24.22.0', installPath: 'C:\\tools\\nodejs', exePath: 'C:\\tools\\nodejs\\node.exe', sources: ['path-scan'], managed: false, ignored: false, variables: [] },
  { id: 'python::c:\\tools\\python315', ruleId: 'python', name: 'Python', category: '语言运行时', version: '3.15.0', installPath: 'C:\\tools\\Python315', exePath: 'C:\\tools\\Python315\\python.exe', sources: ['path-scan'], managed: false, ignored: false, variables: [] },
  { id: 'git::c:\\program files\\git', ruleId: 'git', name: 'Git', category: '构建&包管理', version: '2.47.0', installPath: 'C:\\Program Files\\Git', exePath: 'C:\\Program Files\\Git\\cmd\\git.exe', sources: ['registry'], managed: false, ignored: false, variables: [] }
]

const demoTask = { id: 't-demo-1', name: '部署 Node.js 22.11.0', type: 'deploy', status: 'success', progress: 100, received: 0, total: 0, speed: 0, createdAt: Date.now() - 60000, error: '', logs: [{ at: Date.now(), level: 'info', text: '任务执行成功' }], dependsOn: [], retries: 0 }

const demoApi = {
  platform: 'win32',
  versions: { electron: '33 (演示)', chrome: '130', node: '20' },

  env: {
    getAllEnv: () => ok({ user: mapToArray(demoState.user, 'user'), machine: mapToArray(demoState.machine, 'machine'), admin: false, readAt: Date.now() }),
    getDetailed: () => ok({
      userEnv: mapToArray(demoState.user, 'user').map((v) => ({ key: v.name, value: v.value, remark: '', locked: false, source: 'system-native' })),
      systemEnv: mapToArray(demoState.machine, 'machine').map((v) => ({ key: v.name, value: v.value, remark: '', locked: false, source: 'system-native' })),
      pathext: { value: demoState.machine.PATHEXT, locked: false },
      admin: false, readAt: Date.now()
    }),
    applyChanges: (changes) => {
      changes.forEach((c) => {
        if (c.action === 'delete') delete demoState[c.scope][c.name]
        else demoState[c.scope][c.name] = c.value
      })
      return ok({ results: changes.map((c) => ({ name: c.name, ok: true })), needRestartExplorer: true })
    },
    validatePath: (list) => ok({
      result: list.map((p) => ({ path: p, expanded: p, exists: /tools|Windows|npm/i.test(p) })),
      invalid: list.filter((p) => !/tools|Windows|npm/i.test(p))
    }),
    validatePathext: (value) => ok({ entries: String(value).split(';').filter(Boolean), invalid: [], duplicate: [], valid: true }),
    expandString: (t) => ok(String(t).replace(/%([^%]+)%/g, (m, n) => demoState.user[n] || demoState.machine[n] || m)),
    isAdmin: () => ok(false),
    addEnv: () => ok(true), editEnv: () => ok(true), deleteEnv: () => ok([{ ok: true }]),
    getPathItems: () => ok({
      user: String(demoState.user.Path).split(';').filter(Boolean).map((p, i) => ({ id: `u-${i}`, path: p, scope: 'user' })),
      machine: String(demoState.machine.Path).split(';').filter(Boolean).map((p, i) => ({ id: `m-${i}`, path: p, scope: 'machine' }))
    }),
    savePathItems: ({ scope, items }) => {
      demoState[scope].Path = items.map((i) => i.path).join(';')
      return ok({ value: demoState[scope].Path, length: demoState[scope].Path.length })
    },
    reloadExplorer: () => ok(true), writeOne: () => ok(true)
  },

  meta: {
    all: () => ok({ vars: {}, path: {} }),
    set: () => ok({}), toggleFavorite: () => ok({}), setTags: () => ok({}),
    setLocked: () => ok({}), removeVar: () => ok(true), history: () => ok([]),
    pathSet: () => ok({}), markSensitive: () => ok({ hits: [] })
  },

  analyze: {
    sensitiveScan: () => ok({ total: 1, items: [{ scope: 'user', name: 'GITHUB_TOKEN', value: demoState.user.GITHUB_TOKEN, labels: ['API Key'], masked: '<示例令牌-已脱敏>' }] }),
    refs: (p) => ok({ name: p.name, referencedBy: [], count: 0 }),
    brokenRefs: () => ok({ total: 1, items: [{ scope: 'user', name: 'MAVEN_HOME', ref: 'OLD_JDK', value: '%OLD_JDK%\\bin' }] }),
    circularRefs: () => ok({ total: 0, items: [] }),
    nameShadow: () => ok({
      total: 2, counts: { shadow: 1, duplicate: 0, path: 1 },
      items: [
        { name: 'JAVA_HOME', kind: 'shadow', severity: 'medium', userValue: 'C:\\jdk-17', machineValue: 'C:\\jdk-8', note: '用户值遮蔽系统值：新进程实际读到的是用户值' },
        { name: 'PATH', kind: 'path', severity: 'info', userValue: '%JAVA_HOME%\\bin', machineValue: 'C:\\Windows\\system32', note: 'PATH 特殊：用户与系统值会拼接生效，不构成遮蔽' }
      ]
    }),
    externalCheck: () => ok({ enabled: true, changed: false, fingerprint: 'demo' }),
    registryAcl: () => ok({ admin: false, results: [{ target: '用户变量 HKCU\\Environment', writable: true, readable: true, message: '可读可写' }] }),
    terminalEnv: () => ok({ shell: 'cmd', total: 40, onlyInTerminal: [], onlyInRegistry: [], different: [] }),
    pathPerf: () => ok({ items: [{ scope: 'user', count: 2, length: 92, invalid: 0, dup: 0 }, { scope: 'machine', count: 11, length: 371, invalid: 0, dup: 0 }], total: 13, totalLen: 463, invalid: 0, advice: ['当前 PATH 配置良好。'] }),
    storage: () => ok({
      config: { dir: '', size: 2048, files: 1 }, snapshots: { dir: '', size: 0, files: 0 },
      logs: { dir: '', size: 0, files: 0 }, cache: { dir: '', size: 0, files: 0 }, backups: { dir: '', size: 0, files: 0 }
    })
  },

  snapshot: {
    create: ({ name }) => ok({ id: `demo-${Date.now()}`, name: name || '演示快照', note: '', auto: false, createdAt: Date.now(), createdAtText: new Date().toLocaleString('zh-CN'), counts: { user: 3, machine: 10 }, user: clone(demoState.user), machine: clone(demoState.machine) }),
    list: () => ok([{ id: 'demo-1', name: '安装 Node 前', note: '基线', auto: false, createdAt: Date.now() - 86400000, createdAtText: '2026-10-16 09:00:00', counts: { user: 3, machine: 9 } }]),
    get: () => ok({ user: clone(demoState.user), machine: clone(demoState.machine) }),
    remove: () => ok(true),
    compare: () => ok({ user: { added: [], removed: [], changed: [{ name: 'JAVA_HOME', from: 'C:\\jdk8', to: 'C:\\dev\\soft\\jdk-17' }] }, machine: { added: [], removed: [], changed: [] }, summary: { added: 0, removed: 0, changed: 1, total: 1 }, leftLabel: '快照', rightLabel: '当前环境' }),
    prepareRestore: () => ok({ plan: [], checksum: { ok: true, legacy: true, reason: '演示快照' } }),
    restore: ({ items }) => ok({ count: (items || []).length, rollbackId: '', verified: true, legacy: false, reason: '演示模式未写入系统' }),
    setBaseline: () => ok({}), getBaseline: () => ok(''),
    setProtected: ({ id, protected: p }) => ok({ id, protected: !!p }),
    previewPrune: () => ok({ limit: 20, total: 3, willRemove: [], protectedCount: 0 }),
    archive: (ids) => ok({ file: 'C:\\temp\\archive.json', count: (ids || []).length, size: 2048 })
  },

  backup: {
    export: ({ format }) => ok({ file: `C:\\Users\\Administrator\\Documents\\EnvBackup\\Backup-demo.${format || 'json'}`, format, size: 4096 }),
    exportV2: ({ format }) => ok({ file: `C:\\Users\\Administrator\\Documents\\EnvBackup\\Backup-demo.${format || 'json'}`, format, size: 4096, type: 'full' }),
    import: () => ok({ canceled: true }),
    readV2: () => ok({ meta: {}, entries: [], checksumOk: true, encrypted: false, total: 0 }),
    list: () => ok({ dir: 'C:\\Users\\Administrator\\Documents\\EnvBackup', files: [], config: {} }),
    remove: () => ok(true), openDir: () => ok(true), readText: () => ok(''),
    parseText: () => ok({ total: 0, entries: [] }), prune: () => ok(0),
    setTag: () => ok({}), copyToRemote: () => ok({})
  },

  devenv: {
    listCatalog: () => ok({
      items: [
        { id: 'node', name: 'Node.js', ruleId: 'node', category: '语言运行时', description: 'JavaScript 运行时，含 npm', versions: ['22.11.0', '20.18.0'], installMode: 'portable', sizeHint: '约 30 MB', requires: [], official: '', mirrorTemplate: '' },
        { id: 'python', name: 'Python', ruleId: 'python', category: '语言运行时', description: 'Python 官方安装包，静默安装', versions: ['3.13.0', '3.12.7'], installMode: 'silent', sizeHint: '约 25 MB', requires: [], official: '', mirrorTemplate: '' },
        { id: 'jdk', name: 'JDK (Temurin 17)', ruleId: 'jdk', category: '语言运行时', description: 'OpenJDK 17 绿色版', versions: ['jdk-17.0.12+7'], installMode: 'portable', sizeHint: '约 190 MB', requires: [], official: '', mirrorTemplate: '' },
        { id: 'git', name: 'Git for Windows', ruleId: 'git', category: '构建&包管理', description: 'Git 版本控制，静默安装', versions: ['2.47.0'], installMode: 'silent', sizeHint: '约 65 MB', requires: [], official: '', mirrorTemplate: '' },
        { id: 'maven', name: 'Maven', ruleId: 'maven', category: '构建&包管理', description: '构建工具', versions: ['3.9.9'], installMode: 'portable', sizeHint: '约 9 MB', requires: ['jdk'], official: '', mirrorTemplate: '' },
        { id: 'redis', name: 'Redis (Windows)', ruleId: 'redis', category: '数据库中间件', description: 'Redis Windows 版，支持注册服务', versions: ['5.0.14.1'], installMode: 'portable', sizeHint: '约 8 MB', requires: [], official: '', mirrorTemplate: '' }
      ],
      mirrors: { nodejs: 'https://npmmirror.com/mirrors/node', python: 'https://npmmirror.com/mirrors/python' }
    }),
    getItem: () => ok(null),
    resolveUrl: () => ok({ url: 'https://example.com/download.zip', source: 'mirror' }),
    scan: () => ok({ scannedAt: Date.now(), deep: false, totalDirs: 42, registryEntries: 120, items: clone(demoScanItems), cancelled: false }),
    cancelScan: () => ok(true),
    validateItem: () => ok({ ok: true, version: '1.0.0', exePath: '', cmd: '' }),
    validateBatch: (items) => ok(items.map((i) => ({ name: i.name, ok: true, version: i.version || '1.0.0' }))),
    buildPlan: () => ok({ rule: { id: 'x', name: 'x' }, plan: [], managed: false }),
    deploy: () => ok(clone(demoTask)),
    uninstall: () => ok(clone(demoTask)),
    listIgnore: () => ok([]), addIgnore: () => ok(true), removeIgnore: () => ok(true),
    audit: () => ok({
      scannedAt: Date.now(), total: demoScanItems.length, managed: 1, discovered: 3, ignored: 0,
      invalidPaths: ['C:\\not\\exist'], dupPaths: [], conflicts: [],
      issues: [{ level: 'error', risk: 'high', title: 'Node.js 缺少 HOME 类环境变量', detail: 'NODE_HOME（建议值 C:\\tools\\nodejs）', installPath: 'C:\\tools\\nodejs', ruleId: 'node', fix: [] }],
      okItems: ['JDK 变量完整'], items: clone(demoScanItems),
      summary: { errors: 1, warns: 0, high: 1, medium: 0, low: 0 }
    }),
    exportReport: () => ok({ file: 'C:\\temp\\report.md', size: 1024 }),
    openDir: () => ok(''), cacheStats: () => ok({ dir: '', size: 0, count: 0 }), clearCache: () => ok(0)
  },

  rules: {
    list: () => ok({ ruleVersion: '1.0', rules: [] }),
    get: () => ok(null), save: () => ok({}), remove: () => ok(true),
    exportAll: () => ok('{}'), importAll: () => ok({ imported: 0, skipped: [], total: 0 })
  },

  task: {
    list: () => ok(clone(demoTasks())),
    get: () => ok(clone(demoTask)), cancel: () => ok(true), pause: () => ok(true),
    resume: () => ok(true), retry: () => ok(true), clearFinished: () => ok(0),
    pauseAll: () => ok(0), resumeAll: () => ok(0), setConcurrency: () => ok(2)
  },

  envset: {
    list: () => ok({
      sets: [
        { id: 'cs-1', name: 'JDK17 开发环境', type: 'global', comment: '日常开发', group: 'Java', readOnly: false, projectDir: '', folderWatch: false, mutexId: 'mg-1', variables: [{ scope: 'user', key: 'JAVA_HOME', value: 'C:\\dev\\soft\\jdk-17', remark: 'JDK 主目录' }] },
        { id: 'cs-2', name: 'web-demo 项目环境', type: 'project', comment: '前端项目', group: '', readOnly: false, projectDir: 'D:\\project\\web-demo', folderWatch: true, mutexId: '', variables: [{ scope: 'user', key: 'NODE_ENV', value: 'development', remark: '' }] }
      ],
      mutex: [{ id: 'mg-1', name: 'JDK多版本切换组', comment: '', autoClean: true, forceBlock: false, snapshotBefore: true }]
    }),
    get: () => ok(null), create: () => ok({ id: 'cs-new' }), update: () => ok({}),
    remove: () => ok(true), duplicate: () => ok({ id: 'cs-copy' }),
    exportSet: () => ok({ set: { name: 'x', variables: [] } }),
    importSet: () => ok({ id: 'cs-import' }),
    exportToFile: () => ok({ file: 'C:\\temp\\set.json' }),
    listMutex: () => ok([]), createMutex: () => ok({ id: 'mg-new' }),
    updateMutex: () => ok({}), deleteMutex: () => ok(true), assignMutex: () => ok({}),
    membersOf: () => ok([]),
    templates: () => ok([{ id: 'java', name: 'Java / JDK', desc: 'JAVA_HOME + PATH' }]),
    getTemplate: () => ok([]),
    launchTerminal: () => ok({ pid: 1234, shell: 'cmd', cwd: '', injected: 5, warning: '' }),
    syncWatch: () => ok({ started: true, count: 1 }),
    startWatch: () => ok({ started: true, count: 1 }), stopWatch: () => ok(true), ignorePrompt: () => ok(true)
  },

  fs: {
    selectFolder: () => ok({ canceled: false, path: 'C:\\dev\\soft' }),
    selectFile: () => ok({ canceled: true }),
    saveFile: () => ok({ canceled: false, path: 'C:\\temp\\export.txt' }),
    readTextFile: () => ok(''),
    writeTextFile: () => ok({ file: '', size: 0 })
  },

  config: {
    get: () => ok({
      config: {
        theme: 'light', primaryColor: '#165DFF', language: 'zh-CN', pageSize: 20, rowHeight: 'middle', fontSize: 13,
        loadOnStart: true, startMinimized: false, autoLaunch: false,
        autoSnapshot: true, autoBackup: true, autoBackupFormat: 'json', backupDir: 'C:\\Users\\Administrator\\Documents\\EnvBackup',
        logEnabled: true, trayAction: 'minimize', confirmBeforeSave: true, undoMaxSteps: 50,
        saveValidatePath: true, detectExternal: true, draftAutoSave: true, autoRestartExplorerAfterSave: false, keepDraftOnExit: true,
        devRoot: 'C:\\dev\\soft', cacheDir: '', cacheMaxMB: 2048, downloadSource: 'mirror',
        mirrorNode: '', mirrorPython: '', mirrorGo: '', mirrorJdk: '', mirrorMaven: '', mirrorGradle: '', mirrorGithub: '',
        maxConcurrentDownloads: 2, deployVerifyVersion: true, multiVersionMode: 'coexist', dbRegisterService: false,
        taskDepends: true, verifyHash: true,
        scanOnStart: true, scanOnEnterPage: true, deepScan: false, scanCustomDirs: [], scanExcludeDirs: [], scanExcludeNames: [],
        auditIntervalHours: 0, scanTimeoutSec: 90, lastScanAt: 0,
        backupSchedule: 'off', backupKeep: 20, snapshotMax: 50, backupPassword: '', snapshotPaused: false,
        logKeepDays: 30, taskLogKeepDays: 30, logMaxSizeMB: 10, logLevel: 'info',
        confirmDanger: true, lockProtect: true, avWarning: true, detectSensitive: true, desensitizeExport: false,
        updateChannel: 'stable', updateUrl: '', checkUpdateOnStart: false,
        compactMode: false, showPathCount: true, confirmOnQuit: true, rememberWindow: true,
        windowBounds: null, scanIgnoreList: [],
        lastScheduledBackupAt: 0, lastAuditAt: 0, lastUpdateCheckAt: 0, draftCache: null
      },
      paths: {
        appData: '%APPDATA%\\win-env-manager', config: '%APPDATA%\\win-env-manager\\config.json',
        snapshots: '%APPDATA%\\win-env-manager\\snapshots', logs: '%APPDATA%\\win-env-manager\\logs',
        auditDir: '%APPDATA%\\win-env-manager\\audit',
        exports: '%APPDATA%\\win-env-manager\\exports',
        backupDir: 'C:\\Users\\Administrator\\Documents\\EnvBackup',
        defaultBackupDir: 'C:\\Users\\Administrator\\Documents\\EnvBackup',
        cacheDir: '%APPDATA%\\win-env-manager\\cache', devRoot: 'C:\\dev\\soft'
      },
      install: {
        installed: false, installPath: '', userDataRoot: '', version: '', installDate: '', updateUrl: '', source: 'fallback', portable: false
      }
    }),
    set: (patch) => ok({ config: patch, paths: {} })
  },

  table: {
    load: () => ok(clone(demoTableLayout)),
    save: (payload) => {
      const p = payload || {}
      demoTableLayout = {
        tables: demoPlainObject(p.tables),
        formats: demoPlainObject(p.formats),
        presets: demoPlainObject(p.presets),
        settings: demoPlainObject(p.settings)
      }
      return ok({ saved: true })
    }
  },

  project: {
    list: () => ok(clone(demoProjects)),
    save: (payload) => {
      try {
        const id = payload && payload.id
        const idx = id ? demoProjects.findIndex((item) => item.id === id) : -1
        const saved = demoNormalizeProject(payload, idx >= 0 ? demoProjects[idx] : null)
        if (idx >= 0) demoProjects[idx] = saved
        else demoProjects.push(saved)
        return ok(clone(saved))
      } catch (err) {
        return demoFail(err)
      }
    },
    remove: (payload) => {
      const id = payload && payload.id
      if (!id) return demoFail(new Error('缺少项目 id'))
      const idx = demoProjects.findIndex((item) => item.id === id)
      if (idx < 0) return demoFail(new Error('项目不存在'))
      demoProjects.splice(idx, 1)
      return ok({ removed: true, id })
    },
    parseFile: (payload) => {
      const p = payload || {}
      return ok(demoParseEnvText(p.text == null ? '' : String(p.text), p.filename == null ? '' : String(p.filename)))
    },
    launch: (payload) => {
      const p = payload || {}
      const stored = p.id ? demoProjects.find((item) => item.id === p.id) : null
      const terminal = p.terminal || (stored && stored.terminal) || 'cmd'
      return ok({ pid: 0, terminal, demo: true })
    }
  },

  log: { write: () => ok(true), list: () => ok({ dir: '', files: [] }), clear: () => ok(0), openDir: () => ok(true) },

  audit: {
    list: () => ok({ items: [{ atText: '2026-10-18 01:00:00', origin: 'GUI', action: 'applyChanges', count: 2 }], dir: '' }),
    openDir: () => ok(true)
  },

  configReset: () => ok({}),
  configRepair: () => ok({ repaired: true, backupUsed: null }),

  app: {
    getInfo: () => ok({ name: 'WinEnvManager', title: 'WinEnv管家', version: '2.0.0', electron: '33', chrome: '130', node: '20', v8: '13', platform: 'win32 x64', exe: 'WinEnvManager.exe', packaged: true, resources: '', uptime: 1000, startedAt: Date.now() }),
    setAutoLaunch: () => ok(false), getAutoLaunch: () => ok(false),
    quitDecision: () => ok(false),
    checkUpdate: () => ok({ checked: false, current: '2.0.0', latest: '2.0.0', hasUpdate: false, reason: '演示模式不联网' })
  },

  win: { minimize: () => ok(true), maximizeToggle: () => ok(false), isMaximized: () => ok(false), close: () => ok(true), hideToTray: () => ok(true), resetBounds: () => ok({}) },

  tool: {
    elevate: () => ok({ exe: 'WinEnvManager.exe' }),
    openRegEnv: () => ok(''), openNativeEnvPanel: () => ok(true),
    restartExplorer: () => ok(true), broadcastChange: () => ok(true),
    openFolder: () => ok(true), openExternal: () => ok(true), showInFolder: () => ok(true),
    envSummary: () => ok({ counts: { user: 3, machine: 10, total: 13 }, config: {}, paths: {} }),
    whichCommand: () => ok({ name: 'node', matches: [{ order: 1, dir: 'C:\\tools\\nodejs', file: 'C:\\tools\\nodejs\\node.exe' }] }),
    resetEnvDefaults: () => ok({ removed: 5, restored: 3 })
  },

  on: () => () => {}
}

function demoTasks() {
  return [demoTask]
}

/** 通用兜底：未实现的演示方法返回空数据，保证浏览器预览不崩溃 */
function fallbackProxy() {
  const handler = {
    get(target, prop) {
      if (prop in target) {
        const v = target[prop]
        if (typeof v === 'object' && v !== null) return new Proxy(v, handler)
        return v
      }
      return () => ok(null)
    }
  }
  return new Proxy(demoApi, handler)
}

export const api = real || fallbackProxy()
export default api
