'use strict'
/**
 * 注册表模块 · 扩展能力（后端C）
 *
 * 通道（与 electron/preload.js 白名单严格一致）：
 *   批量查找替换：regReplace:scan / apply
 *   注册表收藏夹：regFav:list / create / update / remove / groups / exportJson / importJson
 *   全配置打包：  configPack:exportPack / inspectPack / importPack / pickSave / pickOpen
 *   环境健康诊断：health:scan / previewFix / applyFix / exportReport / lastScore
 *   定时任务：    schedule:list / create / update / remove / runNow / setEnabled / preview
 *
 * 约定：
 * - 注册表读写一律走 lib/regsvc（已冻结），本文件不自己写 PowerShell。
 * - handler 直接 return 纯数据；{ ok, data } 由 ipc/index.js 的 handle 统一包装。
 * - 出错 throw new Error('中文说明')。
 * - 数据目录：<appData>/registryBackup、<appData>/configPack、<appData>/health。
 */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFile } = require('node:child_process')
const { dialog, BrowserWindow, app } = require('electron')
const regsvc = require('../lib/regsvc')
const store = require('../lib/store')
const registry = require('../lib/registry')
const envset = require('../lib/envset')

/* ============================== 通用工具 ============================== */

function pad(n) {
  return String(n).padStart(2, '0')
}

/** 20261018-153000 形式的文件名时间戳 */
function fileStamp(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function tsText(ms) {
  const d = new Date(Number(ms) || Date.now())
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function normStr(v) {
  return v == null ? '' : String(v)
}

function normTags(tags) {
  if (!Array.isArray(tags)) return []
  return tags.map((t) => normStr(t).trim()).filter(Boolean)
}

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex')
}

/** 规范化 JSON：对象键排序、数组保序、无空白（与 snapshot-file.js 一致） */
function canonicalJson(value) {
  if (value === null) return 'null'
  const t = typeof value
  if (t === 'string' || t === 'boolean') return JSON.stringify(value)
  if (t === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null'
  if (t !== 'object') return 'null'
  if (Array.isArray(value)) {
    return '[' + value.map((item) => (item === undefined ? 'null' : canonicalJson(item))).join(',') + ']'
  }
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join('}') + '}'
}

function readJson(file) {
  try {
    if (!fs.existsSync(file)) return null
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function writeJson(file, data) {
  store.ensureDir(path.dirname(file))
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
  return file
}

/** 软件版本：打包后取 app.getVersion，开发态回落 package.json */
function appVersion() {
  try {
    const v = app.getVersion()
    if (v) return String(v)
  } catch { /* 非 Electron 环境 */ }
  try {
    const pkg = readJson(path.join(__dirname, '..', '..', 'package.json'))
    return pkg && pkg.version ? String(pkg.version) : ''
  } catch {
    return ''
  }
}

/** 主版本.次版本，用于配置包版本比较 */
function majorMinor(version) {
  const m = normStr(version).match(/(\d+)\.(\d+)/)
  return m ? [Number(m[1]), Number(m[2])] : null
}

function compareMajorMinor(a, b) {
  const x = majorMinor(a)
  const y = majorMinor(b)
  if (!x || !y) return 0
  if (x[0] !== y[0]) return x[0] > y[0] ? 1 : -1
  if (x[1] !== y[1]) return x[1] > y[1] ? 1 : -1
  return 0
}

/** 带超时的 Promise，超时返回 fallback 而不是失败 */
function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve(fallback)
    }, Math.max(1000, Number(ms) || 10000))
    Promise.resolve(promise)
      .then((v) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(v)
      })
      .catch(() => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(fallback)
      })
  })
}

function audit(category, action, detail) {
  try {
    store.appendAudit({ origin: 'GUI', category, action, ...detail })
  } catch { /* 审计失败不阻断主流程 */ }
}

function backupDir() {
  return store.ensureDir(path.join(store.appDataDir(), 'registryBackup'))
}

function configPackDir() {
  return store.ensureDir(path.join(store.appDataDir(), 'configPack'))
}

function healthDir() {
  return store.ensureDir(path.join(store.appDataDir(), 'health'))
}

function focusedWindow() {
  try {
    return BrowserWindow.getFocusedWindow() || null
  } catch {
    return null
  }
}

/* ======================================================================
 * A. 批量查找替换
 * ====================================================================== */

/** find 编译为正则：wildcard 只支持 *，wholeWord 用标识符边界，其余按字面量 */
function buildMatcher(find, opts = {}) {
  const raw = normStr(find)
  if (!raw) throw new Error('查找内容不能为空')
  const wildcard = !!opts.wildcard
  const wholeWord = !!opts.wholeWord
  const caseSensitive = !!opts.caseSensitive
  const replacement = normStr(opts.replace)

  // 转义正则元字符，wildcard 时把 * 保留出来换成 .*
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let body = wildcard
    ? raw.split('*').map((part) => escapeRe(part)).join('.*')
    : escapeRe(raw)
  if (wholeWord && !wildcard) {
    body = `(?<![A-Za-z0-9_])${body}(?![A-Za-z0-9_])`
  }
  let re
  try {
    re = new RegExp(body, caseSensitive ? 'g' : 'gi')
  } catch (err) {
    throw new Error(`查找规则不合法：${err.message}`)
  }
  return {
    test(text) {
      re.lastIndex = 0
      return re.test(normStr(text))
    },
    replace(text) {
      re.lastIndex = 0
      return normStr(text).replace(re, () => replacement)
    }
  }
}

/** 只处理字符串类型 */
function isStringType(type) {
  return type === 'REG_SZ' || type === 'REG_EXPAND_SZ'
}

/**
 * readTree 返回的 node.path 是相对根项的路径（如 "Environment"、"SOFTWARE\Foo"），
 * 但子项的 PSPath 在部分机器上会带上 "Microsoft.PowerShell.Core\Registry::HKEY_CURRENT_USER"
 * 前缀，导致相对路径里混入提供程序名。这里统一清洗后补回根项短名，
 * 保证返回的路径可以直接传给 setValue / deleteValue。
 */
function fullNodePath(root, relative) {
  let rel = normStr(relative)
  // 去掉 PowerShell 提供程序前缀
  rel = rel.replace(/^.*?Registry::/i, '')
  const abs = regsvc.parsePath(rel)
  if (abs.ok && abs.sub) return abs.full
  if (abs.ok && !abs.sub) return abs.full === root ? root : abs.full
  rel = rel.replace(/^\\+/, '')
  if (!rel) return root
  // 若残留根项短名（HKCU 等）在开头，避免重复拼接
  if (new RegExp(`^${root}\\\\`, 'i').test(rel)) return rel
  return `${root}\\${rel}`
}

async function replaceScan(payload) {
  const {
    path: rawPath, find, replace, scope, caseSensitive, wholeWord, wildcard, includeBinary
  } = payload || {}
  void includeBinary
  const p = regsvc.parsePath(rawPath)
  if (!p.ok) throw new Error(p.message || '注册表路径不合法')
  const matcher = buildMatcher(find, { replace, caseSensitive, wholeWord, wildcard })
  const mode = scope === 'name' || scope === 'value' ? scope : 'both'

  const tree = await regsvc.readTree(p.full, { maxKeys: 60000 })
  const rows = []
  let scanned = 0
  for (const node of tree.nodes || []) {
    const nodePath = fullNodePath(p.root, node.path)
    for (const v of node.values || []) {
      if (!isStringType(v.type)) continue
      scanned += 1
      const nameHit = mode !== 'value' && !!v.name && matcher.test(v.name)
      const valueHit = mode !== 'name' && matcher.test(v.value)
      if (!nameHit && !valueHit) continue
      const afterName = nameHit ? matcher.replace(v.name) : v.name
      const afterValue = valueHit ? matcher.replace(v.value) : v.value
      rows.push({
        path: nodePath,
        name: afterName,
        oldName: v.name,
        type: v.type,
        before: v.value,
        after: afterValue,
        renamed: nameHit,
        nameChanged: nameHit && afterName !== v.name,
        valueChanged: valueHit && afterValue !== v.value,
        willChange: (nameHit && afterName !== v.name) || (valueHit && afterValue !== v.value)
      })
    }
  }
  const matched = rows.length
  const changed = rows.filter((r) => r.willChange).length
  return { rows, scanned, matched, changed, truncated: !!tree.truncated }
}

/** 备份被修改路径的节点（简化为逐路径 listValues） */
async function backupReplaceNodes(paths, extra) {
  const nodes = []
  const failed = []
  for (const p of paths) {
    try {
      const values = await regsvc.listValues(p, { timeout: 30000 })
      nodes.push({ path: p, values })
    } catch (err) {
      failed.push({ path: p, message: err.message })
    }
  }
  const d = new Date()
  const file = path.join(backupDir(), `ReplaceBackup-${fileStamp(d)}.json`)
  const body = {
    kind: 'registry-replace-backup',
    createdAt: d.getTime(),
    createdAtText: tsText(d.getTime()),
    find: extra.find,
    replace: extra.replace,
    nodes,
    failed
  }
  writeJson(file, body)
  return { file, nodes: nodes.length }
}

async function replaceApply(payload) {
  const { rows, find, replace } = payload || {}
  const list = Array.isArray(rows) ? rows.filter((r) => r && r.path && r.willChange !== false) : []
  if (!list.length) throw new Error('没有可应用的替换行')
  const findText = normStr(find)

  const uniqPaths = [...new Set(list.map((r) => normStr(r.path)))]
  const backup = await backupReplaceNodes(uniqPaths, { find: findText, replace: normStr(replace) })

  const applied = []
  const skipped = []
  for (const row of list) {
    const p = regsvc.parsePath(row.path)
    if (!p.ok) {
      skipped.push({ path: normStr(row.path), name: normStr(row.name), message: p.message })
      continue
    }
    if (row.type && !isStringType(row.type)) {
      skipped.push({ path: p.full, name: normStr(row.name), message: `不支持的键值类型：${row.type}，只处理 REG_SZ / REG_EXPAND_SZ` })
      continue
    }
    const oldName = row.oldName === undefined ? row.name : row.oldName
    const type = isStringType(row.type) ? row.type : 'REG_SZ'
    try {
      if (row.renamed && normStr(row.name) !== normStr(oldName)) {
        // 先写新名再删旧名，避免中途失败丢数据
        await regsvc.setValue(p.full, row.name, type, row.after)
        await regsvc.deleteValue(p.full, oldName)
      } else if (row.valueChanged !== false && normStr(row.after) !== normStr(row.before)) {
        await regsvc.setValue(p.full, oldName, type, row.after)
      } else {
        skipped.push({ path: p.full, name: normStr(oldName), message: '替换后内容未变化，已跳过' })
        continue
      }
      applied.push({ path: p.full, name: normStr(row.name), oldName: normStr(oldName) })
    } catch (err) {
      skipped.push({ path: p.full, name: normStr(oldName), message: err.message })
    }
  }

  if (applied.length) {
    try { await regsvc.broadcastRegistryChange() } catch { /* 广播失败不影响结果 */ }
  }
  audit('registry', 'registryBatchReplace', {
    find: findText,
    replace: normStr(replace),
    count: applied.length,
    skipped: skipped.length,
    backup: backup.file,
    paths: uniqPaths.slice(0, 50)
  })
  return { applied: applied.length, skipped, backupFile: backup.file }
}

/* ======================================================================
 * B. 注册表收藏夹
 * ====================================================================== */

