'use strict'
/**
 * 注册表模块 IPC —— 浏览 / 键值增删改 / 导入导出 / 搜索
 *
 * 浏览：reg:roots / reg:subKeys / reg:values / reg:readTree / reg:envPaths
 *       reg:isAdmin / reg:keyExists
 * 写入：reg:createKey / reg:setValue / reg:deleteValue / reg:deleteKey
 * 导入导出：reg:exportReg / reg:parseReg / reg:previewImport / reg:applyImport
 *           reg:pickRegFile / reg:pickSaveReg
 * 搜索：reg:search
 * 其他：reg:broadcast
 *
 * 说明：
 * - 所有读写一律走 lib/regsvc.js（已冻结），不自己拼 PowerShell。
 * - handler 直接 return 纯数据，外层 handle 统一包 { ok, data }。
 * - 出错抛 Error（中文），由外层转成 { ok:false, message }。
 */
const { dialog, BrowserWindow } = require('electron')
const regsvc = require('../lib/regsvc')
const store = require('../lib/store')

/** 对外暴露的四个根项（顺序与注册表编辑器一致，不含 HKCC） */
const ROOT_LIST = [
  { key: 'HKCR', label: 'HKEY_CLASSES_ROOT' },
  { key: 'HKCU', label: 'HKEY_CURRENT_USER' },
  { key: 'HKLM', label: 'HKEY_LOCAL_MACHINE' },
  { key: 'HKU', label: 'HKEY_USERS' }
]

/** 单参数调用兼容：payload 可能是字符串，也可能是 { path } */
function pickPath(payload) {
  return typeof payload === 'string' ? payload : (payload && payload.path) || ''
}

/**
 * 导入模式：显式传参优先，否则用设置页「导入 reg 默认模式」。
 * append = 仅新增（跳过冲突），merge = 合并覆盖
 */
function resolveImportMode(mode) {
  const m = String(mode || '').toLowerCase()
  if (m === 'append' || m === 'merge') return m
  try {
    const cfg = store.readConfig()
    return String(cfg.regImportMode || '') === 'append' ? 'append' : 'merge'
  } catch {
    return 'merge'
  }
}

/** 搜索是否默认包含二进制内容（设置页开关） */
function defaultIncludeBinary(explicit) {
  if (typeof explicit === 'boolean') return explicit
  try {
    return store.readConfig().regSearchBinary === true
  } catch {
    return false
  }
}

/** 恢复前的写操作自动备份开关（设置页 regAutoBackupBeforeWrite，默认开启） */
function autoBackupBeforeWrite() {
  try {
    return store.readConfig().regAutoBackupBeforeWrite !== false
  } catch {
    return true
  }
}

/** 解析路径，失败直接抛中文错误 */
function parseOrThrow(raw) {
  const p = regsvc.parsePath(raw)
  if (!p.ok) throw new Error(p.message || '注册表路径不合法')
  return p
}

/**
 * 写入前权限预检：目标分支需要管理员但当前不是管理员时，给出明确中文提示。
 * @param {string} rawPath
 * @returns {Promise<{parsed: object, admin: boolean}>}
 */
async function guardWrite(rawPath) {
  const parsed = parseOrThrow(rawPath)
  const admin = await regsvc.isAdmin(false)
  if (regsvc.needsAdmin(parsed.full) && !admin) {
    throw new Error('当前分支需要管理员权限才能修改，请以管理员身份重新启动本程序')
  }
  return { parsed, admin }
}

/** 导入预览行统计 */
function summarize(rows) {
  const summary = { new: 0, conflict: 0, skip: 0 }
  for (const row of rows || []) {
    if (row && row.status === 'new') summary.new++
    else if (row && row.status === 'conflict') summary.conflict++
    else summary.skip++
  }
  return summary
}

/** 取父窗口；没有聚焦窗口时退化为无父窗口对话框 */
function focusedWindow() {
  try {
    return BrowserWindow.getFocusedWindow() || undefined
  } catch {
    return undefined
  }
}

/**
 * 写操作前的自动保底备份（受设置页 regAutoBackupBeforeWrite 控制，默认开启）。
 * 备份失败不阻断写入，但会写日志，避免让用户误以为已备份。
 * @param {string} fullPath 目标注册表项
 * @param {string} label 备份名称前缀
 */
async function autoBackup(fullPath, label) {
  if (!autoBackupBeforeWrite()) return null
  try {
    // 延迟 require，避免与 reg-backup 形成循环依赖
    const backupMod = require('./reg-backup')
    const creator = backupMod.createBackupForPath
    if (typeof creator !== 'function') return null
    const res = await creator({
      path: fullPath,
      name: `${label} ${new Date().toLocaleString('zh-CN')}`,
      note: '写操作前自动创建',
      tags: ['auto']
    })
    return res
  } catch (err) {
    try {
      store.writeLog('warn', '注册表写操作前的自动备份失败', { path: fullPath, message: err && err.message })
    } catch { /* ignore */ }
    return null
  }
}

