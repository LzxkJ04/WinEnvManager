'use strict'
/**
 * 预加载脚本 —— 安全桥接层
 * 渲染进程只能通过 window.envAPI 调用白名单内的主进程能力，
 * 无法直接访问 Node / Electron 原生 API。
 */
const { contextBridge, ipcRenderer } = require('electron')

const call = (channel) => (payload) => ipcRenderer.invoke(channel, payload)

const ALLOWED_EVENTS = [
  'tray:action', 'theme:system-changed', 'window:maximize-changed', 'app:before-quit',
  'app:quit-query', 'app:scheduled',
  'task:change', 'devenv:scan-progress', 'env:external-changed', 'envset:project-activity',
  'reg:external-changed', 'reg:restored', 'health:scan-progress', 'regReplace:progress'
]

contextBridge.exposeInMainWorld('envAPI', {
  /* 平台信息 */
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  },

  /* 1~9 环境变量 */
  env: {
    getAllEnv: call('env:getAllEnv'),
    addEnv: call('env:addEnv'),
    editEnv: call('env:editEnv'),
    deleteEnv: call('env:deleteEnv'),
    applyChanges: call('env:applyChanges'),
    getPathItems: call('env:getPathItems'),
    savePathItems: call('env:savePathItems'),
    validatePath: call('env:validatePath'),
    reloadExplorer: call('env:reloadExplorer'),
    expandString: call('env:expandString'),
    writeOne: call('env:writeOne'),
    isAdmin: call('env:isAdmin'),
    getDetailed: call('env:getDetailed'),
    validatePathext: call('env:validatePathext')
  },

  /* 变量元数据（备注 / 锁定 / 标签 / 收藏 / 历史 / 来源） */
  meta: {
    all: call('meta:all'),
    set: call('meta:set'),
    toggleFavorite: call('meta:toggleFavorite'),
    setTags: call('meta:setTags'),
    setLocked: call('meta:setLocked'),
    removeVar: call('meta:removeVar'),
    history: call('meta:history'),
    pathSet: call('meta:pathSet'),
    markSensitive: call('meta:markSensitive')
  },

  /* 分析类能力 */
  analyze: {
    sensitiveScan: call('analyze:sensitiveScan'),
    refs: call('analyze:refs'),
    brokenRefs: call('analyze:brokenRefs'),
    nameShadow: call('analyze:nameShadow'),
    circularRefs: call('analyze:circularRefs'),
    externalCheck: call('analyze:externalCheck'),
    registryAcl: call('analyze:registryAcl'),
    terminalEnv: call('analyze:terminalEnv'),
    pathPerf: call('analyze:pathPerf'),
    storage: call('analyze:storage')
  },

  /* 10~11 快照与对比 */
  snapshot: {
    create: call('snapshot:create'),
    list: call('snapshot:list'),
    get: call('snapshot:get'),
    remove: call('snapshot:delete'),
    compare: call('snapshot:compare'),
    prepareRestore: call('snapshot:prepareRestore'),
    restore: call('snapshot:restore'),
    setBaseline: call('snapshot:setBaseline'),
    getBaseline: call('snapshot:getBaseline'),
    setProtected: call('snapshot:setProtected'),
    previewPrune: call('snapshot:previewPrune'),
    archive: call('snapshot:archive')
  },

  /* 12~13 备份与还原 */
  backup: {
    export: call('backup:export'),
    import: call('backup:import'),
    list: call('backup:list'),
    remove: call('backup:delete'),
    openDir: call('backup:openDir'),
    readText: call('backup:readText'),
    parseText: call('backup:parseText'),
    exportV2: call('backup:exportV2'),
    readV2: call('backup:readV2'),
    prune: call('backup:prune'),
    setTag: call('backup:setTag'),
    copyToRemote: call('backup:copyToRemote')
  },

  /* 开发环境管理 */
  devenv: {
    listCatalog: call('devenv:listCatalog'),
    getItem: call('devenv:getItem'),
    saveCatalog: call('devenv:saveCatalog'),
    resolveUrl: call('devenv:resolveUrl'),
    scan: call('devenv:scan'),
    cancelScan: call('devenv:cancelScan'),
    validateItem: call('devenv:validateItem'),
    validateBatch: call('devenv:validateBatch'),
    buildPlan: call('devenv:buildPlan'),
    deploy: call('devenv:deploy'),
    uninstall: call('devenv:uninstall'),
    listIgnore: call('devenv:listIgnore'),
    addIgnore: call('devenv:addIgnore'),
    removeIgnore: call('devenv:removeIgnore'),
    audit: call('devenv:audit'),
    exportReport: call('devenv:exportReport'),
    openDir: call('devenv:openDir'),
    cacheStats: call('devenv:cacheStats'),
    clearCache: call('devenv:clearCache')
  },

  /* 识别规则库 */
  rules: {
    list: call('rules:list'),
    get: call('rules:get'),
    save: call('rules:save'),
    remove: call('rules:delete'),
    exportAll: call('rules:export'),
    importAll: call('rules:import')
  },

  /* 后台任务队列 */
  task: {
    list: call('task:list'),
    get: call('task:get'),
    cancel: call('task:cancel'),
    pause: call('task:pause'),
    resume: call('task:resume'),
    retry: call('task:retry'),
    clearFinished: call('task:clearFinished'),
    pauseAll: call('task:pauseAll'),
    resumeAll: call('task:resumeAll'),
    setConcurrency: call('task:setConcurrency')
  },

  /* 环境配置集 */
  envset: {
    list: call('envset:list'),
    get: call('envset:get'),
    create: call('envset:create'),
    update: call('envset:update'),
    remove: call('envset:delete'),
    duplicate: call('envset:duplicate'),
    exportSet: call('envset:export'),
    importSet: call('envset:import'),
    exportToFile: call('envset:exportToFile'),
    listMutex: call('envset:listMutex'),
    createMutex: call('envset:createMutex'),
    updateMutex: call('envset:updateMutex'),
    deleteMutex: call('envset:deleteMutex'),
    assignMutex: call('envset:assignMutex'),
    membersOf: call('envset:membersOf'),
    templates: call('envset:templates'),
    getTemplate: call('envset:getTemplate'),
    launchTerminal: call('envset:launchTerminal'),
    syncWatch: call('envset:syncWatch'),
    startWatch: call('envset:startWatch'),
    stopWatch: call('envset:stopWatch'),
    ignorePrompt: call('envset:ignorePrompt')
  },

  /* 14~16 工具箱 */
  tool: {
    elevate: call('tool:elevate'),
    openRegEnv: call('tool:openRegEnv'),
    openNativeEnvPanel: call('tool:openNativeEnvPanel'),
    restartExplorer: call('tool:restartExplorer'),
    broadcastChange: call('tool:broadcastChange'),
    openFolder: call('tool:openFolder'),
    openExternal: call('tool:openExternal'),
    showInFolder: call('tool:showInFolder'),
    envSummary: call('tool:envSummary'),
    whichCommand: call('tool:whichCommand'),
    resetEnvDefaults: call('tool:resetEnvDefaults'),
    listExecutables: call('tool:listExecutables')
  },

  /* 17~19 文件选择 */
  fs: {
    selectFolder: call('fs:selectFolder'),
    selectFile: call('fs:selectFile'),
    saveFile: call('fs:saveFile'),
    readTextFile: call('fs:readTextFile'),
    writeTextFile: call('fs:writeTextFile')
  },

  /* 20 配置 */
  config: {
    get: call('config:get'),
    set: call('config:set')
  },

  table: {
    load: call('table:load'),
    save: call('table:save')
  },

  project: {
    list: call('project:list'),
    save: call('project:save'),
    remove: call('project:remove'),
    parseFile: call('project:parseFile'),
    launch: call('project:launch')
  },

  /* 21 日志 */
  log: {
    write: call('log:write'),
    list: call('log:list'),
    clear: call('log:clear'),
    openDir: call('log:openDir')
  },

  /* 审计日志（只读） */
  audit: {
    list: call('audit:list'),
    openDir: call('audit:openDir')
  },

  /* 应用与窗口 */
  app: {
    getInfo: call('app:getInfo'),
    setAutoLaunch: call('app:setAutoLaunch'),
    getAutoLaunch: call('app:getAutoLaunch'),
    quitDecision: call('app:quitDecision'),
    checkUpdate: call('app:checkUpdate')
  },

  win: {
    minimize: call('win:minimize'),
    maximizeToggle: call('win:maximizeToggle'),
    isMaximized: call('win:isMaximized'),
    close: call('win:close'),
    hideToTray: call('win:hideToTray'),
    resetBounds: call('win:resetBounds')
  },

  /* ==================== 注册表模块（契约固定，勿改结构） ==================== */

  /* 注册表浏览与键值读写 */
  reg: {
    // 树与键值
    roots: call('reg:roots'),
    subKeys: call('reg:subKeys'),
    values: call('reg:values'),
    readTree: call('reg:readTree'),
    envPaths: call('reg:envPaths'),
    isAdmin: call('reg:isAdmin'),
    keyExists: call('reg:keyExists'),
    // 写入
    createKey: call('reg:createKey'),
    setValue: call('reg:setValue'),
    deleteValue: call('reg:deleteValue'),
    deleteKey: call('reg:deleteKey'),
    // 导入导出
    exportReg: call('reg:exportReg'),
    parseReg: call('reg:parseReg'),
    previewImport: call('reg:previewImport'),
    applyImport: call('reg:applyImport'),
    // 搜索
    search: call('reg:search'),
    broadcast: call('reg:broadcast'),
    // 选择文件/目录
    pickRegFile: call('reg:pickRegFile'),
    pickSaveReg: call('reg:pickSaveReg')
  },

  /* 注册表备份管理 */
  regBackup: {
    list: call('regBackup:list'),
    create: call('regBackup:create'),
    preview: call('regBackup:preview'),
    restore: call('regBackup:restore'),
    remove: call('regBackup:remove'),
    toggleProtect: call('regBackup:toggleProtect'),
    exportFile: call('regBackup:exportFile'),
    openDir: call('regBackup:openDir'),
    prune: call('regBackup:prune')
  },

  /* 注册表对比 */
  regDiff: {
    compare: call('regDiff:compare'),
    compareWithCurrent: call('regDiff:compareWithCurrent'),
    exportReport: call('regDiff:exportReport'),
    buildRollback: call('regDiff:buildRollback')
  },

  /* 注册表依赖分析 */
  regDep: {
    analyze: call('regDep:analyze'),
    findReferences: call('regDep:findReferences'),
    graph: call('regDep:graph')
  },

  /* 注册表变更监控 */
  regWatch: {
    list: call('regWatch:list'),
    add: call('regWatch:add'),
    remove: call('regWatch:remove'),
    start: call('regWatch:start'),
    stop: call('regWatch:stop'),
    logs: call('regWatch:logs'),
    clearLogs: call('regWatch:clearLogs'),
    exportLogs: call('regWatch:exportLogs')
  },

  /* 批量查找替换 */
  regReplace: {
    scan: call('regReplace:scan'),
    apply: call('regReplace:apply')
  },

  /* 注册表收藏夹 */
  regFav: {
    list: call('regFav:list'),
    create: call('regFav:create'),
    update: call('regFav:update'),
    remove: call('regFav:remove'),
    groups: call('regFav:groups'),
    exportJson: call('regFav:exportJson'),
    importJson: call('regFav:importJson')
  },

  /* 全软件配置打包 */
  configPack: {
    exportPack: call('configPack:exportPack'),
    inspectPack: call('configPack:inspectPack'),
    importPack: call('configPack:importPack'),
    pickSave: call('configPack:pickSave'),
    pickOpen: call('configPack:pickOpen')
  },

  /* 环境健康诊断 */
  health: {
    scan: call('health:scan'),
    previewFix: call('health:previewFix'),
    applyFix: call('health:applyFix'),
    exportReport: call('health:exportReport'),
    lastScore: call('health:lastScore')
  },

  /* 定时任务 */
  schedule: {
    list: call('schedule:list'),
    create: call('schedule:create'),
    update: call('schedule:update'),
    remove: call('schedule:remove'),
    runNow: call('schedule:runNow'),
    setEnabled: call('schedule:setEnabled'),
    preview: call('schedule:preview')
  },

  /* 主进程 -> 渲染进程 事件订阅（白名单） */
  on(channel, listener) {
    if (!ALLOWED_EVENTS.includes(channel) || typeof listener !== 'function') return () => {}
    const wrapped = (_event, payload) => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },

  /* 配置高级操作 */
  configReset: call('config:resetSettings'),
  configRepair: call('config:repairNow')
})