const FAV_BUILTIN_ITEM_IDS = ['fav-sys-user', 'fav-sys-machine']
const FAV_BUILTIN_GROUP_ID = 'sys'

function favFile() {
  return path.join(store.appDataDir(), 'registryFavorites.json')
}

function favDefaults() {
  return {
    groups: [{ id: FAV_BUILTIN_GROUP_ID, name: '系统预设', builtin: true }],
    items: [
      {
        id: 'fav-sys-user',
        name: '用户环境变量',
        path: 'HKCU\\Environment',
        groupId: FAV_BUILTIN_GROUP_ID,
        note: '当前用户的环境变量分支',
        hidden: false,
        builtin: true
      },
      {
        id: 'fav-sys-machine',
        name: '系统环境变量',
        path: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
        groupId: FAV_BUILTIN_GROUP_ID,
        note: '全机器生效的环境变量分支',
        hidden: false,
        builtin: true
      }
    ]
  }
}

/** 读取收藏夹；首次访问（或无文件）时写入系统预设 */
function favLoad() {
  const file = favFile()
  const raw = readJson(file)
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.groups) || !Array.isArray(raw.items)) {
    const def = favDefaults()
    writeJson(file, def)
    return def
  }
  const data = { groups: raw.groups, items: raw.items }
  // 补齐可能被手动删除的内置项（不可删、可隐藏）
  const def = favDefaults()
  let dirty = false
  for (const g of def.groups) {
    if (!data.groups.some((x) => x.id === g.id)) { data.groups.push(g); dirty = true }
  }
  for (const it of def.items) {
    if (!data.items.some((x) => x.id === it.id)) { data.items.push(it); dirty = true }
  }
  if (dirty) writeJson(file, data)
  return data
}

function favSave(data) {
  writeJson(favFile(), { groups: data.groups, items: data.items })
  return data
}

function normalizeFavItem(item) {
  return {
    id: normStr(item.id) || uid('fav'),
    name: normStr(item.name) || '未命名收藏',
    path: normStr(item.path),
    groupId: normStr(item.groupId),
    note: normStr(item.note),
    hidden: !!item.hidden,
    builtin: !!item.builtin
  }
}

