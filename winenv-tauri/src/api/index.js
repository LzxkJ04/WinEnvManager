/**
 * Tauri API 适配层
 * 与 Electron 版保持相同的方法面（api.env.getAllEnv ...），
 * 内部通过 Tauri invoke 调用 Rust 命令，返回统一 { ok, data } 结构。
 */
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@/lib/tauri'

export const isDemo = !isTauri

async function call(cmd, args = {}) {
  try {
    const data = await invoke(cmd, args)
    return { ok: true, data }
  } catch (err) {
    return { ok: false, message: typeof err === 'string' ? err : (err && err.message) || String(err) }
  }
}

const api = {
  platform: 'win32',
  versions: {},

  env: {
    getAllEnv: () => call('read_env'),
    getDetailed: () => call('read_env_detailed'),
    applyChanges: (changes) => call('apply_changes', { changes }),
    writeOne: (p) => call('write_one', { payload: p }),
    isAdmin: () => call('is_admin'),
    reloadExplorer: () => call('reload_explorer'),
    broadcastChange: () => call('broadcast_change'),
    validatePath: (list) => call('validate_paths', { paths: list }),
    validatePathext: (value) => call('validate_pathext', { value }),
    expandString: (t) => call('expand_string', { text: t }),
    addEnv: (p) => call('write_one', { payload: { ...p, action: 'create' } }),
    editEnv: (p) => call('write_one', { payload: { ...p, action: 'update' } }),
    deleteEnv: (items) => call('apply_changes', { changes: (Array.isArray(items) ? items : [items]).map((i) => ({ action: 'delete', scope: i.scope, name: i.name })) }),
    getPathItems: (scope) => call('path_items', { scope }),
    savePathItems: (p) => call('save_path_items', { payload: p })
  },

  meta: {
    all: () => call('meta_all'),
    set: (p) => call('meta_set', { payload: p }),
    removeVar: (p) => call('meta_remove', { payload: p }),
    history: (p) => call('meta_history', { payload: p }),
    pathSet: (p) => call('meta_path_set', { payload: p }),
    toggleFavorite: (p) => call('meta_toggle_favorite', { payload: p }),
    setTags: (p) => call('meta_set_tags', { payload: p }),
    setLocked: (p) => call('meta_set_locked', { payload: p }),
    markSensitive: (p) => call('meta_mark_sensitive', { payload: p })
  },

  analyze: {
    sensitiveScan: () => call('sensitive_scan'),
    refs: (p) => call('var_refs', { payload: p }),
    brokenRefs: () => call('broken_refs'),
    externalCheck: () => call('external_check'),
    registryAcl: () => call('registry_acl'),
    terminalEnv: (p) => call('terminal_env', { payload: p }),
    pathPerf: () => call('path_perf'),
    storage: () => call('storage_stats')
  },

  snapshot: {
    create: (p) => call('create_snapshot', { payload: p }),
    list: () => call('list_snapshots'),
    get: (id) => call('read_snapshot', { id }),
    remove: (id) => call('delete_snapshot', { id }),
    compare: (p) => call('compare_env', { payload: p }),
    prepareRestore: (p) => call('prepare_restore', { payload: p }),
    setBaseline: (id) => call('set_baseline', { id }),
    getBaseline: () => call('get_baseline')
  },

  backup: {
    export: (p) => call('create_backup', { payload: p }),
    exportV2: (p) => call('create_backup', { payload: p }),
    import: (p) => call('read_backup', { payload: p }),
    readV2: (p) => call('read_backup', { payload: p }),
    list: () => call('list_backups'),
    remove: (file) => call('delete_backup', { file }),
    openDir: (dir) => call('open_folder', { path: dir || '' }),
    readText: (file) => call('read_text_file', { file }),
    parseText: (text) => call('parse_text', { text }),
    prune: (max) => call('prune_backups', { max }),
    setTag: (p) => call('set_backup_tag', { payload: p }),
    copyToRemote: (p) => call('copy_to_remote', { payload: p })
  },

  devenv: {
    listCatalog: () => call('list_catalog'),
    getItem: (id) => call('get_catalog_item', { id }),
    resolveUrl: (p) => call('resolve_url', { payload: p }),
    scan: (p) => call('scan_env', { payload: p || {} }),
    cancelScan: () => call('cancel_scan'),
    validateItem: (item) => call('validate_item', { item }),
    validateBatch: (items) => call('validate_batch', { items }),
    buildPlan: (p) => call('build_plan', { payload: p }),
    deploy: (p) => call('create_deploy_task', { payload: p }),
    uninstall: (p) => call('create_uninstall_task', { payload: p }),
    listIgnore: () => call('list_ignore'),
    addIgnore: (key) => call('add_ignore', { key }),
    removeIgnore: (key) => call('remove_ignore', { key }),
    audit: (p) => call('run_audit', { payload: p || {} }),
    exportReport: (p) => call('export_report', { payload: p }),
    openDir: (kind) => call('open_dev_dir', { kind }),
    cacheStats: () => call('cache_stats'),
    clearCache: () => call('clear_cache')
  },

  rules: {
    list: () => call('list_rules'),
    get: (id) => call('get_rule', { id }),
    save: (rule) => call('save_rule', { rule }),
    remove: (id) => call('delete_rule', { id }),
    exportAll: () => call('export_rules'),
    importAll: (text) => call('import_rules', { text })
  },

  task: {
    list: () => call('list_tasks'),
    get: (id) => call('get_task', { id }),
    cancel: (id) => call('cancel_task', { id }),
    pause: (id) => call('pause_task', { id }),
    resume: (id) => call('resume_task', { id }),
    retry: (id) => call('retry_task', { id }),
    clearFinished: () => call('clear_finished_tasks'),
    pauseAll: () => call('pause_all_tasks'),
    resumeAll: () => call('resume_all_tasks'),
    setConcurrency: (n) => call('set_concurrency', { n })
  },

  envset: {
    list: () => call('envset_list'),
    get: (id) => call('envset_get', { id }),
    create: (p) => call('envset_create', { payload: p }),
    update: (p) => call('envset_update', { payload: p }),
    remove: (id) => call('envset_delete', { id }),
    duplicate: (id) => call('envset_duplicate', { id }),
    exportSet: (id) => call('envset_export', { id }),
    importSet: (json) => call('envset_import', { json }),
    exportToFile: (p) => call('envset_export_file', { payload: p }),
    listMutex: () => call('envset_list_mutex'),
    createMutex: (p) => call('envset_create_mutex', { payload: p }),
    updateMutex: (p) => call('envset_update_mutex', { payload: p }),
    deleteMutex: (id) => call('envset_delete_mutex', { id }),
    assignMutex: (p) => call('envset_assign_mutex', { payload: p }),
    membersOf: (id) => call('envset_members', { id }),
    templates: () => call('envset_templates'),
    getTemplate: (name) => call('envset_template', { name }),
    launchTerminal: (p) => call('launch_terminal', { payload: p }),
    startWatch: (p) => call('start_watch', { payload: p }),
    stopWatch: () => call('stop_watch'),
    ignorePrompt: (id) => call('envset_ignore_prompt', { id })
  },

  fs: {
    selectFolder: (p) => call('pick_folder', { payload: p || {} }),
    selectFile: (p) => call('pick_file', { payload: p || {} }),
    saveFile: (p) => call('pick_save', { payload: p || {} }),
    readTextFile: (file) => call('read_text_file', { file }),
    writeTextFile: (p) => call('write_text_file', { payload: p })
  },

  config: {
    get: () => call('get_config'),
    set: (patch) => call('set_config', { patch })
  },

  log: {
    write: (p) => call('write_log', { payload: p }),
    list: () => call('list_logs'),
    clear: () => call('clear_logs'),
    openDir: () => call('open_log_dir')
  },

  app: {
    getInfo: () => call('app_info'),
    setAutoLaunch: (v) => call('set_auto_launch', { enable: v }),
    getAutoLaunch: () => call('get_auto_launch')
  },

  win: {
    minimize: () => call('win_minimize'),
    close: () => call('win_close'),
    hideToTray: () => call('win_hide')
  },

  tool: {
    elevate: () => call('elevate'),
    openRegEnv: (scope) => call('open_reg_env', { scope }),
    openNativeEnvPanel: (kind) => call('open_native_panel', { kind }),
    restartExplorer: () => call('reload_explorer'),
    broadcastChange: () => call('broadcast_change'),
    openFolder: (path) => call('open_folder', { path }),
    openExternal: (url) => call('open_external', { url }),
    showInFolder: (path) => call('show_in_folder', { path }),
    envSummary: () => call('env_summary'),
    whichCommand: (p) => call('which_command', { payload: p }),
    resetEnvDefaults: (p) => call('reset_env_defaults', { payload: p }),
    listExecutables: (p) => call('list_executables', { payload: p })
  },

  on: (event, handler) => {
    if (!isTauri) return () => {}
    const { listen } = window.__TAURI_EVENT__ || {}
    if (!listen) return () => {}
    const un = listen(event, (e) => handler(e.payload))
    return () => un.then((f) => f()).catch(() => {})
  }
}

export default api
export { api }