function register(handle) {  /* ============================ 浏览 ============================ */

  /* 1. 根项列表 */
  handle('reg:roots', async () => {
    const admin = await regsvc.isAdmin(false)
    return ROOT_LIST.map((item) => ({
      key: item.key,
      label: item.label,
      writable: regsvc.writable(item.key, admin)
    }))
  })

  /* 2. 子项列表（附带是否环境变量分支） */
  handle('reg:subKeys', async (event, payload) => {
    const p = parseOrThrow(pickPath(payload))
    const children = await regsvc.listSubKeys(p.full)
    return children.map((item) => ({ ...item, isEnv: regsvc.isEnvPath(item.fullPath) }))
  })

  /* 3. 键值列表（附带权限与环境变量标记） */
  handle('reg:values', async (event, payload) => {
    const p = parseOrThrow(pickPath(payload))
    const admin = await regsvc.isAdmin(false)
    const values = await regsvc.listValues(p.full)
    const needsAdmin = regsvc.needsAdmin(p.full)
    return {
      path: p.full,
      values,
      admin,
      writable: regsvc.writable(p.root, admin),
      needsAdmin,
      isEnv: regsvc.isEnvPath(p.full)
    }
  })

  /* 4. 递归读取分支 */
  handle('reg:readTree', async (event, payload) => {
    const { path: rawPath, maxKeys, maxDepth } = payload || {}
    const p = parseOrThrow(rawPath)
    const options = {}
    if (Number(maxKeys) > 0) options.maxKeys = Number(maxKeys)
    if (Number(maxDepth) > 0) options.maxDepth = Number(maxDepth)
    return regsvc.readTree(p.full, options)
  })

  /* 5. 环境变量两个分支 */
  handle('reg:envPaths', async () => {
    return { ...regsvc.envPaths(), machineRequiresAdmin: true }
  })

  /* 6. 管理员状态（payload=true 或 { force:true } 强制刷新缓存） */
  handle('reg:isAdmin', async (event, payload) => {
    const force = payload === true || !!(payload && payload.force)
    const admin = await regsvc.isAdmin(force)
    return { admin }
  })

  /* 7. 项是否存在 */
  handle('reg:keyExists', async (event, payload) => {
    const p = parseOrThrow(pickPath(payload))
    const exists = await regsvc.keyExists(p.full)
    return { exists }
  })

  /* ============================ 写入 ============================ */

  /* 8. 新建项（可带初始键值） */
  handle('reg:createKey', async (event, payload) => {
    const { parentPath, keyName, values } = payload || {}
    const parent = parseOrThrow(parentPath)
    const nameCheck = regsvc.validateKeyName(keyName)
    if (!nameCheck.ok) throw new Error(nameCheck.message)
    await guardWrite(parent.full)
    const initial = Array.isArray(values) ? values : []
    const res = await regsvc.createKey(parent.full, nameCheck.value, initial)
    return { path: res.path }
  })

  /* 9. 写入 / 覆盖键值 */
  handle('reg:setValue', async (event, payload) => {
    const { path: rawPath, name, type, value } = payload || {}
    const { parsed } = await guardWrite(rawPath)
    const valueName = name == null ? '' : String(name)
    const backup = await autoBackup(parsed.full, '写前自动备份')
    await regsvc.setValue(parsed.full, valueName, type || 'REG_SZ', value == null ? '' : value)
    // 记账：监控靠它把这次变更标为「本软件」，否则会被当成外部改动
    try { require('./reg-backup').markSelfWrite(parsed.full, valueName, value == null ? '' : value) } catch { /* ignore */ }
    return { ok: true, backupId: backup ? backup.id : '' }
  })

  /* 10. 删除键值（name 传空字符串表示默认键值） */
  handle('reg:deleteValue', async (event, payload) => {
    const { path: rawPath, name } = payload || {}
    if (name === undefined || name === null) throw new Error('请指定要删除的键值名称（默认键值请传空字符串）')
    const { parsed } = await guardWrite(rawPath)
    const backup = await autoBackup(parsed.full, '删除前自动备份')
    await regsvc.deleteValue(parsed.full, String(name))
    try { require('./reg-backup').markSelfWrite(parsed.full, String(name), '') } catch { /* ignore */ }
    return { ok: true, backupId: backup ? backup.id : '' }
  })

  /* 11. 删除项（非递归且非空时给出中文提示） */
  handle('reg:deleteKey', async (event, payload) => {
    const { path: rawPath, recursive } = payload || {}
    const parsed = parseOrThrow(rawPath)
    if (!parsed.sub) throw new Error('不允许删除注册表根项')
    await guardWrite(parsed.full)

    const isRecursive = !!recursive
    if (!isRecursive) {
      const [subs, vals] = await Promise.all([
        regsvc.listSubKeys(parsed.full).catch(() => []),
        regsvc.listValues(parsed.full).catch(() => [])
      ])
      if (subs.length > 0 || vals.length > 0) {
        throw new Error(
          `该项下还有 ${subs.length} 个子项、${vals.length} 个键值，` +
          '需先勾选「递归删除」后再执行删除'
        )
      }
    }
    const res = await regsvc.deleteKey(parsed.full, { recursive: isRecursive })
    return { ok: true, subKeys: res.subKeys, values: res.values }
  })

  /* ========================== 导入导出 ========================== */

  /* 12. 导出分支为 .reg */
  handle('reg:exportReg', async (event, payload) => {
    const { path: rawPath, file, encoding, maxKeys } = payload || {}
    const p = parseOrThrow(rawPath)
    const target = String(file || '').trim()
    if (!target) throw new Error('导出文件路径不能为空')
    const limit = Number(maxKeys) > 0 ? Number(maxKeys) : 200000
    const tree = await regsvc.readTree(p.full, { maxKeys: limit })
    const res = await regsvc.exportReg(tree.nodes, target, {
      encoding: encoding === 'ansi' ? 'ansi' : 'utf8'
    })
    return { file: res.file, bytes: res.bytes, keys: res.keys, truncated: tree.truncated }
  })

  /* 13. 解析 .reg 并生成完整预览 */
  handle('reg:parseReg', async (event, payload) => {
    const { file, mode } = payload || {}
    const target = String(file || '').trim()
    if (!target) throw new Error('请先选择要导入的 .reg 文件')
    const parsed = await regsvc.parseRegFile(target)
    const rows = await regsvc.previewRegImport(parsed.nodes, resolveImportMode(mode))
    return {
      nodes: parsed.nodes,
      encoding: parsed.encoding,
      issues: parsed.issues,
      rows,
      summary: summarize(rows),
      mode: resolveImportMode(mode)
    }
  })

  /* 14. 仅生成导入预览 */
  handle('reg:previewImport', async (event, payload) => {
    const { file, mode } = payload || {}
    const target = String(file || '').trim()
    if (!target) throw new Error('请先选择要导入的 .reg 文件')
    const parsed = await regsvc.parseRegFile(target)
    const rows = await regsvc.previewRegImport(parsed.nodes, resolveImportMode(mode))
    return { rows, summary: summarize(rows), issues: parsed.issues, mode: resolveImportMode(mode) }
  })

  /* 15. 执行导入（走事务回滚） */
  handle('reg:applyImport', async (event, payload) => {
    const { rows } = payload || {}
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('没有可导入的条目')
    const clean = rows.filter((row) => row && row.path)
    if (clean.length === 0) throw new Error('导入条目缺少注册表路径')
    const res = await regsvc.applyRegImport(clean)
    return { applied: res.applied }
  })

  /* 16. 选择 .reg 文件 */
  handle('reg:pickRegFile', async () => {
    const win = focusedWindow()
    const options = {
      title: '选择注册表文件',
      filters: [{ name: '注册表文件', extensions: ['reg'] }],
      properties: ['openFile']
    }
    const res = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (res.canceled || !res.filePaths || res.filePaths.length === 0) return { file: '' }
    return { file: res.filePaths[0] }
  })

  /* 17. 选择 .reg 保存位置 */
  handle('reg:pickSaveReg', async (event, payload) => {
    const { defaultName } = payload || {}
    const win = focusedWindow()
    const options = {
      title: '导出注册表文件',
      defaultPath: String(defaultName || 'registry-export.reg'),
      filters: [{ name: '注册表文件', extensions: ['reg'] }]
    }
    const res = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options)
    if (res.canceled || !res.filePath) return { file: '' }
    return { file: res.filePath }
  })

  /* ============================ 搜索 ============================ */

  /* 18. 递归搜索键名 / 键值 */
  handle('reg:search', async (event, payload) => {
    const { path: rawPath, keyword, scope, includeBinary, maxResults, caseSensitive } = payload || {}
    const kw = String(keyword == null ? '' : keyword)
    if (!kw.trim()) throw new Error('搜索关键词不能为空')
    const p = parseOrThrow(rawPath)
    const options = {
      scope: scope === 'name' || scope === 'value' ? scope : 'both',
      // 未显式指定时读设置页「搜索是否检索二进制数据」，默认关闭（耗时）
      includeBinary: defaultIncludeBinary(includeBinary),
      maxResults: Number(maxResults) > 0 ? Number(maxResults) : 2000,
      caseSensitive: !!caseSensitive
    }
    return regsvc.search(p.full, kw, options)
  })

  /* ============================ 其他 ============================ */

  /* 19. 广播注册表变更（通知系统刷新环境变量） */
  handle('reg:broadcast', async () => {
    const ok = await regsvc.broadcastRegistryChange()
    return { ok: !!ok }
  })
}

module.exports = { register }