async function favExportJson(payload) {
  const { file } = payload || {}
  const data = favLoad()
  let target = normStr(file)
  if (!target) {
    const win = focusedWindow()
    const options = {
      title: '导出注册表收藏夹',
      defaultPath: `registry-favorites-${fileStamp()}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (res.canceled || !res.filePath) return { file: '' }
    target = res.filePath
  }
  const body = {
    kind: 'win-env-manager-registry-favorites',
    version: 1,
    exportedAt: new Date().toISOString(),
    appVersion: appVersion(),
    groups: data.groups,
    items: data.items
  }
  writeJson(target, body)
  audit('registry', 'registryFavorite', { action: 'export', file: target, items: data.items.length })
  return { file: target, items: data.items.length, groups: data.groups.length }
}

function favImportJson(payload) {
  const { file, mode } = payload || {}
  const target = normStr(file)
  if (!target) throw new Error('请选择要导入的收藏夹文件')
  if (!fs.existsSync(target)) throw new Error('收藏夹文件不存在')
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(target, 'utf8'))
  } catch (err) {
    throw new Error(`收藏夹文件解析失败：${err.message}`)
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) {
    throw new Error('收藏夹文件格式不正确（缺少 items 数组）')
  }
  const incomingGroups = Array.isArray(raw.groups) ? raw.groups : []
  const data = favLoad()
  const replace = mode === 'replace'

  let added = 0
  let updated = 0
  let skipped = 0

  const keepBuiltinGroups = data.groups.filter((g) => g.builtin)
  const keepBuiltinItems = data.items.filter((i) => i.builtin)
  if (replace) {
    data.groups = [...keepBuiltinGroups]
    data.items = [...keepBuiltinItems]
  }

  for (const g of incomingGroups) {
    const id = normStr(g && g.id)
    const name = normStr(g && g.name).trim()
    if (!id || !name) { skipped += 1; continue }
    const hit = data.groups.find((x) => x.id === id)
    if (hit) {
      if (!hit.builtin) { hit.name = name; updated += 1 } else skipped += 1
    } else {
      data.groups.push({ id, name, builtin: false })
      added += 1
    }
  }
  // 未分组 / 引用缺失分组的收藏统一落到空 groupId，避免脏引用
  const groupIds = new Set(data.groups.map((g) => g.id))

  for (const item of raw.items) {
    const p = regsvc.parsePath(item && item.path)
    if (!p.ok) { skipped += 1; continue }
    const norm = normalizeFavItem(item)
    if (!groupIds.has(norm.groupId)) norm.groupId = ''
    const byId = data.items.find((x) => x.id === norm.id)
    const byPath = data.items.find((x) => normStr(x.path).toLowerCase() === norm.path.toLowerCase())
    if (byId || byPath) {
      const hit = byId || byPath
      if (hit.builtin) { skipped += 1; continue }
      hit.name = norm.name
      hit.path = norm.path
      hit.groupId = norm.groupId
      hit.note = norm.note
      hit.hidden = norm.hidden
      updated += 1
      continue
    }
    data.items.push({ ...norm, id: uid('fav'), builtin: false })
    added += 1
  }

  favSave(data)
  audit('registry', 'registryFavorite', { action: 'import', file: target, mode: replace ? 'replace' : 'merge', added, updated, skipped })
  return { added, updated, skipped, groups: data.groups.length, items: data.items.length }
}

/* ======================================================================
 * C. 全软件配置打包（*.wemcfg 单文件）
 * ====================================================================== */

const PACK_MAGIC = 'WEMCFG1'
const PACK_VERSION = 1

/**
 * 模块清单。路径均为探查确认过的真实存储位置：
 * - 程序设置        <appData>/config.json                (lib/store.js)
 * - 表格视图/条件格式 <appData>/config/table_layout.json   (ipc/tableprefs.js)
 * - 识别规则库      <appData>/scan-rules.json             (lib/rules.js)
 * - 配置集/互斥组    <appData>/configsets.json             (lib/envset.js)
 * - 项目环境        <appData>/config/projects.json         (ipc/projectenv.js)
 * - 注册表收藏夹    <appData>/registryFavorites.json      (本文件)
 * - 导入映射规则    无持久化文件（前端向导弹窗内固定映射）
 * - 搜索历史        仅渲染进程 localStorage，主进程读不到
 */
function packModules() {
  const appData = store.appDataDir()
  return [
    {
      key: 'config',
      name: '程序设置',
      file: path.join(appData, 'config.json'),
      note: '不含 draftCache 草稿缓存'
    },
    {
      key: 'tableLayout',
      name: '表格视图预设与条件格式',
      file: path.join(appData, 'config', 'table_layout.json')
    },
    {
      key: 'scanRules',
      name: '软件识别规则库（自定义规则）',
      file: path.join(appData, 'scan-rules.json')
    },
    {
      key: 'envsets',
      name: '配置集与互斥组',
      file: path.join(appData, 'configsets.json')
    },
    {
      key: 'projects',
      name: '项目环境与模板',
      file: path.join(appData, 'config', 'projects.json')
    },
    {
      key: 'registryFavorites',
      name: '注册表收藏夹',
      file: path.join(appData, 'registryFavorites.json')
    },
    {
      key: 'importMapping',
      name: '导入映射规则',
      file: '',
      available: false,
      reason: '导入向导弹窗里的字段映射是固定规则（Key→变量名、Value→变量值），没有持久化文件'
    },
    {
      key: 'searchHistory',
      name: '搜索历史',
      file: '',
      available: false,
      reason: '搜索历史保存在渲染进程 localStorage（wem-search-history），主进程无法读取'
    }
  ]
}

function countOf(data) {
  if (data == null) return 0
  if (Array.isArray(data)) return data.length
  if (typeof data === 'object') return Object.keys(data).length
  if (typeof data === 'string') return data.length
  return 1
}

function normalizeModuleKey(key) {
  return normStr(key).trim()
}

/** 采集各模块数据；缺文件的标 available:false 并带原因 */
function collectModules(onlyKeys) {
  const wanted = Array.isArray(onlyKeys) && onlyKeys.length
    ? new Set(onlyKeys.map(normalizeModuleKey).filter(Boolean))
    : null
  const modules = {}
  const meta = []
  for (const def of packModules()) {
    if (wanted && !wanted.has(def.key)) continue
    if (def.available === false) {
      modules[def.key] = null
      meta.push({ key: def.key, name: def.name, available: false, count: 0, reason: def.reason })
      continue
    }
    let data = null
    let reason = ''
    try {
      if (def.key === 'config') {
        const cfg = { ...store.readConfig() }
        delete cfg.draftCache
        data = cfg
      } else if (def.key === 'registryFavorites') {
        data = favLoad()
      } else if (fs.existsSync(def.file)) {
        data = JSON.parse(fs.readFileSync(def.file, 'utf8'))
      } else {
        reason = '本机没有该配置文件（可能尚未使用过相关功能）'
      }
    } catch (err) {
      data = null
      reason = `读取失败：${err.message}`
    }
    if (data == null) {
      modules[def.key] = null
      meta.push({ key: def.key, name: def.name, available: false, count: 0, reason: reason || '无数据' })
    } else {
      modules[def.key] = data
      meta.push({ key: def.key, name: def.name, available: true, count: countOf(data) })
    }
  }
  return { modules, meta }
}

function packDoc(modules, meta, extra) {
  const manifest = {
    format: 'wemcfg',
    version: PACK_VERSION,
    appVersion: appVersion(),
    createdAt: new Date().toISOString(),
    note: normStr(extra && extra.note),
    tags: normTags(extra && extra.tags),
    modules: meta
  }
  const doc = { manifest, modules }
  manifest.sha256 = packHash(doc)
  return doc
}

/** 去掉 manifest.sha256 后的规范化 JSON 哈希 */
function packHash(doc) {
  const clone = {
    manifest: { ...(doc.manifest || {}) },
    modules: doc.modules || {}
  }
  delete clone.manifest.sha256
  return sha256Hex(canonicalJson(clone))
}

function encryptBody(text, password) {
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const key = crypto.scryptSync(normStr(password), salt, 32)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  return {
    algo: 'aes-256-gcm',
    kdf: 'scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: enc.toString('base64')
  }
}

function decryptBody(box, password) {
  try {
    const salt = Buffer.from(normStr(box.salt), 'base64')
    const iv = Buffer.from(normStr(box.iv), 'base64')
    const tag = Buffer.from(normStr(box.tag), 'base64')
    const data = Buffer.from(normStr(box.data), 'base64')
    const key = crypto.scryptSync(normStr(password), salt, 32)
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('配置包解密失败：密码不正确，或文件已损坏')
  }
}

function writePackFile(file, doc, password) {
  const text = JSON.stringify(doc, null, 2)
  const encrypted = normStr(password) !== ''
  const header = `${PACK_MAGIC} ${encrypted ? 'ENC' : 'PLAIN'}\n`
  const payload = encrypted ? JSON.stringify(encryptBody(text, password)) : text
  store.ensureDir(path.dirname(file))
  fs.writeFileSync(file, header + payload, 'utf8')
  return file
}

/** 解析并校验配置包，返回 { manifest, modules } */
function readPackFile(file, password) {
  const target = normStr(file)
  if (!target) throw new Error('请选择配置文件包')
  if (!fs.existsSync(target)) throw new Error('配置文件包不存在')
  const raw = fs.readFileSync(target, 'utf8')
  const idx = raw.indexOf('\n')
  if (idx < 0) throw new Error('配置文件包格式不正确（缺少文件头）')
  const header = raw.slice(0, idx).trim()
  const parts = header.split(/\s+/)
  if (parts[0] !== PACK_MAGIC) throw new Error('不是有效的 WinEnv 配置文件包（魔数不匹配）')
  const encrypted = parts[1] === 'ENC'
  const payload = raw.slice(idx + 1)

  let text = payload
  if (encrypted) {
    if (!normStr(password)) throw new Error('该配置包已加密，请输入密码')
    let box
    try { box = JSON.parse(payload) } catch { throw new Error('加密配置包结构损坏') }
    text = decryptBody(box, password)
  }
  let doc
  try { doc = JSON.parse(text) } catch (err) { throw new Error(`配置包内容解析失败：${err.message}`) }
  if (!doc || typeof doc !== 'object' || !doc.manifest || typeof doc.modules !== 'object') {
    throw new Error('配置包缺少 manifest 或 modules')
  }
  if (doc.manifest.format && doc.manifest.format !== 'wemcfg') throw new Error('配置包格式标识不正确')
  const expect = normStr(doc.manifest.sha256)
  if (!expect) throw new Error('配置包缺少校验和')
  const actual = packHash(doc)
  if (actual !== expect) throw new Error('配置包校验失败，文件可能已损坏或被修改')
  return { manifest: doc.manifest, modules: doc.modules || {}, encrypted }
}

async function configPackExport(payload) {
  const { modules: picked, note, tags, file, password } = payload || {}
  const { modules, meta } = collectModules(picked)
  const usable = meta.filter((m) => m.available).length
  if (!usable) throw new Error('所选模块都没有可导出的数据')
  const doc = packDoc(modules, meta, { note, tags })

  let target = normStr(file).trim()
  if (!target) {
    const win = focusedWindow()
    const options = {
      title: '导出全软件配置包',
      defaultPath: `WinEnvConfig-${fileStamp()}.wemcfg`,
      filters: [{ name: 'WinEnv 配置包', extensions: ['wemcfg'] }]
    }
    const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (res.canceled || !res.filePath) return { file: '' }
    target = res.filePath
  }
  if (!/\.wemcfg$/i.test(target)) target = `${target}.wemcfg`
  writePackFile(target, doc, password)

  audit('config', 'configPackExport', {
    file: target,
    modules: meta.filter((m) => m.available).map((m) => m.key),
    skipped: meta.filter((m) => !m.available).map((m) => m.key),
    encrypted: normStr(password) !== '',
    sha256: doc.manifest.sha256
  })
  return {
    file: target,
    encrypted: normStr(password) !== '',
    bytes: fs.statSync(target).size,
    manifest: doc.manifest
  }
}

async function configPackInspect(payload) {
  const { file, password } = payload || {}
  const { manifest, modules, encrypted } = readPackFile(file, password)
  const current = appVersion()
  const cmp = compareMajorMinor(manifest.appVersion, current)
  const versionWarning = cmp > 0
    ? `该配置包由更高版本（v${manifest.appVersion}）创建，当前版本 v${current} 可能无法完整识别其中的新字段，导入前建议先升级软件`
    : ''
  return {
    manifest,
    modules,
    encrypted,
    currentVersion: current,
    versionWarning,
    compatible: cmp <= 0
  }
}

function mergeById(current, incoming, keyField = 'id') {
  const list = Array.isArray(current) ? [...current] : []
  let added = 0
  let updated = 0
  for (const item of Array.isArray(incoming) ? incoming : []) {
    if (!item || typeof item !== 'object') continue
    const id = normStr(item[keyField])
    const idx = id ? list.findIndex((x) => normStr(x[keyField]) === id) : -1
    if (idx >= 0) { list[idx] = { ...list[idx], ...item }; updated += 1 } else { list.push(item); added += 1 }
  }
  return { list, added, updated }
}

/** 把单个模块写回真实存储位置，返回 { key, ok, message } */
function applyModule(key, data, mode) {
  const appData = store.appDataDir()
  const overwrite = mode === 'overwrite'
  if (data == null) return { key, ok: false, message: '配置包中该模块没有数据' }

  if (key === 'config') {
    const allowed = new Set(Object.keys(store.DEFAULT_CONFIG || {}))
    const patch = {}
    for (const [k, v] of Object.entries(data)) {
      if (allowed.size && !allowed.has(k)) continue
      if (k === 'draftCache') continue
      patch[k] = v
    }
    store.writeConfig(patch)
    return { key, ok: true, count: Object.keys(patch).length }
  }

  if (key === 'tableLayout') {
    const body = {
      tables: (data && data.tables) || {},
      formats: (data && data.formats) || {},
      presets: (data && data.presets) || {},
      settings: (data && data.settings) || {}
    }
    writeJson(path.join(appData, 'config', 'table_layout.json'), body)
    return { key, ok: true, count: countOf(body) }
  }

  if (key === 'scanRules') {
    const list = Array.isArray(data) ? data : (Array.isArray(data.ruleList) ? data.ruleList : null)
    if (!list) return { key, ok: false, message: '识别规则数据结构不正确（缺少 ruleList）' }
    const file = path.join(appData, 'scan-rules.json')
    if (overwrite) {
      writeJson(file, { ruleVersion: '1.0', ruleList: list })
      return { key, ok: true, count: list.length }
    }
    const current = readJson(file) || {}
    const curList = Array.isArray(current.ruleList) ? current.ruleList : []
    const { list: merged, added, updated } = mergeById(curList, list)
    writeJson(file, { ...current, ruleVersion: current.ruleVersion || '1.0', ruleList: merged })
    return { key, ok: true, count: merged.length, added, updated }
  }

  if (key === 'envsets') {
    const file = path.join(appData, 'configsets.json')
    const current = envset.load()
    if (overwrite) {
      const body = {
        version: Number(data.version) || 1,
        sets: Array.isArray(data.sets) ? data.sets : [],
        mutexGroups: Array.isArray(data.mutexGroups) ? data.mutexGroups : [],
        ignorePrompts: Array.isArray(data.ignorePrompts) ? data.ignorePrompts : []
      }
      writeJson(file, body)
      return { key, ok: true, count: body.sets.length }
    }
    const sets = mergeById(current.sets, data.sets)
    const mutex = mergeById(current.mutexGroups, data.mutexGroups)
    const body = {
      version: current.version || 1,
      sets: sets.list,
      mutexGroups: mutex.list,
      ignorePrompts: [...new Set([...(current.ignorePrompts || []), ...((data && data.ignorePrompts) || [])])]
    }
    writeJson(file, body)
    return { key, ok: true, count: body.sets.length, added: sets.added, updated: sets.updated }
  }

  if (key === 'projects') {
    const file = path.join(appData, 'config', 'projects.json')
    const incoming = Array.isArray(data) ? data : (Array.isArray(data.projects) ? data.projects : null)
    if (!incoming) return { key, ok: false, message: '项目数据结构不正确（应为数组）' }
    if (overwrite) {
      writeJson(file, incoming)
      return { key, ok: true, count: incoming.length }
    }
    const existing = readJson(file)
    const current = Array.isArray(existing) ? existing : []
    const { list, added, updated } = mergeById(current, incoming)
    writeJson(file, list)
    return { key, ok: true, count: list.length, added, updated }
  }

  if (key === 'registryFavorites') {
    const data2 = favLoad()
    const incomingGroups = Array.isArray(data.groups) ? data.groups : []
    const incomingItems = Array.isArray(data.items) ? data.items : []
    if (overwrite) {
      data2.groups = data2.groups.filter((g) => g.builtin)
      data2.items = data2.items.filter((i) => i.builtin)
    }
    const gm = mergeById(data2.groups, incomingGroups)
    const im = mergeById(data2.items, incomingItems)
    data2.groups = gm.list
    data2.items = im.list.map(normalizeFavItem)
    favSave(data2)
    return { key, ok: true, count: data2.items.length, added: im.added, updated: im.updated }
  }

  return { key, ok: false, message: '未知模块' }
}

async function configPackImport(payload) {
  const { file, password, modules: picked, mode } = payload || {}
  const { manifest, modules } = readPackFile(file, password)
  const importMode = mode === 'overwrite' ? 'overwrite' : (mode === 'selected' ? 'selected' : 'merge')
  const wanted = Array.isArray(picked) && picked.length
    ? picked.map(normalizeModuleKey).filter(Boolean)
    : Object.keys(modules).filter((k) => modules[k] != null)
  if (!wanted.length) throw new Error('没有选择要导入的模块')

  // 导入前自动备份当前全部配置
  let backupFile = ''
  try {
    const snapshot = collectModules()
    const doc = packDoc(snapshot.modules, snapshot.meta, {
      note: `导入前自动备份（来源：${path.basename(normStr(file))}）`
    })
    backupFile = path.join(configPackDir(), `PreImport-${fileStamp()}.wemcfg`)
    writePackFile(backupFile, doc, '')
  } catch (err) {
    throw new Error(`导入前备份当前配置失败，已中止导入：${err.message}`)
  }

  const imported = []
  const skipped = []
  for (const key of wanted) {
    if (modules[key] == null) {
      skipped.push({ key, reason: '配置包中该模块没有数据' })
      continue
    }
    try {
      const res = applyModule(key, modules[key], importMode)
      if (res.ok) imported.push({ key, count: res.count, added: res.added, updated: res.updated })
      else skipped.push({ key, reason: res.message })
    } catch (err) {
      skipped.push({ key, reason: err.message })
    }
  }

  audit('config', 'configPackImport', {
    file: normStr(file),
    mode: importMode,
    packVersion: manifest.appVersion,
    imported: imported.map((i) => i.key),
    skipped: skipped.map((s) => s.key),
    backup: backupFile
  })
  return { imported, skipped, backupFile, restartRequired: true }
}

async function configPackPickSave() {
  const win = focusedWindow()
  const options = {
    title: '选择配置包保存位置',
    defaultPath: `WinEnvConfig-${fileStamp()}.wemcfg`,
    filters: [{ name: 'WinEnv 配置包', extensions: ['wemcfg'] }]
  }
  const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (res.canceled || !res.filePath) return { file: '' }
  return { file: res.filePath }
}

async function configPackPickOpen() {
  const win = focusedWindow()
  const options = {
    title: '选择配置文件包',
    properties: ['openFile'],
    filters: [{ name: 'WinEnv 配置包', extensions: ['wemcfg'] }]
  }
  const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (res.canceled || !res.filePaths || !res.filePaths.length) return { file: '' }
  return { file: res.filePaths[0] }
}

/* ======================================================================
 * D. 环境健康诊断
 * ====================================================================== */

const BUILTIN_ENV_NAMES = new Set([
  'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA',
  'LOCALAPPDATA', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432',
  'COMMONPROGRAMFILES', 'COMMONPROGRAMFILES(X86)', 'COMMONPROGRAMW6432', 'PUBLIC',
  'ALLUSERSPROFILE', 'TEMP', 'TMP', 'COMPUTERNAME', 'USERNAME', 'USERDOMAIN', 'OS',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'PROCESSOR_IDENTIFIER', 'PATHEXT',
  'COMSPEC', 'PSMODULEPATH', 'DRIVERDATA', 'LOGONSERVER', 'SESSIONNAME', 'USERDNSDOMAIN',
  'PROCESSOR_LEVEL', 'PROCESSOR_REVISION'
])

/** PATH 条目的归一化 key（小写、去尾部斜杠、去空白） */
function pathKeyOf(entry) {
  return normStr(entry).trim().replace(/[\\/]+$/, '').toLowerCase()
}

function rebuildPathValue(raw, opts) {
  const options = opts || {}
  const parts = normStr(raw).split(';')
  const out = []
  const seen = new Set()
  for (const part of parts) {
    const text = options.normalize ? part.trim() : part
    if (options.normalize && text === '') continue
    if (text !== '' && options.removeKeys && options.removeKeys.has(pathKeyOf(text))) continue
    if (options.dedupe) {
      const key = pathKeyOf(text)
      if (key !== '') {
        if (seen.has(key)) continue
        seen.add(key)
      }
    }
    out.push(text)
  }
  let joined = out.join(';')
  if (options.normalize) joined = joined.replace(/;+$/, '')
  return joined
}

function scopeKeyPath(scope) {
  const paths = regsvc.envPaths()
  return scope === 'machine' ? paths.machine : paths.user
}

async function runHealthScan() {
  const cfg = store.readConfig()
  const items = []
  const envPaths = regsvc.envPaths()

  const [userEnv, machineEnv, userVals, machineVals] = await Promise.all([
    withTimeout(registry.readScope('user').catch(() => []), 60000, []),
    withTimeout(registry.readScope('machine').catch(() => []), 60000, []),
    withTimeout(regsvc.listValues(envPaths.user, { timeout: 30000 }).catch(() => []), 40000, []),
    withTimeout(regsvc.listValues(envPaths.machine, { timeout: 30000 }).catch(() => []), 40000, [])
  ])

  /* ---------- 变量表（用于引用 / 循环 / 展开） ---------- */
  const varMap = new Map()
  for (const v of machineEnv) varMap.set(normStr(v.name).toUpperCase(), normStr(v.value))
  for (const v of userEnv) varMap.set(normStr(v.name).toUpperCase(), normStr(v.value))
  const known = {}
  for (const key of Object.keys(process.env)) known[key.toUpperCase()] = normStr(process.env[key])
  for (const [k, v] of varMap.entries()) known[k] = v
  for (const n of BUILTIN_ENV_NAMES) if (known[n] === undefined) known[n] = ''

  /* ---------- 1 / 2 / 3. PATH 重复、失效、格式 ---------- */
  for (const scope of ['user', 'machine']) {
    const list = scope === 'user' ? userEnv : machineEnv
    const hit = list.find((v) => normStr(v.name).toUpperCase() === 'PATH')
    if (!hit) continue
    const raw = normStr(hit.value)
    const keyPath = scopeKeyPath(scope)
    const entries = raw.split(';')
    const nonEmpty = entries.filter((s) => s.trim() !== '')

    // 3. 首尾多余分号 / 空条目
    if (/^\s*;/.test(raw) || /;\s*$/.test(raw) || /;;/.test(raw) || nonEmpty.length !== entries.length) {
      const after = rebuildPathValue(raw, { normalize: true })
      items.push({
        id: `path-format-${scope}`,
        level: 'info',
        type: 'path-format',
        location: `${scope === 'machine' ? '系统' : '用户'} PATH`,
        title: 'PATH 存在空条目或多余分号',
        detail: `原始值共 ${entries.length} 段，其中 ${entries.length - nonEmpty.length} 段为空；末尾分号或连续分号会让部分程序按空目录解析。`,
        suggestion: '规范化 PATH：去掉空段与首尾分号，并统一去掉每段首尾空白。',
        fixable: true,
        fixKind: 'normalize-path',
        scope,
        keyPath,
        name: normStr(hit.name) || 'Path',
        fix: { kind: 'normalize-path', path: keyPath, name: normStr(hit.name) || 'Path' }
      })
    }

    // 1. 重复条目
    const seen = new Map()
    const duplicates = []
    for (const entry of nonEmpty) {
      const k = pathKeyOf(entry)
      if (!k) continue
      if (seen.has(k)) duplicates.push({ entry, first: seen.get(k) })
      else seen.set(k, entry)
    }
    if (duplicates.length) {
      const after = rebuildPathValue(raw, { dedupe: true })
      items.push({
        id: `path-dup-${scope}`,
        level: 'warning',
        type: 'path-duplicate',
        location: `${scope === 'machine' ? '系统' : '用户'} PATH`,
        title: `PATH 中有 ${duplicates.length} 条重复目录`,
        detail: `重复条目：${duplicates.slice(0, 8).map((d) => d.entry).join('；')}${duplicates.length > 8 ? ' 等' : ''}。重复会拖慢每次命令查找。`,
        suggestion: '保留首次出现的条目，删除后续重复项。',
        fixable: true,
        fixKind: 'remove-duplicate-path',
        scope,
        keyPath,
        name: normStr(hit.name) || 'Path',
        duplicates: duplicates.map((d) => d.entry),
        fix: { kind: 'remove-duplicate-path', path: keyPath, name: normStr(hit.name) || 'Path' }
      })
    }

    // 2. 路径不存在（主动跳过网络盘 / 可移动磁盘，避免诊断卡在慢速设备上）
    const pathOpts = { config: { ...cfg, scanDetectNetworkDrive: false, scanDetectRemovable: false } }
    const checked = await withTimeout(
      registry.classifyPaths(nonEmpty.length ? nonEmpty : [], pathOpts).catch(() => []),
      Math.min(180000, Math.max(20000, (Number(cfg.pathTimeoutSec) || 10) * 1000 * 3)),
      []
    )
    const missing = checked.filter((c) => !c.exists && c.type === 'missing')
    for (const m of missing.slice(0, 30)) {
      const key = pathKeyOf(m.path)
      items.push({
        id: `path-missing-${scope}-${key}`,
        level: 'warning',
        type: 'path-missing',
        location: `${scope === 'machine' ? '系统' : '用户'} PATH`,
        title: `PATH 中的目录不存在：${m.path}`,
        detail: `目录「${m.path}」在磁盘上找不到，命令查找时会产生一次无效的磁盘访问。`,
        suggestion: '确认该软件已卸载或移动后，从 PATH 中删除这条记录。',
        fixable: true,
        fixKind: 'remove-missing-path',
        scope,
        keyPath,
        name: normStr(hit.name) || 'Path',
        entry: m.path,
        entryKey: key,
        fix: { kind: 'remove-missing-path', path: keyPath, name: normStr(hit.name) || 'Path', entryKey: key }
      })
    }
  }

  /* ---------- 4. 无效 %VAR% 引用 ---------- */
  for (const scope of ['user', 'machine']) {
    const list = scope === 'user' ? userEnv : machineEnv
    for (const v of list) {
      const refs = normStr(v.value).match(/%([^%|=\s]+)%/g) || []
      const bad = new Set()
      for (const r of refs) {
        const name = r.slice(1, -1).toUpperCase()
        if (!name) continue
        if (known[name] === undefined) bad.add(name)
      }
      for (const name of bad) {
        items.push({
          id: `ref-${scope}-${normStr(v.name).toUpperCase()}-${name}`,
          level: 'warning',
          type: 'invalid-reference',
          location: `${scope === 'machine' ? '系统' : '用户'}变量 ${v.name}`,
          title: `%${name}% 引用了不存在的变量`,
          detail: `${v.name} = ${normStr(v.value).slice(0, 300)}，其中 %${name}% 无法展开，程序会拿到未解析的原文。`,
          suggestion: `创建变量 ${name}，或修正 ${v.name} 中的引用名称。`,
          fixable: false,
          fixKind: '',
          scope,
          name: normStr(v.name),
          ref: name
        })
      }
    }
  }

  /* ---------- 5. 变量循环引用 ---------- */
  try {
    const { detectCycles } = require('./analyze')
    const effective = [...machineEnv]
    const userNames = new Set(userEnv.map((v) => normStr(v.name).toUpperCase()))
    const cycles = detectCycles([...effective.filter((v) => !userNames.has(normStr(v.name).toUpperCase())), ...userEnv])
    for (const chain of cycles) {
      items.push({
        id: `cycle-${chain.join('>')}`,
        level: 'critical',
        type: 'circular-reference',
        location: chain.length === 1 ? `变量 ${chain[0]}` : `变量 ${chain.join(' → ')}`,
        title: chain.length === 1 ? `${chain[0]} 引用了自身` : `${chain.join(' → ')} 形成循环引用`,
        detail: chain.length === 1
          ? `${chain[0]} 的值里包含 %${chain[0]}%，展开时永远无法得到确定结果。`
          : `这些变量互相引用（${chain.join(' → ')} → ${chain[0]}），Windows 无法完成展开。`,
        suggestion: '改写其中一个变量的值为绝对路径，打断引用环。',
        fixable: false,
        fixKind: '',
        chain
      })
    }
  } catch { /* 循环检测失败不影响其它项 */ }

  /* ---------- 6. 环境变量键值类型异常 ---------- */
  for (const scope of ['user', 'machine']) {
    const vals = scope === 'user' ? userVals : machineVals
    const keyPath = scopeKeyPath(scope)
    for (const v of vals) {
      const name = normStr(v.name)
      if (!name) continue
      const isPath = name.toUpperCase() === 'PATH'
      if (isPath) {
        if (v.type !== 'REG_SZ' && v.type !== 'REG_EXPAND_SZ') {
          items.push({
            id: `type-${scope}-PATH`,
            level: 'critical',
            type: 'value-type',
            location: `${scope === 'machine' ? '系统' : '用户'}变量 ${name}`,
            title: `PATH 的注册表类型异常：${v.type}`,
            detail: `PATH 必须是 REG_EXPAND_SZ 或 REG_SZ，当前为 ${v.type}，系统读取时可能直接忽略或解析出错。`,
            suggestion: '把 PATH 改回字符串类型（建议 REG_EXPAND_SZ），原值会保留。',
            fixable: true,
            fixKind: 'set-value-type',
            scope,
            keyPath,
            name,
            before: normStr(v.value),
            rawType: v.type,
            fix: { kind: 'set-value-type', path: keyPath, name, type: 'REG_EXPAND_SZ' }
          })
        }
        continue
      }
      if (v.type !== 'REG_SZ' && v.type !== 'REG_EXPAND_SZ') {
        items.push({
          id: `type-${scope}-${name.toUpperCase()}`,
          level: 'warning',
          type: 'value-type',
          location: `${scope === 'machine' ? '系统' : '用户'}变量 ${name}`,
          title: `${name} 用 ${v.type} 存储环境变量`,
          detail: `环境变量应为字符串类型，当前为 ${v.type}，多数程序读到的是空值或数字原文。`,
          suggestion: '改为字符串类型；如果原意是数值，请以文本形式保存。',
          fixable: true,
          fixKind: 'set-value-type',
          scope,
          keyPath,
          name,
          before: normStr(v.value),
          rawType: v.type,
          fix: { kind: 'set-value-type', path: keyPath, name, type: 'REG_EXPAND_SZ' }
        })
      }
    }
  }

  /* ---------- 7. 配置集互斥组冲突 ---------- */
  try {
    const data = envset.load()
    const sets = Array.isArray(data.sets) ? data.sets : []
    const groups = Array.isArray(data.mutexGroups) ? data.mutexGroups : []
    for (const g of groups) {
      const members = sets.filter((s) => s.mutexId === g.id)
      if (members.length < 2) continue
      const active = []
      for (const s of members) {
        const vars = Array.isArray(s.variables) ? s.variables : []
        if (!vars.length) continue
        const allMatch = vars.every((v) => {
          const scope = v.scope === 'system' || v.scope === 'machine' ? 'machine' : 'user'
          const hit = varMap.get(normStr(v.name).toUpperCase())
          if (hit === undefined) return false
          return normStr(hit) === normStr(v.value)
        })
        if (allMatch) active.push(s)
      }
      if (active.length > 1) {
        items.push({
          id: `mutex-${g.id}`,
          level: 'critical',
          type: 'mutex-conflict',
          location: `互斥组「${g.name}」`,
          title: `互斥组同时有 ${active.length} 套配置处于生效状态`,
          detail: `同时生效：${active.map((s) => s.name).join('、')}。互斥组约定同组只能有 1 套生效，当前环境变量已互相覆盖。`,
          suggestion: '在该组里只保留一套配置生效，其余配置集取消加载。',
          fixable: false,
          fixKind: '',
          groupId: g.id,
          activeIds: active.map((s) => s.id)
        })
      }
    }
  } catch { /* 配置集读取失败不影响其它项 */ }

  /* ---------- 8. 项目绑定文件夹丢失 ---------- */
  try {
    const file = path.join(store.appDataDir(), 'config', 'projects.json')
    const raw = readJson(file)
    const projects = Array.isArray(raw) ? raw : []
    const targets = []
    for (const p of projects) {
      const folder = normStr(p && p.folder).trim()
      if (folder) targets.push({ project: p, dir: folder, kind: 'folder' })
      if (p && p.cwdMode === 'custom' && normStr(p.customCwd).trim()) {
        targets.push({ project: p, dir: normStr(p.customCwd).trim(), kind: 'cwd' })
      }
    }
    if (targets.length) {
      const uniq = [...new Set(targets.map((t) => t.dir))]
      const checked = await withTimeout(
        registry.checkPathsExist(uniq).catch(() => []),
        60000,
        []
      )
      const existMap = new Map(checked.map((c) => [normStr(c.path), !!c.exists]))
      for (const t of targets) {
        const exists = existMap.has(t.dir) ? existMap.get(t.dir) : true
        if (exists) continue
        items.push({
          id: `project-${normStr(t.project.id) || t.dir}-${t.kind}`,
          level: 'warning',
          type: 'project-folder',
          location: `项目「${normStr(t.project.name) || normStr(t.project.id)}」`,
          title: t.kind === 'folder' ? '项目文件夹不存在' : '项目自定义工作目录不存在',
          detail: `${t.dir} 已不存在，启动该项目的终端会回落到默认目录。`,
          suggestion: '在项目环境里重新指定文件夹，或删除这个已失效的项目。',
          fixable: false,
          fixKind: '',
          projectId: normStr(t.project.id),
          dir: t.dir
        })
      }
    }
  } catch { /* 项目数据读取失败不影响其它项 */ }

  /* ---------- 9. 已识别开发工具的安装路径不存在 ---------- */
  try {
    const candidates = []
    const tasksRaw = readJson(path.join(store.appDataDir(), 'tasks.json'))
    if (Array.isArray(tasksRaw)) {
      for (const t of tasksRaw) {
        if (!t || t.type !== 'deploy') continue
        const dir = normStr(t.params && t.params.installDir).trim()
        if (dir) candidates.push({ id: `task-${normStr(t.id)}`, name: normStr(t.name) || '部署任务', dir })
      }
    }
    const catalogRaw = readJson(path.join(store.appDataDir(), 'catalog.json'))
    const catalogItems = catalogRaw && Array.isArray(catalogRaw.items) ? catalogRaw.items : []
    for (const it of catalogItems) {
      const dir = normStr(it && it.installPath).trim()
      if (dir) candidates.push({ id: `catalog-${normStr(it.id)}`, name: normStr(it.name) || normStr(it.id), dir })
    }
    if (candidates.length) {
      const uniq = [...new Set(candidates.map((c) => c.dir))]
      const checked = await withTimeout(
        registry.checkPathsExist(uniq).catch(() => []),
        60000,
        []
      )
      const existMap = new Map(checked.map((c) => [normStr(c.path), !!c.exists]))
      const seen = new Set()
      for (const c of candidates) {
        if (seen.has(c.id)) continue
        seen.add(c.id)
        const exists = existMap.has(c.dir) ? existMap.get(c.dir) : true
        if (exists) continue
        items.push({
          id: `tool-${c.id}`,
          level: 'warning',
          type: 'tool-path',
          location: `开发工具「${c.name}」`,
          title: '已识别工具的安装目录不存在',
          detail: `${c.dir} 找不到，可能是手动删除或移动到其它磁盘，相关 HOME 变量与 PATH 条目会全部失效。`,
          suggestion: '重新扫描该工具的实际安装位置并修正环境变量，或卸载并从清单中移除。',
          fixable: false,
          fixKind: '',
          dir: c.dir
        })
      }
    }
  } catch { /* 工具数据读取失败不影响其它项 */ }

  const stats = { critical: 0, warning: 0, info: 0 }
  for (const item of items) {
    if (item.level === 'critical') stats.critical += 1
    else if (item.level === 'warning') stats.warning += 1
    else stats.info += 1
  }
  const score = Math.max(0, 100 - stats.critical * 12 - stats.warning * 5 - stats.info * 1)
  const scannedAt = Date.now()
  return { score, scannedAt, items, stats }
}

async function healthScan() {
  const result = await runHealthScan()
  const file = path.join(healthDir(), 'last.json')
  writeJson(file, result)
  audit('health', 'healthScan', { score: result.score, stats: result.stats, total: result.items.length })
  return result
}

function healthLastScore() {
  const data = readJson(path.join(store.appDataDir(), 'health', 'last.json'))
  if (!data || typeof data !== 'object') return { scannedAt: 0, score: null, stats: { critical: 0, warning: 0, info: 0 } }
  return {
    scannedAt: Number(data.scannedAt) || 0,
    score: typeof data.score === 'number' ? data.score : null,
    stats: data.stats || { critical: 0, warning: 0, info: 0 }
  }
}

/** 从当前扫描结果计算单条修复动作 */
function previewAction(item, currentPathValue) {
  const fix = item.fix
  if (!fix) return null
  if (fix.kind === 'set-value-type') {
    return {
      id: item.id,
      kind: 'set-value-type',
      path: fix.path,
      name: fix.name,
      before: `${normStr(item.before)}（${normStr(item.rawType) || '非字符串类型'}）`,
      after: `${normStr(item.before)}（REG_EXPAND_SZ）`,
      description: `把 ${fix.name} 的类型改为 REG_EXPAND_SZ，值保持不变`
    }
  }
  if (fix.kind === 'remove-duplicate-path') {
    return {
      id: item.id,
      kind: 'remove-duplicate-path',
      path: fix.path,
      name: fix.name,
      before: currentPathValue,
      after: rebuildPathValue(currentPathValue, { dedupe: true }),
      description: `删除 PATH 中 ${Array.isArray(item.duplicates) ? item.duplicates.length : 0} 条重复目录（保留首次出现）`
    }
  }
  if (fix.kind === 'remove-missing-path') {
    return {
      id: item.id,
      kind: 'remove-missing-path',
      path: fix.path,
      name: fix.name,
      before: currentPathValue,
      after: rebuildPathValue(currentPathValue, { removeKeys: new Set([fix.entryKey]) }),
      description: `从 PATH 中删除不存在的目录 ${item.entry}`
    }
  }
  if (fix.kind === 'normalize-path') {
    return {
      id: item.id,
      kind: 'normalize-path',
      path: fix.path,
      name: fix.name,
      before: currentPathValue,
      after: rebuildPathValue(currentPathValue, { normalize: true }),
      description: '去掉空条目、首尾分号与每段多余空白'
    }
  }
  return null
}

async function healthPreviewFix(payload) {
  const { ids } = payload || {}
  const wanted = Array.isArray(ids) ? ids.map(normStr).filter(Boolean) : []
  if (!wanted.length) throw new Error('请选择要修复的问题')
  const cached = readJson(path.join(store.appDataDir(), 'health', 'last.json'))
  const useCache = cached && Array.isArray(cached.items) &&
    wanted.every((id) => (cached.items || []).some((i) => i.id === id))
  const result = useCache ? cached : await runHealthScan()

  const pathValues = new Map()
  const actions = []
  for (const id of wanted) {
    const item = (result.items || []).find((i) => i.id === id)
    if (!item || !item.fix) continue
    if (item.fix.kind !== 'set-value-type') {
      const key = item.fix.path.toLowerCase()
      if (!pathValues.has(key)) {
        let cur = ''
        try {
          const vals = await regsvc.listValues(item.fix.path, { timeout: 20000 })
          const hit = vals.find((v) => normStr(v.name).toLowerCase() === normStr(item.fix.name).toLowerCase())
          cur = hit ? normStr(hit.value) : ''
        } catch { cur = '' }
        pathValues.set(key, cur)
      }
    }
    const action = previewAction(item, pathValues.get(item.fix.path.toLowerCase()) || '')
    if (action && action.before !== action.after) actions.push(action)
  }
  return { actions, source: useCache ? 'cache' : 'scan' }
}

/** 修复前的注册表备份，返回 backupId */
async function backupEnvForFix(prefix) {
  const envPaths = regsvc.envPaths()
  const nodes = []
  for (const p of [envPaths.user, envPaths.machine]) {
    try {
      const tree = await regsvc.readTree(p, { maxKeys: 20000 })
      nodes.push({ path: p, values: tree.nodes && tree.nodes[0] ? tree.nodes[0].values : [], nodes: tree.nodes })
    } catch (err) {
      nodes.push({ path: p, values: [], error: err.message })
    }
  }
  const d = new Date()
  const id = `${prefix}-${fileStamp(d)}`
  const file = path.join(backupDir(), `${id}.json`)
  writeJson(file, {
    kind: 'registry-health-fix-backup',
    id,
    createdAt: d.getTime(),
    createdAtText: tsText(d.getTime()),
    nodes
  })
  return { id, file }
}

async function healthApplyFix(payload) {
  const { ids } = payload || {}
  const wanted = Array.isArray(ids) ? ids.map(normStr).filter(Boolean) : []
  if (!wanted.length) throw new Error('请选择要修复的问题')

  const scan = await runHealthScan()
  const picked = (scan.items || []).filter((i) => wanted.includes(i.id) && i.fix)
  if (!picked.length) throw new Error('所选问题没有可自动修复的项')

  const admin = await regsvc.isAdmin(false)
  const needAdmin = picked.some((i) => regsvc.needsAdmin(i.fix.path))
  if (needAdmin && !admin) throw new Error('修复系统分支需要管理员权限，请以管理员身份重新启动本程序')

  const backup = await backupEnvForFix('HealthFixBackup')

  // PATH 类修复按注册表项合并，避免同一条 PATH 被多次覆写
  const groups = new Map()
  const typeFixes = []
  for (const item of picked) {
    if (item.fix.kind === 'set-value-type') { typeFixes.push(item); continue }
    const key = item.fix.path.toLowerCase()
    const g = groups.get(key) || {
      keyPath: item.fix.path,
      name: item.fix.name,
      dedupe: false,
      normalize: false,
      removeKeys: new Set(),
      ids: []
    }
    if (item.fix.kind === 'remove-duplicate-path') g.dedupe = true
    if (item.fix.kind === 'normalize-path') g.normalize = true
    if (item.fix.kind === 'remove-missing-path' && item.fix.entryKey) g.removeKeys.add(item.fix.entryKey)
    g.ids.push(item.id)
    groups.set(key, g)
  }

  const applied = []
  const skipped = []

  for (const g of groups.values()) {
    let current = ''
    let currentType = 'REG_EXPAND_SZ'
    try {
      const vals = await regsvc.listValues(g.keyPath, { timeout: 20000 })
      const hit = vals.find((v) => normStr(v.name).toLowerCase() === normStr(g.name).toLowerCase())
      if (!hit) throw new Error('找不到该键值')
      current = normStr(hit.value)
      currentType = hit.type === 'REG_SZ' ? 'REG_SZ' : 'REG_EXPAND_SZ'
    } catch (err) {
      for (const id of g.ids) skipped.push({ id, message: err.message })
      continue
    }
    const after = rebuildPathValue(current, {
      dedupe: g.dedupe,
      normalize: g.normalize,
      removeKeys: g.removeKeys
    })
    if (after === current) {
      for (const id of g.ids) skipped.push({ id, message: 'PATH 已符合预期，无需修改' })
      continue
    }
    try {
      await regsvc.setValue(g.keyPath, g.name, currentType, after)
      for (const id of g.ids) applied.push({ id, path: g.keyPath, name: g.name })
    } catch (err) {
      for (const id of g.ids) skipped.push({ id, message: err.message })
    }
  }

  for (const item of typeFixes) {
    try {
      await regsvc.setValue(item.fix.path, item.fix.name, item.fix.type || 'REG_EXPAND_SZ', normStr(item.before))
      applied.push({ id: item.id, path: item.fix.path, name: item.fix.name })
    } catch (err) {
      skipped.push({ id: item.id, message: err.message })
    }
  }

  if (applied.length) {
    try { await regsvc.broadcastRegistryChange() } catch { /* ignore */ }
  }
  audit('health', 'healthFix', {
    backupId: backup.id,
    backupFile: backup.file,
    applied: applied.length,
    skipped: skipped.length,
    ids: wanted
  })
  return { applied: applied.length, skipped, backupId: backup.id, backupFile: backup.file }
}

function escapeHtml(text) {
  return normStr(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function levelColor(level) {
  if (level === 'critical') return '#f53f3f'
  if (level === 'warning') return '#ff7d00'
  return '#165DFF'
}

function levelLabel(level) {
  if (level === 'critical') return '严重'
  if (level === 'warning') return '警告'
  return '提示'
}

function buildHealthReport(result, format) {
  const data = result && Array.isArray(result.items) ? result : { score: 0, scannedAt: Date.now(), items: [], stats: {} }
  const stats = data.stats || { critical: 0, warning: 0, info: 0 }

  if (format === 'markdown') {
    const lines = []
    lines.push('# 环境健康诊断报告')
    lines.push('')
    lines.push(`- 生成时间：${tsText(Date.now())}`)
    lines.push(`- 扫描时间：${tsText(data.scannedAt)}`)
    lines.push(`- 健康评分：**${data.score == null ? '—' : data.score} / 100**`)
    lines.push(`- 问题统计：严重 ${stats.critical || 0} · 警告 ${stats.warning || 0} · 提示 ${stats.info || 0}`)
    lines.push('')
    lines.push('| 级别 | 类型 | 位置 | 问题 | 详情 | 建议 |')
    lines.push('| --- | --- | --- | --- | --- | --- |')
    for (const item of data.items) {
      const esc = (s) => normStr(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
      lines.push(`| ${levelLabel(item.level)} | ${esc(item.type)} | ${esc(item.location)} | ${esc(item.title)} | ${esc(item.detail)} | ${esc(item.suggestion)} |`)
    }
    if (!data.items.length) lines.push('| — | — | — | 未发现问题 | 当前环境状态良好 | — |')
    return lines.join('\n')
  }

  const rows = data.items.map((item) => `
      <tr>
        <td><span class="tag" style="background:${levelColor(item.level)}">${levelLabel(item.level)}</span></td>
        <td>${escapeHtml(item.location)}</td>
        <td><strong>${escapeHtml(item.title)}</strong><div class="detail">${escapeHtml(item.detail)}</div></td>
        <td>${escapeHtml(item.suggestion)}</td>
      </tr>`).join('')
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>环境健康诊断报告</title>
<style>
  body { font-family: "Microsoft YaHei", "Segoe UI", sans-serif; margin: 0; padding: 32px; background: #f7f8fa; color: #1d2129; }
  .wrap { max-width: 1080px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 28px 32px; box-shadow: 0 2px 12px rgba(0,0,0,.06); }
  h1 { font-size: 22px; margin: 0 0 6px; }
  .meta { color: #86909c; font-size: 13px; margin-bottom: 20px; }
  .cards { display: flex; gap: 14px; margin-bottom: 22px; flex-wrap: wrap; }
  .card { flex: 1 1 160px; border: 1px solid #e5e6eb; border-radius: 10px; padding: 14px 16px; }
  .card .label { font-size: 12px; color: #86909c; }
  .card .value { font-size: 26px; font-weight: 700; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border-bottom: 1px solid #f2f3f5; padding: 10px 8px; text-align: left; vertical-align: top; }
  th { background: #fafbfc; color: #4e5969; font-weight: 600; }
  .tag { display: inline-block; color: #fff; border-radius: 4px; padding: 1px 8px; font-size: 12px; }
  .detail { color: #86909c; margin-top: 4px; line-height: 1.6; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>环境健康诊断报告</h1>
    <div class="meta">生成时间 ${tsText(Date.now())} · 扫描时间 ${tsText(data.scannedAt)} · WinEnv管家 v${escapeHtml(appVersion())}</div>
    <div class="cards">
      <div class="card"><div class="label">健康评分</div><div class="value" style="color:#165DFF">${data.score == null ? '—' : escapeHtml(data.score)}</div></div>
      <div class="card"><div class="label">严重</div><div class="value" style="color:#f53f3f">${stats.critical || 0}</div></div>
      <div class="card"><div class="label">警告</div><div class="value" style="color:#ff7d00">${stats.warning || 0}</div></div>
      <div class="card"><div class="label">提示</div><div class="value" style="color:#165DFF">${stats.info || 0}</div></div>
    </div>
    <table>
      <thead><tr><th style="width:70px">级别</th><th style="width:220px">位置</th><th>问题</th><th style="width:260px">修复建议</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4">未发现问题，当前环境状态良好。</td></tr>'}</tbody>
    </table>
  </div>
</body>
</html>`
}

async function healthExportReport(payload) {
  const { format, file, result } = payload || {}
  const fmt = format === 'markdown' ? 'markdown' : 'html'
  let data = result && Array.isArray(result.items) ? result : null
  if (!data) {
    const cached = readJson(path.join(store.appDataDir(), 'health', 'last.json'))
    data = cached && Array.isArray(cached.items) ? cached : await runHealthScan()
  }
  const content = buildHealthReport(data, fmt)

  let target = normStr(file).trim()
  if (!target) {
    const win = focusedWindow()
    const options = {
      title: '导出健康诊断报告',
      defaultPath: `HealthReport-${fileStamp()}.${fmt === 'markdown' ? 'md' : 'html'}`,
      filters: [{ name: fmt === 'markdown' ? 'Markdown' : 'HTML', extensions: [fmt === 'markdown' ? 'md' : 'html'] }]
    }
    const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (res.canceled || !res.filePath) return { file: '' }
    target = res.filePath
  }
  store.ensureDir(path.dirname(target))
  fs.writeFileSync(target, content, 'utf8')
  return { file: target, format: fmt, bytes: fs.statSync(target).size }
}

/* ======================================================================
 * E. 定时任务
 * ====================================================================== */

/**
 * 只读 / 备份类白名单。产品硬性约束：定时任务不允许出现任何修改环境变量或注册表的类型。
 */
const SCHEDULE_TYPES = {
  snapshot: { label: '自动创建系统环境快照', readOnly: true },
  'registry-backup': { label: '自动备份注册表分支', readOnly: true },
  'audit-export': { label: '导出审计日志', readOnly: true },
  'health-scan': { label: '执行环境健康诊断并保存报告', readOnly: true }
}

const FORBIDDEN_HINTS = ['apply', 'write', 'set', 'edit', 'delete', 'restore', 'import', 'modify', 'fix', 'replace', 'update']

function schedulesFile() {
  return path.join(store.appDataDir(), 'schedules.json')
}

function schedulesLoad() {
  const raw = readJson(schedulesFile())
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tasks)) return { tasks: [] }
  return { tasks: raw.tasks }
}

function schedulesSave(data) {
  writeJson(schedulesFile(), { tasks: data.tasks || [] })
  return data
}

function assertScheduleType(type) {
  const t = normStr(type).trim()
  if (!t) throw new Error('请选择任务类型')
  if (!SCHEDULE_TYPES[t]) {
    const lower = t.toLowerCase()
    const forbidden = FORBIDDEN_HINTS.some((h) => lower.includes(h))
    throw new Error(
      forbidden
        ? `定时任务不允许执行修改类操作：${t}。只支持 ${Object.keys(SCHEDULE_TYPES).join(' / ')}`
        : `不支持的任务类型：${t}。只支持 ${Object.keys(SCHEDULE_TYPES).join(' / ')}`
    )
  }
  return t
}

function normalizeSchedule(schedule) {
  const src = schedule || {}
  const frequency = ['daily', 'weekly', 'monthly'].includes(src.frequency) ? src.frequency : 'daily'
  const time = normStr(src.time).trim() || '09:00'
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('执行时间格式应为 HH:mm（24 小时制）')
  const weekdays = Array.isArray(src.weekdays) ? src.weekdays.map((d) => Number(d)).filter((d) => d >= 1 && d <= 7) : []
  const monthdays = Array.isArray(src.monthdays) ? src.monthdays.map((d) => Number(d)).filter((d) => d >= 1 && d <= 31) : []
  if (frequency === 'weekly' && !weekdays.length) throw new Error('每周任务至少选择一天')
  if (frequency === 'monthly' && !monthdays.length) throw new Error('每月任务至少选择一个日期')
  return { frequency, time, weekdays, monthdays }
}

const WEEKDAY_NAMES = { 1: 'MON', 2: 'TUE', 3: 'WED', 4: 'THU', 5: 'FRI', 6: 'SAT', 7: 'SUN' }
const WEEKDAY_LABEL = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日' }

/** 下 M 次执行时间估算，返回毫秒时间戳；找不到返回 0 */
function computeNextRun(schedule, fromMs) {
  const sched = schedule || {}
  const now = Number(fromMs) || Date.now()
  const m = normStr(sched.time).match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return 0
  const hh = Number(m[1])
  const mm = Number(m[2])
  for (let i = 0; i < 400; i++) {
    const base = new Date(now)
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i, hh, mm, 0, 0)
    if (d.getTime() <= now) continue
    if (sched.frequency === 'weekly') {
      const iso = ((d.getDay() + 6) % 7) + 1
      const days = Array.isArray(sched.weekdays) && sched.weekdays.length ? sched.weekdays.map(Number) : []
      if (days.length && !days.includes(iso)) continue
    } else if (sched.frequency === 'monthly') {
      const days = Array.isArray(sched.monthdays) && sched.monthdays.length ? sched.monthdays.map(Number) : []
      if (days.length && !days.includes(d.getDate())) continue
    }
    return d.getTime()
  }
  return 0
}

function describeSchedule(schedule) {
  const s = schedule || {}
  const time = normStr(s.time) || '09:00'
  if (s.frequency === 'weekly') {
    const days = (s.weekdays || []).map((d) => WEEKDAY_LABEL[Number(d)] || `周${d}`).join('、')
    return `每周 ${days || '（未选择）'} ${time}`
  }
  if (s.frequency === 'monthly') {
    const days = (s.monthdays || []).map((d) => `${d} 日`).join('、')
    return `每月 ${days || '（未选择）'} ${time}`
  }
  return `每天 ${time}`
}

function appExePath() {
  const portable = normStr(process.env.PORTABLE_EXECUTABLE_PATH).trim()
  if (portable) return portable
  return process.execPath
}

function isPackaged() {
  try {
    return !!app.isPackaged
  } catch {
    return false
  }
}

/**
 * 生成任务计划程序命令。
 * 打包态： "<exe>" --scheduled-run <id>
 * 开发态： "<electron.exe>" "<appPath>" --scheduled-run <id>
 */
function buildTaskCommand(taskId) {
  const exe = appExePath()
  const args = []
  if (!isPackaged()) {
    try {
      const appPath = app.getAppPath()
      if (appPath) args.push(appPath)
    } catch { /* ignore */ }
  }
  args.push('--scheduled-run', taskId)
  const quote = (s) => (/\s/.test(s) ? `"${s}"` : s)
  const tr = [exe, ...args].map(quote).join(' ')
  return { exe, args, tr }
}

function taskSchedulerName(taskId) {
  return `WinEnvManager\\${taskId}`
}

/** 构造 schtasks /Create 参数 */
function buildCreateArgs(task) {
  const sched = task.schedule || {}
  const params = task.params || {}
  const cmd = buildTaskCommand(task.id)
  const name = taskSchedulerName(task.id)
  const args = ['/Create', '/TN', name, '/TR', cmd.tr, '/F']
  const time = /^\d{1,2}:\d{2}$/.test(String(sched.time || '')) ? sched.time : '03:00'
  if (sched.frequency === 'weekly') {
    const days = (sched.weekdays || []).map((d) => WEEKDAY_NAMES[Number(d)] || 'MON').join(',') || 'MON'
    args.push('/SC', 'WEEKLY', '/D', days, '/ST', time)
  } else if (sched.frequency === 'monthly') {
    const days = (sched.monthdays || []).map((d) => String(d)).filter((d) => /^\d{1,2}$/.test(d)).join(',') || '1'
    args.push('/SC', 'MONTHLY', '/D', days, '/ST', time)
  } else {
    args.push('/SC', 'DAILY', '/ST', time)
  }
  // 仅在空闲时运行：/I 让计划程序只在系统空闲时启动
  if (params.onlyIdle) args.push('/I')
  // 错过触发后尽快补执行（仅在电池供电时不限制，避免笔记本被拦）
  if (params.catchUp) args.push('/Z')
  // 任务以当前用户身份运行，需要登录态（环境变量与注册表都要读当前用户配置）
  args.push('/RL', 'HIGHEST')
  return { args, name, cmd }
}

function runSchtasks(args, timeout = 20000) {
  return new Promise((resolve) => {
    try {
      execFile('schtasks.exe', args, { windowsHide: true, timeout, encoding: 'utf8' }, (err, stdout, stderr) => {
        resolve({
          ok: !err,
          code: err && typeof err.code === 'number' ? err.code : (err ? 1 : 0),
          stdout: normStr(stdout).trim(),
          stderr: normStr(stderr).trim() || (err ? normStr(err.message) : '')
        })
      })
    } catch (err) {
      resolve({ ok: false, code: 1, stdout: '', stderr: err.message })
    }
  })
}

async function registerTaskToScheduler(task) {
  const { args } = buildCreateArgs(task)
  const res = await runSchtasks(args)
  return {
    registered: res.ok,
    registerError: res.ok ? '' : (res.stderr || res.stdout || 'schtasks 执行失败'),
    command: `schtasks ${args.map((a) => (/[\s]/.test(a) ? `"${a}"` : a)).join(' ')}`
  }
}

async function removeTaskFromScheduler(taskId) {
  return runSchtasks(['/Delete', '/TN', taskSchedulerName(taskId), '/F'], 15000)
}

async function changeTaskState(taskId, enabled) {
  return runSchtasks(['/Change', '/TN', taskSchedulerName(taskId), enabled ? '/ENABLE' : '/DISABLE'], 15000)
}

/* ------------------------------ 任务执行体 ------------------------------ */

async function exportAuditLogs() {
  const dir = store.ensureDir(store.auditDir())
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.jsonl')).sort()
  if (!files.length) return { files: 0, target: '', lines: 0 }
  const outDir = store.ensureDir(path.join(store.appDataDir(), 'exports'))
  const target = path.join(outDir, `audit-export-${fileStamp()}.jsonl`)
  let lines = 0
  const chunks = []
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8')
    lines += text.split('\n').filter(Boolean).length
    chunks.push(text.endsWith('\n') ? text : `${text}\n`)
  }
  fs.writeFileSync(target, chunks.join(''), 'utf8')
  return { files: files.length, target, lines }
}

async function backupRegistryBranches(paths) {
  const list = Array.isArray(paths) && paths.length ? paths : [regsvc.envPaths().user, regsvc.envPaths().machine]
  const nodes = []
  const failed = []
  for (const raw of list) {
    const p = regsvc.parsePath(raw)
    if (!p.ok) { failed.push({ path: normStr(raw), message: p.message }); continue }
    try {
      const tree = await regsvc.readTree(p.full, { maxKeys: 40000 })
      nodes.push(...(tree.nodes || []))
    } catch (err) {
      failed.push({ path: p.full, message: err.message })
    }
  }
  if (!nodes.length) throw new Error('注册表备份失败：没有可备份的注册表项')
  const d = new Date()
  const file = path.join(backupDir(), `ScheduleBackup-${fileStamp(d)}.json`)
  writeJson(file, {
    kind: 'registry-schedule-backup',
    createdAt: d.getTime(),
    createdAtText: tsText(d.getTime()),
    paths: list,
    nodes,
    failed
  })
  return { file, keys: nodes.length, failed: failed.length }
}

async function executeScheduleTask(task) {
  const type = assertScheduleType(task.type)
  if (type === 'snapshot') {
    const ops = require('../lib/ops')
    const snap = await ops.createSnapshotV2({
      name: `定时快照 ${tsText(Date.now())}`,
      note: '由定时任务自动创建',
      auto: true
    })
    return { kind: type, id: snap && snap.id, file: snap && snap.file }
  }
  if (type === 'registry-backup') {
    const file = await backupRegistryBranches(task.params && task.params.paths)
    return { kind: type, ...file }
  }
  if (type === 'audit-export') {
    const res = await exportAuditLogs()
    return { kind: type, ...res }
  }
  if (type === 'health-scan') {
    const result = await healthScan()
    const target = path.join(healthDir(), `HealthReport-${fileStamp()}.md`)
    fs.writeFileSync(target, buildHealthReport(result, 'markdown'), 'utf8')
    return { kind: type, score: result.score, file: target }
  }
  throw new Error(`不支持的任务类型：${type}`)
}

async function runTaskNow(task) {
  const startedAt = Date.now()
  try {
    const result = await executeScheduleTask(task)
    const data = schedulesLoad()
    const hit = data.tasks.find((t) => t.id === task.id)
    if (hit) {
      hit.lastRunAt = startedAt
      hit.lastResult = { ok: true, at: startedAt, message: '执行成功', detail: result }
      hit.nextRunAt = computeNextRun(hit.schedule)
      schedulesSave(data)
    }
    audit('schedule', 'scheduleRun', { id: task.id, name: task.name, type: task.type, ok: true, detail: result })
    store.writeLog('info', `定时任务「${task.name}」执行完成`, result)
    return result
  } catch (err) {
    const data = schedulesLoad()
    const hit = data.tasks.find((t) => t.id === task.id)
    if (hit) {
      hit.lastRunAt = startedAt
      hit.lastResult = { ok: false, at: startedAt, message: err.message }
      hit.nextRunAt = computeNextRun(hit.schedule)
      schedulesSave(data)
    }
    audit('schedule', 'scheduleRun', { id: task.id, name: task.name, type: task.type, ok: false, message: err.message })
    store.writeLog('error', `定时任务「${task.name}」执行失败`, err.message)
    throw err
  }
}

function publicTask(task) {
  const cmd = buildTaskCommand(task.id)
  return {
    ...task,
    exePath: task.exePath || '',
    stale: !!task.exePath && path.resolve(task.exePath).toLowerCase() !== path.resolve(cmd.exe).toLowerCase(),
    command: cmd.tr
  }
}

function scheduleList() {
  const data = schedulesLoad()
  return { tasks: data.tasks.map(publicTask), types: Object.entries(SCHEDULE_TYPES).map(([k, v]) => ({ key: k, label: v.label })) }
}

async function scheduleCreate(payload) {
  const {
    name, type, schedule, params, runHidden, notifyOnFail, dryRun
  } = payload || {}
  const taskType = assertScheduleType(type)
  const sched = normalizeSchedule(schedule)
  const cmd = buildTaskCommand('__PLACEHOLDER__')

  const now = Date.now()
  const task = {
    id: uid('sch').replace(/[^A-Za-z0-9-]/g, ''),
    name: normStr(name).trim() || SCHEDULE_TYPES[taskType].label,
    type: taskType,
    schedule: sched,
    params: params && typeof params === 'object' ? params : {},
    runHidden: runHidden !== false,
    notifyOnFail: !!notifyOnFail,
    enabled: true,
    lastRunAt: 0,
    lastResult: null,
    nextRunAt: computeNextRun(sched),
    createdAt: now,
    exePath: cmd.exe,
    registered: false,
    registerError: ''
  }

  // 默认 dryRun：只生成命令并写入本地配置，真正注册要显式传 dryRun:false
  const isDryRun = dryRun === undefined ? true : !!dryRun
  if (!isDryRun) {
    const reg = await registerTaskToScheduler(task)
    task.registered = reg.registered
    task.registerError = reg.registerError
  }

  const data = schedulesLoad()
  data.tasks.push(task)
  schedulesSave(data)

  audit('schedule', 'scheduleCreate', {
    id: task.id,
    name: task.name,
    type: task.type,
    schedule: sched,
    dryRun: isDryRun,
    registered: task.registered,
    registerError: task.registerError
  })

  const built = buildCreateArgs(task)
  return {
    task: publicTask(task),
    dryRun: isDryRun,
    registered: task.registered,
    registerError: task.registerError,
    command: `schtasks ${built.args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`
  }
}

async function scheduleUpdate(payload) {
  const {
    id, name, type, schedule, params, runHidden, notifyOnFail, dryRun
  } = payload || {}
  const data = schedulesLoad()
  const task = data.tasks.find((t) => t.id === normStr(id))
  if (!task) throw new Error('定时任务不存在')

  if (type !== undefined) task.type = assertScheduleType(type)
  if (schedule !== undefined) task.schedule = normalizeSchedule(schedule)
  if (name !== undefined) task.name = normStr(name).trim() || task.name
  if (params !== undefined) task.params = params && typeof params === 'object' ? params : {}
  if (runHidden !== undefined) task.runHidden = runHidden !== false
  if (notifyOnFail !== undefined) task.notifyOnFail = !!notifyOnFail
  task.nextRunAt = computeNextRun(task.schedule)
  task.exePath = buildTaskCommand(task.id).exe

  const isDryRun = dryRun === undefined ? true : !!dryRun
  if (!isDryRun) {
    // 重建计划：先删后建，避免 /Create /F 与旧触发器参数不一致
    await removeTaskFromScheduler(task.id)
    const reg = await registerTaskToScheduler(task)
    task.registered = reg.registered
    task.registerError = reg.registerError
    if (task.registered && task.enabled === false) await changeTaskState(task.id, false)
  }

  schedulesSave(data)
  audit('schedule', 'scheduleUpdate', {
    id: task.id, name: task.name, type: task.type, schedule: task.schedule,
    dryRun: isDryRun, registered: task.registered
  })
  const built = buildCreateArgs(task)
  return {
    task: publicTask(task),
    dryRun: isDryRun,
    registered: !!task.registered,
    registerError: task.registerError || '',
    command: `schtasks ${built.args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`
  }
}

async function scheduleRemove(payload) {
  const { ids } = payload || {}
  const wanted = Array.isArray(ids) ? ids.map(normStr).filter(Boolean) : []
  if (!wanted.length) throw new Error('请选择要删除的定时任务')
  const data = schedulesLoad()
  const removed = []
  const failures = []
  for (const id of wanted) {
    const task = data.tasks.find((t) => t.id === id)
    if (!task) { failures.push({ id, message: '任务不存在' }); continue }
    const res = await removeTaskFromScheduler(task.id)
    if (!res.ok) failures.push({ id, message: res.stderr || '计划任务删除失败（本地配置已清理）' })
    data.tasks = data.tasks.filter((t) => t.id !== id)
    removed.push(id)
  }
  schedulesSave(data)
  audit('schedule', 'scheduleRemove', { ids: removed, failures: failures.length })
  return { removed: removed.length, failures }
}

function scheduleRunNow(payload) {
  const { id } = payload || {}
  const data = schedulesLoad()
  const task = data.tasks.find((t) => t.id === normStr(id))
  if (!task) throw new Error('定时任务不存在')
  // 不等待完成：直接在本进程内异步执行
  setTimeout(() => {
    runTaskNow(task).catch(() => { /* 失败已写审计与本地记录 */ })
  }, 0)
  return { started: true, id: task.id, type: task.type }
}

async function scheduleSetEnabled(payload) {
  const { ids, enabled } = payload || {}
  const wanted = Array.isArray(ids) ? ids.map(normStr).filter(Boolean) : []
  if (!wanted.length) throw new Error('请选择定时任务')
  const data = schedulesLoad()
  const on = enabled !== false
  const updated = []
  const failed = []
  for (const id of wanted) {
    const task = data.tasks.find((t) => t.id === id)
    if (!task) { failed.push({ id, message: '任务不存在' }); continue }
    task.enabled = on
    task.nextRunAt = on ? computeNextRun(task.schedule) : 0
    const res = await changeTaskState(task.id, on)
    if (!res.ok) failed.push({ id, message: res.stderr || 'schtasks 变更状态失败（本地状态已更新）' })
    updated.push(id)
  }
  schedulesSave(data)
  audit('schedule', 'scheduleUpdate', { ids: updated, enabled: on, failed: failed.length })
  return { updated: updated.length, enabled: on, failed }
}

function schedulePreview(payload) {
  const { schedule, params } = payload || {}
  const sched = normalizeSchedule(schedule)
  const next = computeNextRun(sched)
  const nextText = next ? `${tsText(next)}（${new Date(next).toLocaleString('zh-CN')}）` : '无法估算'
  // 复用真实注册逻辑，保证预览命令与实际写入计划程序的完全一致
  const real = buildCreateArgs({
    id: '<任务ID>',
    type: 'snapshot',
    schedule: sched,
    params: params && typeof params === 'object' ? params : {}
  })
  return {
    schedule: sched,
    description: describeSchedule(sched),
    nextRunAt: next,
    nextRunText: nextText,
    commandTemplate: `schtasks ${real.args.map((a) => (/[\s]/.test(a) ? `"${a}"` : a)).join(' ')}`,
    onlyIdle: !!params?.onlyIdle,
    catchUp: !!params?.catchUp,
    note: '到点后由 Windows 任务计划程序启动本程序并带 --scheduled-run 参数执行，任务本身只会做只读 / 备份类操作。'
  }
}

/* ============================== 通道注册 ============================== */

function register(handle, ctx) {
  void ctx

  /* ---------------------- A. 批量查找替换 ---------------------- */
  handle('regReplace:scan', async (e, payload) => replaceScan(payload))
  handle('regReplace:apply', async (e, payload) => replaceApply(payload))

  /* ---------------------- B. 注册表收藏夹 ---------------------- */
  handle('regFav:list', async () => {
    const data = favLoad()
    return { groups: data.groups, items: data.items }
  })

  handle('regFav:create', async (e, payload) => {
    const { name, path: rawPath, groupId, note } = payload || {}
    const title = normStr(name).trim()
    if (!title) throw new Error('收藏名称不能为空')
    const p = regsvc.parsePath(rawPath)
    if (!p.ok) throw new Error(p.message || '注册表路径不合法')
    const data = favLoad()
    const gid = normStr(groupId)
    if (gid && !data.groups.some((g) => g.id === gid)) throw new Error('收藏分组不存在')
    const item = {
      id: uid('fav'),
      name: title,
      path: p.full,
      groupId: gid,
      note: normStr(note),
      hidden: false,
      builtin: false
    }
    if (data.items.some((x) => normStr(x.path).toLowerCase() === item.path.toLowerCase() && x.groupId === gid)) {
      throw new Error('该路径已存在于同一分组下')
    }
    data.items.push(item)
    favSave(data)
    audit('registry', 'registryFavorite', { action: 'create', id: item.id, name: item.name, path: item.path })
    return item
  })

  handle('regFav:update', async (e, payload) => {
    const { id, name, groupId, note, hidden } = payload || {}
    const data = favLoad()
    const item = data.items.find((x) => x.id === normStr(id))
    if (!item) throw new Error('收藏项不存在')
    if (item.builtin) {
      // 内置项只允许改隐藏
      if (hidden !== undefined) item.hidden = !!hidden
      favSave(data)
      audit('registry', 'registryFavorite', { action: 'update', id: item.id, hidden: item.hidden, builtinOnly: true })
      return item
    }
    if (name !== undefined) {
      const title = normStr(name).trim()
      if (!title) throw new Error('收藏名称不能为空')
      item.name = title
    }
    if (groupId !== undefined) {
      const gid = normStr(groupId)
      if (gid && !data.groups.some((g) => g.id === gid)) throw new Error('收藏分组不存在')
      item.groupId = gid
    }
    if (note !== undefined) item.note = normStr(note)
    if (hidden !== undefined) item.hidden = !!hidden
    favSave(data)
    audit('registry', 'registryFavorite', { action: 'update', id: item.id, name: item.name })
    return item
  })

  handle('regFav:remove', async (e, payload) => {
    const { id } = payload || {}
    const data = favLoad()
    const item = data.items.find((x) => x.id === normStr(id))
    if (!item) throw new Error('收藏项不存在')
    if (item.builtin) throw new Error('系统预设收藏不能删除，可以隐藏')
    data.items = data.items.filter((x) => x.id !== item.id)
    favSave(data)
    audit('registry', 'registryFavorite', { action: 'remove', id: item.id, name: item.name })
    return { removed: 1, id: item.id }
  })

  handle('regFav:groups', async (e, payload) => {
    const { action, id, name } = payload || {}
    const data = favLoad()
    if (action === 'create') {
      const title = normStr(name).trim()
      if (!title) throw new Error('分组名称不能为空')
      if (data.groups.some((g) => g.name === title)) throw new Error('同名分组已存在')
      const group = { id: uid('grp'), name: title, builtin: false }
      data.groups.push(group)
      favSave(data)
      audit('registry', 'registryFavorite', { action: 'group-create', id: group.id, name: group.name })
      return group
    }
    if (action === 'rename') {
      const group = data.groups.find((g) => g.id === normStr(id))
      if (!group) throw new Error('分组不存在')
      if (group.builtin) throw new Error('内置分组不能重命名')
      const title = normStr(name).trim()
      if (!title) throw new Error('分组名称不能为空')
      group.name = title
      favSave(data)
      audit('registry', 'registryFavorite', { action: 'group-rename', id: group.id, name: group.name })
      return group
    }
    if (action === 'remove') {
      const group = data.groups.find((g) => g.id === normStr(id))
      if (!group) throw new Error('分组不存在')
      if (group.builtin) throw new Error('内置分组不能删除')
      data.groups = data.groups.filter((g) => g.id !== group.id)
      for (const item of data.items) {
        if (item.groupId === group.id) item.groupId = ''
      }
      favSave(data)
      audit('registry', 'registryFavorite', { action: 'group-remove', id: group.id, name: group.name })
      return { removed: 1, id: group.id }
    }
    throw new Error('不支持的分组操作，只允许 create / rename / remove')
  })

  handle('regFav:exportJson', async (e, payload) => favExportJson(payload))
  handle('regFav:importJson', async (e, payload) => favImportJson(payload))

  /* ---------------------- C. 全配置打包 ---------------------- */
  handle('configPack:exportPack', async (e, payload) => configPackExport(payload))
  handle('configPack:inspectPack', async (e, payload) => configPackInspect(payload))
  handle('configPack:importPack', async (e, payload) => configPackImport(payload))
  handle('configPack:pickSave', async () => configPackPickSave())
  handle('configPack:pickOpen', async () => configPackPickOpen())

  /* ---------------------- D. 环境健康诊断 ---------------------- */
  handle('health:scan', async () => healthScan())
  handle('health:previewFix', async (e, payload) => healthPreviewFix(payload))
  handle('health:applyFix', async (e, payload) => healthApplyFix(payload))
  handle('health:exportReport', async (e, payload) => healthExportReport(payload))
  handle('health:lastScore', async () => healthLastScore())

  /* ---------------------- E. 定时任务 ---------------------- */
  handle('schedule:list', async () => scheduleList())
  handle('schedule:create', async (e, payload) => scheduleCreate(payload))
  handle('schedule:update', async (e, payload) => scheduleUpdate(payload))
  handle('schedule:remove', async (e, payload) => scheduleRemove(payload))
  handle('schedule:runNow', async (e, payload) => scheduleRunNow(payload))
  handle('schedule:setEnabled', async (e, payload) => scheduleSetEnabled(payload))
  handle('schedule:preview', async (e, payload) => schedulePreview(payload))
}

/**
 * 供主进程 --scheduled-run 调用：按任务 ID 执行一次定时任务。
 * 只执行备份 / 扫描 / 导出类只读任务，类型白名单在 executeScheduleTask 内强校验。
 * @param {string} taskId
 */
async function runScheduledTask(taskId) {
  const data = schedulesLoad()
  const task = (data.tasks || []).find((t) => t.id === taskId)
  if (!task) throw new Error(`定时任务不存在：${taskId}`)
  if (task.enabled === false) throw new Error('该定时任务已禁用')
  const result = await executeScheduleTask(task)
  task.lastRunAt = Date.now()
  task.lastResult = { ok: true, at: Date.now(), detail: result }
  try {
    store.appendAudit({ origin: 'Scheduler', category: 'schedule', action: 'scheduleRun', taskId, name: task.name, type: task.type, ok: true })
  } catch { /* ignore */ }
  schedulesSave(data)
  return result
}

module.exports = { register, runScheduledTask }
