'use strict'
/**
 * 注册表模块 · 备份 / 恢复 / 对比 / 依赖分析 / 变更监控
 *
 * 通道（与 preload.js 白名单严格一致）：
 *   regBackup:list / create / preview / restore / remove / toggleProtect / exportFile / openDir / prune
 *   regDiff:compare / compareWithCurrent / exportReport / buildRollback
 *   regDep:analyze / findReferences / graph
 *   regWatch:list / add / remove / start / stop / logs / clearLogs / exportLogs
 *
 * 说明：
 * - 注册表读写一律走 lib/regsvc（已冻结），本文件不自己写 PowerShell。
 * - 返回值即纯数据，{ ok, data } 由 ipc/index.js 的 handle 统一包装。
 * - 数据目录：<appData>/registryBackup/ 与 <appData>/registryBackup/watch/。
 */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { dialog, shell, BrowserWindow, app } = require('electron')
const regsvc = require('../lib/regsvc')
const store = require('../lib/store')

/* ------------------------------ 常量 ------------------------------ */

const BACKUP_SUBDIR = 'registryBackup'
const WATCH_SUBDIR = 'watch'
const PREVIEW_LIMIT = 500
const SELF_WRITE_WINDOW = 10000
const DEFAULT_WATCH_INTERVAL = 3000
const MIN_WATCH_INTERVAL = 1000
const MAX_WATCH_INTERVAL = 600000
const WATCH_MAX_KEYS = 20000
const RESTORE_MAX_KEYS = 60000
/** 视为「本软件写入」的审计 action */
const SELF_WRITE_ACTIONS = new Set([
  'registryEditValue', 'registryCreateKey', 'registryDeleteValue', 'registryDeleteKey',
  'registryRestore', 'registryImportReg', 'registryBatchReplace'
])

/* --------------------------- 基础工具 --------------------------- */

function pad(n) {
  return String(n).padStart(2, '0')
}

function tsText(ms) {
  const d = new Date(Number(ms) || Date.now())
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function fileStamp(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function newId(prefix) {
  return `${prefix}-${fileStamp()}-${crypto.randomBytes(3).toString('hex')}`
}

function appVersion() {
  try {
    return String(app.getVersion() || '')
  } catch {
    return ''
  }
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex')
}

function fileSha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

/** 对象键按码点排序、数组保序、无空白的规范化 JSON（与 snapshot-file.js 一致） */
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
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}'
}

function safeReadJson(file) {
  try {
    if (!fs.existsSync(file)) return null
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function normTags(tags) {
  if (!Array.isArray(tags)) return []
  return tags.map((t) => String(t == null ? '' : t).trim()).filter(Boolean)
}

function normStr(v) {
  return v == null ? '' : String(v)
}

function sanitizeFileName(name, fallback) {
  const t = normStr(name).replace(/[\\/:*?"<>|\r\n\t]/g, '_').trim()
  return (t || fallback).slice(0, 80)
}

/** 两个注册表路径是否互为祖先/自身（大小写不敏感） */
function pathOverlap(a, b) {
  const x = normStr(a).replace(/[\\/]+$/, '').toLowerCase()
  const y = normStr(b).replace(/[\\/]+$/, '').toLowerCase()
  if (!x || !y) return false
  if (x === y) return true
  return x.startsWith(y + '\\') || y.startsWith(x + '\\')
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function escapeHtml(text) {
  return normStr(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function audit(action, detail) {
  try {
    store.appendAudit({ origin: 'GUI', category: 'registry', action, ...(detail || {}) })
  } catch { /* 审计失败不阻断主流程 */ }
}

function broadcastToWindows(channel, payload) {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win || win.isDestroyed()) continue
      try { win.webContents.send(channel, payload) } catch { /* 单个窗口失败不影响其他窗口 */ }
    }
  } catch { /* ignore */ }
}

/* --------------------------- 目录 --------------------------- */

function backupDir() {
  return store.ensureDir(path.join(store.appDataDir(), BACKUP_SUBDIR))
}

function watchDir() {
  return store.ensureDir(path.join(backupDir(), WATCH_SUBDIR))
}

function sidecarFile(dir, id) {
  return path.join(dir, `${id}.meta.json`)
}

/* --------------------------- 备份列表 --------------------------- */

function readSidecar(dir, id) {
  const data = safeReadJson(sidecarFile(dir, id))
  if (!data || typeof data !== 'object') return null
  return data
}

function writeSidecar(dir, id, meta) {
  store.ensureDir(dir)
  fs.writeFileSync(sidecarFile(dir, id), JSON.stringify(meta, null, 2), 'utf8')
}

/** 由主文件回落生成列表项（旁挂元数据缺失或损坏时） */
function fallbackEntry(filePath) {
  const base = path.basename(filePath)
  const ext = path.extname(base).toLowerCase()
  if (ext !== '.json' && ext !== '.reg') return null
  if (base.toLowerCase().endsWith('.meta.json')) return null
  const id = base.slice(0, base.length - ext.length)
  const format = ext === '.reg' ? 'reg' : 'json'
  let createdAt = Date.now()
  let size = 0
  try {
    const st = fs.statSync(filePath)
    createdAt = Math.round(st.mtimeMs)
    size = st.size
  } catch { /* ignore */ }
  let meta = null
  if (format === 'json') {
    try {
      const doc = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      if (doc && doc.meta && typeof doc.meta === 'object') meta = doc.meta
    } catch { /* 损坏文件按最小信息展示 */ }
  }
  return {
    id,
    name: meta ? normStr(meta.name) : id,
    note: meta ? normStr(meta.note) : '',
    tags: meta ? normTags(meta.tags) : [],
    path: meta ? normStr(meta.path) : '',
    format,
    file: filePath,
    size,
    sha256: meta ? normStr(meta.sha256) : '',
    createdAt: meta && Number(meta.createdAt) ? Number(meta.createdAt) : createdAt,
    createdAtText: tsText(meta && Number(meta.createdAt) ? Number(meta.createdAt) : createdAt),
    protected: !!(meta && meta.protected),
    keyCount: meta && Number(meta.keyCount) ? Number(meta.keyCount) : 0,
    truncated: !!(meta && meta.truncated)
  }
}

function listBackups() {
  const dir = backupDir()
  let names = []
  try {
    names = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
  } catch {
    return []
  }
  const out = []
  const seen = new Set()
  const ids = new Set()
  for (const name of names) {
    const lower = name.toLowerCase()
    if (lower.endsWith('.meta.json')) {
      ids.add(name.slice(0, name.length - '.meta.json'.length))
    } else if (lower.endsWith('.json') || lower.endsWith('.reg')) {
      ids.add(name.slice(0, name.length - path.extname(name).length))
    }
  }
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    const meta = readSidecar(dir, id)
    if (meta && meta.file && fs.existsSync(meta.file)) {
      const createdAt = Number(meta.createdAt) || 0
      out.push({
        id,
        name: normStr(meta.name) || id,
        note: normStr(meta.note),
        tags: normTags(meta.tags),
        path: normStr(meta.path),
        format: meta.format === 'reg' ? 'reg' : 'json',
        file: meta.file,
        size: Number(meta.size) || 0,
        sha256: normStr(meta.sha256),
        createdAt,
        createdAtText: tsText(createdAt),
        protected: !!meta.protected,
        keyCount: Number(meta.keyCount) || 0,
        truncated: !!meta.truncated
      })
      continue
    }
    const main = [path.join(dir, `${id}.json`), path.join(dir, `${id}.reg`)].find((f) => fs.existsSync(f))
    if (!main) continue
    const entry = fallbackEntry(main)
    if (entry) out.push(entry)
  }
  out.sort((a, b) => b.createdAt - a.createdAt)
  return out
}

/** 解析 id 对应的主文件与旁挂元数据 */
function resolveBackup(id) {
  const sid = normStr(id).trim()
  if (!sid) throw new Error('缺少备份 id')
  if (/[\\/]/.test(sid) || sid.includes('..')) throw new Error('备份 id 不合法')
  let meta = readSidecar(backupDir(), sid)
  let file = meta && meta.file ? String(meta.file) : ''
  if (!file || !fs.existsSync(file)) {
    const candidates = [path.join(backupDir(), `${sid}.json`), path.join(backupDir(), `${sid}.reg`)]
    file = candidates.find((f) => fs.existsSync(f)) || ''
  }
  if (!file) throw new Error('备份不存在或已被删除')
  const format = file.toLowerCase().endsWith('.reg') ? 'reg' : 'json'
  if (!meta) meta = readSidecar(path.dirname(file), sid)
  return { id: sid, meta: meta || null, file, format }
}

/** 读取备份内容；verify=true 时校验文件 SHA256 与内部 digest */
async function loadBackup(id, options = {}) {
  const { id: sid, meta, file, format } = resolveBackup(id)
  const verify = options.verify !== false

  let actual = ''
  try {
    actual = fileSha256(file)
  } catch {
    throw new Error('备份文件无法读取，可能已被删除或占用')
  }

  if (verify && meta && meta.sha256 && meta.sha256 !== actual) {
    throw new Error('备份文件校验失败，可能已被篡改或损坏')
  }

  if (format === 'reg') {
    const parsed = await regsvc.parseRegFile(file)
    const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : []
    const merged = { ...(meta || {}) }
    if (!merged.path) merged.path = commonRoot(nodes)
    merged.id = sid
    merged.format = 'reg'
    merged.sha256 = actual
    return { id: sid, meta: merged, nodes, file, format, sha256: actual }
  }

  let doc = null
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    throw new Error('备份文件格式不正确，无法解析（可能已损坏）')
  }
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.nodes)) {
    throw new Error('备份文件格式不正确，缺少 nodes 数据')
  }
  const integ = doc.integrity
  if (verify && integ && integ.alg === 'sha256' && integ.digest) {
    const digest = sha256Hex(canonicalJson({ meta: doc.meta, nodes: doc.nodes }))
    if (digest !== integ.digest) throw new Error('备份文件校验失败，可能已被篡改或损坏')
  }
  const merged = { ...(doc.meta || {}), ...(meta || {}) }
  merged.id = sid
  merged.format = 'json'
  merged.sha256 = actual
  merged.keyCount = Number(merged.keyCount) || doc.nodes.length
  merged.truncated = !!merged.truncated
  return { id: sid, meta: merged, nodes: doc.nodes, file, format, sha256: actual }
}

/** 备份节点没有 meta.path 时（如 .reg），用公共前缀推断根路径 */
function commonRoot(nodes) {
  const paths = (nodes || []).map((n) => normStr(n.path)).filter(Boolean)
  if (!paths.length) return ''
  const split = paths.map((p) => p.split('\\'))
  const first = split[0]
  const out = []
  for (let i = 0; i < first.length; i += 1) {
    const seg = first[i]
    if (!split.every((parts) => parts[i] && parts[i].toLowerCase() === seg.toLowerCase())) break
    out.push(seg)
  }
  return out.length >= 2 ? out.join('\\') : first.slice(0, 2).join('\\')
}

/* --------------------------- 创建备份 --------------------------- */

async function createBackup(options) {
  const opts = options || {}
  const parsed = regsvc.parsePath(normStr(opts.path))
  if (!parsed.ok) throw new Error(parsed.message)

  const format = opts.format === 'reg' ? 'reg' : 'json'
  let tree
  try {
    tree = await regsvc.readTree(parsed.full, { maxKeys: RESTORE_MAX_KEYS })
  } catch (err) {
    throw new Error(`读取注册表分支失败：${(err && err.message) || '未知错误'}`)
  }

  const id = newId('rb')
  const createdAt = Date.now()
  const targetDir = opts.dir && String(opts.dir).trim()
    ? store.ensureDir(String(opts.dir).trim())
    : backupDir()
  const name = normStr(opts.name).trim() || `${parsed.full} 备份`
  const meta = {
    id,
    name,
    note: normStr(opts.note),
    tags: normTags(opts.tags),
    path: parsed.full,
    createdAt,
    createdAtText: tsText(createdAt),
    appVersion: appVersion(),
    keyCount: tree.nodes.length,
    truncated: !!tree.truncated
  }

  let file = ''
  if (format === 'json') {
    file = path.join(targetDir, `${id}.json`)
    const body = { meta, nodes: tree.nodes }
    const digest = sha256Hex(canonicalJson(body))
    const doc = { meta, nodes: tree.nodes, integrity: { alg: 'sha256', digest } }
    const text = opts.compress ? JSON.stringify(doc) : JSON.stringify(doc, null, 2)
    try {
      fs.writeFileSync(file, text, 'utf8')
    } catch (err) {
      throw new Error(`写入备份文件失败：${(err && err.message) || '未知错误'}`)
    }
  } else {
    file = path.join(targetDir, `${id}.reg`)
    await regsvc.exportReg(tree.nodes, file, { encoding: opts.encoding === 'ansi' ? 'ansi' : 'utf8' })
  }

  let sha256 = ''
  let size = 0
  try {
    sha256 = fileSha256(file)
    size = fs.statSync(file).size
  } catch (err) {
    throw new Error(`备份文件写入后无法读取：${(err && err.message) || '未知错误'}`)
  }

  const sidecar = {
    ...meta,
    format,
    file,
    size,
    sha256,
    protected: false,
    compress: !!opts.compress
  }
  // 旁挂元数据固定放在统一备份目录，即使主文件写到自定义 dir 也能被列表 / 预览 / 恢复找到
  try {
    writeSidecar(backupDir(), id, sidecar)
  } catch { /* 旁挂元数据写失败时，列表回落到主文件内 meta */ }

  return { id, file, sha256, keyCount: meta.keyCount, size, meta: sidecar, nodes: tree.nodes, truncated: !!tree.truncated }
}

/* --------------------------- 值索引 / 比较 --------------------------- */

function valueKey(keyPath, name) {
  return `${normStr(keyPath).toLowerCase()}\u0000${normStr(name).toLowerCase()}`
}

/** 把 readTree 的 nodes 摊平成 Map，便于按「路径 + 键名」比较 */
function flattenNodes(nodes) {
  const map = new Map()
  const keys = new Set()
  for (const node of nodes || []) {
    const p = regsvc.parsePath(node.path)
    const full = p.ok ? p.full : normStr(node.path)
    if (!full) continue
    keys.add(full.toLowerCase())
    for (const v of node.values || []) {
      map.set(valueKey(full, v.name), {
        path: full,
        name: normStr(v.name),
        type: normStr(v.type) || 'REG_SZ',
        value: normStr(v.value),
        binary: normStr(v.binary)
      })
    }
  }
  return { map, keys }
}

function sameValue(a, b) {
  if (normStr(a.type).toUpperCase() !== normStr(b.type).toUpperCase()) return false
  if (normStr(a.type).toUpperCase() === 'REG_BINARY') {
    return sha256Hex(normStr(a.binary || a.value)) === sha256Hex(normStr(b.binary || b.value))
  }
  return normStr(a.value) === normStr(b.value)
}

function diffIndexes(base, target) {
  const rows = []
  for (const [key, item] of target) {
    const old = base.get(key)
    if (!old) {
      rows.push({
        path: item.path,
        name: item.name,
        type: item.type,
        oldValue: '',
        newValue: item.value,
        changeType: 'added'
      })
      continue
    }
    if (!sameValue(old, item)) {
      const isBinary = normStr(item.type).toUpperCase() === 'REG_BINARY'
      const row = {
        path: item.path,
        name: item.name,
        type: item.type,
        oldValue: old.value,
        newValue: item.value,
        changeType: 'modified'
      }
      if (isBinary && sha256Hex(normStr(old.binary || old.value)) !== sha256Hex(normStr(item.binary || item.value))) {
        row.binaryChanged = true
      }
      rows.push(row)
    }
  }
  for (const [key, item] of base) {
    if (target.has(key)) continue
    rows.push({
      path: item.path,
      name: item.name,
      type: item.type,
      oldValue: item.value,
      newValue: '',
      changeType: 'deleted'
    })
  }
  rows.sort((a, b) => {
    const x = `${a.path}\u0000${a.name}`.toLowerCase()
    const y = `${b.path}\u0000${b.name}`.toLowerCase()
    return x < y ? -1 : x > y ? 1 : 0
  })
  return rows
}

function diffStats(rows) {
  const stats = { added: 0, modified: 0, deleted: 0, total: rows.length }
  for (const r of rows) {
    if (r.changeType === 'added') stats.added += 1
    else if (r.changeType === 'modified') stats.modified += 1
    else if (r.changeType === 'deleted') stats.deleted += 1
  }
  return stats
}

function backupBrief(loaded) {
  const m = loaded.meta || {}
  return {
    id: loaded.id,
    name: normStr(m.name) || loaded.id,
    path: normStr(m.path),
    createdAt: Number(m.createdAt) || 0
  }
}

/* --------------------------- 恢复计划 --------------------------- */

async function buildRestorePlan(regPath, baseNodes, baseTruncated) {
  const parsed = regsvc.parsePath(regPath)
  if (!parsed.ok) throw new Error(`备份中的注册表路径不合法：${parsed.message}`)
  const tree = await regsvc.readTree(parsed.full, { maxKeys: RESTORE_MAX_KEYS })
  const cur = flattenNodes(tree.nodes)
  const base = flattenNodes(baseNodes)

  const changes = []
  for (const [key, item] of base.map) {
    const current = cur.map.get(key)
    if (!current) {
      changes.push({
        path: item.path,
        name: item.name,
        type: item.type,
        before: '',
        after: item.value,
        action: 'create',
        beforeType: ''
      })
      continue
    }
    if (!sameValue(item, current)) {
      changes.push({
        path: item.path,
        name: item.name,
        type: item.type,
        before: current.value,
        after: item.value,
        action: 'update',
        beforeType: current.type
      })
    }
  }
  // 备份被截断时不能把「备份里没有」当成删除，否则会误删大量键值
  if (!baseTruncated) {
    for (const [key, item] of cur.map) {
      if (base.map.has(key)) continue
      changes.push({
        path: item.path,
        name: item.name,
        type: item.type,
        before: item.value,
        after: '',
        action: 'delete',
        beforeType: item.type
      })
    }
  }
  return { changes, currentTree: tree, skippedDeletes: !!baseTruncated }
}

/** 只保留规范字段，多余的 beforeType 不给前端 */
function publicChanges(changes) {
  return changes.map((c) => ({
    path: c.path, name: c.name, type: c.type, before: c.before, after: c.after, action: c.action
  }))
}

/* --------------------------- 监控（内存态） --------------------------- */

const watchers = new Map()
/** 本进程最近写入的注册表路径：path(小写) => 写入时间 */
const lastSelfWrite = new Map()

function markSelfWrite(regPath) {
  const key = normStr(regPath).replace(/[\\/]+$/, '').toLowerCase()
  if (key) lastSelfWrite.set(key, Date.now())
}

function isSelfWrite(regPath) {
  const now = Date.now()
  for (const [key, at] of lastSelfWrite) {
    if (now - at > SELF_WRITE_WINDOW) { lastSelfWrite.delete(key); continue }
    if (pathOverlap(key, regPath)) return true
  }
  // 其他模块（registry.js / reg-extra.js）写入时不经过本文件，用审计日志兜底判断
  try {
    const rows = store.listAudit(150)
    for (const row of rows) {
      if (!row || row.category !== 'registry') continue
      if (!SELF_WRITE_ACTIONS.has(row.action)) continue
      if (now - (Number(row.at) || 0) > SELF_WRITE_WINDOW) continue
      if (pathOverlap(normStr(row.path), regPath)) return true
    }
  } catch { /* 审计不可读时按外部处理 */ }
  return false
}

function watchLogFile(d = new Date()) {
  return path.join(watchDir(), `watch-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.jsonl`)
}

function appendWatchLogs(records) {
  if (!records || !records.length) return
  try {
    const text = records.map((r) => JSON.stringify(r)).join('\n') + '\n'
    fs.appendFileSync(watchLogFile(), text, 'utf8')
  } catch { /* 写日志失败不影响监控 */ }
}

function snapshotWatchState(tree, options) {
  const ignore = new Set((options.ignoreNames || []).map((n) => normStr(n).toLowerCase()))
  const { map, keys } = flattenNodes(tree.nodes)
  const values = new Map()
  for (const [key, item] of map) {
    if (ignore.has(item.name.toLowerCase())) continue
    values.set(key, item)
  }
  return { keys, values, at: Date.now() }
}

function diffWatchState(baseline, next, options) {
  const changes = []
  if (options.watchValues === false) {
    for (const key of next.keys) {
      if (baseline.keys.has(key)) continue
      changes.push({ path: key, name: '', changeType: 'added', oldValue: '', newValue: '' })
    }
    for (const key of baseline.keys) {
      if (next.keys.has(key)) continue
      changes.push({ path: key, name: '', changeType: 'deleted', oldValue: '', newValue: '' })
    }
    return changes
  }
  for (const [key, item] of next.values) {
    const old = baseline.values.get(key)
    if (!old) {
      changes.push({
        path: item.path, name: item.name, changeType: 'added', oldValue: '', newValue: item.value
      })
      continue
    }
    if (!sameValue(old, item)) {
      changes.push({
        path: item.path, name: item.name, changeType: 'modified', oldValue: old.value, newValue: item.value
      })
    }
  }
  for (const [key, item] of baseline.values) {
    if (next.values.has(key)) continue
    changes.push({
      path: item.path, name: item.name, changeType: 'deleted', oldValue: item.value, newValue: ''
    })
  }
  return changes
}

async function tickWatcher(watcher) {
  if (!watcher || !watcher.running || watcher.busy) return
  watcher.busy = true
  try {
    const tree = await regsvc.readTree(watcher.path, { maxKeys: WATCH_MAX_KEYS })
    const next = snapshotWatchState(tree, watcher.options)
    const changes = diffWatchState(watcher.baseline, next, watcher.options)
    watcher.baseline = next
    watcher.baselineAt = next.at
    watcher.failCount = 0
    watcher.lastError = ''
    if (!changes.length) return

    watcher.eventCount += changes.length
    const origin = isSelfWrite(watcher.path) ? 'WinEnv管家' : '外部'
    const at = Date.now()
    const capped = changes.slice(0, 500)
    const records = capped.map((c) => ({
      at,
      atText: tsText(at),
      path: c.path,
      changeType: c.changeType,
      name: c.name,
      oldValue: c.oldValue,
      newValue: c.newValue,
      origin
    }))
    appendWatchLogs(records)
    audit('registryWatchEvent', {
      path: watcher.path,
      count: changes.length,
      origin,
      sample: capped.slice(0, 20).map((c) => ({ path: c.path, name: c.name, changeType: c.changeType }))
    })
    broadcastToWindows('reg:external-changed', { path: watcher.path, changes: capped })
  } catch (err) {
    watcher.failCount = (watcher.failCount || 0) + 1
    watcher.lastError = (err && err.message) || String(err)
    // 连续失败（路径被删、权限变化等）达到阈值后自动停止，避免无意义地反复起 PowerShell
    if (watcher.failCount >= 20) {
      watcher.running = false
      if (watcher.timer) clearInterval(watcher.timer)
      watcher.timer = null
    }
  } finally {
    watcher.busy = false
  }
}

function startWatcher(watcher) {
  if (!watcher) return
  if (watcher.timer) clearInterval(watcher.timer)
  watcher.running = true
  watcher.failCount = 0
  watcher.timer = setInterval(() => { tickWatcher(watcher) }, watcher.interval)
  if (watcher.timer && typeof watcher.timer.unref === 'function') watcher.timer.unref()
}

function stopWatcher(watcher) {
  if (!watcher) return
  watcher.running = false
  if (watcher.timer) clearInterval(watcher.timer)
  watcher.timer = null
}

function findWatcher(regPath) {
  const key = normStr(regPath).trim().toLowerCase()
  if (!key) return null
  return watchers.get(key) || null
}

/* --------------------------- 报告导出 --------------------------- */

const CHANGE_LABEL = { added: '新增', modified: '修改', deleted: '删除' }
const CHANGE_COLOR = { added: '#00b42a', modified: '#ff7d00', deleted: '#f53f3f' }

function csvCell(value) {
  const text = normStr(value)
  return `"${text.replace(/"/g, '""')}"`
}

function buildCompareCsv(rows) {
  const header = ['变更类型', '注册表路径', '键名', '类型', '旧值', '新值', '二进制变化']
  const lines = [header.map(csvCell).join(',')]
  for (const r of rows || []) {
    lines.push([
      CHANGE_LABEL[r.changeType] || normStr(r.changeType),
      normStr(r.path),
      normStr(r.name) || '(默认)',
      normStr(r.type),
      normStr(r.oldValue),
      normStr(r.newValue),
      r.binaryChanged ? '是' : ''
    ].map(csvCell).join(','))
  }
  return '\ufeff' + lines.join('\r\n') + '\r\n'
}

function buildCompareHtml(rows, stats, labels) {
  const list = Array.isArray(rows) ? rows : []
  const head = labels || {}
  const cards = [
    { key: 'added', label: '新增', value: stats.added },
    { key: 'modified', label: '修改', value: stats.modified },
    { key: 'deleted', label: '删除', value: stats.deleted },
    { key: 'total', label: '合计', value: stats.total }
  ].map((c) => {
    const color = CHANGE_COLOR[c.key] || '#165DFF'
    return `<div class="card"><div class="num" style="color:${color}">${c.value}</div>` +
      `<div class="cap">${escapeHtml(c.label)}</div></div>`
  }).join('')

  const body = list.map((r) => {
    const color = CHANGE_COLOR[r.changeType] || '#4e5969'
    const label = CHANGE_LABEL[r.changeType] || ''
    return '<tr>' +
      `<td><span class="tag" style="color:${color};border-color:${color}">${escapeHtml(label)}</span></td>` +
      `<td class="mono">${escapeHtml(r.path)}</td>` +
      `<td>${escapeHtml(r.name) || '(默认)'}</td>` +
      `<td class="mono">${escapeHtml(r.type)}${r.binaryChanged ? '（二进制已变化）' : ''}</td>` +
      `<td class="old mono">${escapeHtml(r.oldValue)}</td>` +
      `<td class="new mono">${escapeHtml(r.newValue)}</td>` +
      '</tr>'
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>注册表备份对比报告</title>
<style>
  body { margin: 0; padding: 24px; font-family: "Microsoft YaHei", "Segoe UI", sans-serif; color: #1d2129; background: #f7f8fa; }
  h1 { font-size: 20px; margin: 0 0 6px; }
  .sub { color: #86909c; font-size: 12px; margin-bottom: 18px; }
  .cards { display: flex; gap: 12px; margin-bottom: 18px; flex-wrap: wrap; }
  .card { background: #fff; border: 1px solid #e5e6eb; border-radius: 8px; padding: 12px 20px; min-width: 92px; }
  .card .num { font-size: 22px; font-weight: 600; }
  .card .cap { color: #86909c; font-size: 12px; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e5e6eb; border-radius: 8px; overflow: hidden; }
  th, td { border-bottom: 1px solid #f2f3f5; padding: 8px 10px; font-size: 12px; text-align: left; vertical-align: top; }
  th { background: #fafafa; color: #4e5969; font-weight: 600; white-space: nowrap; }
  td.mono { font-family: Consolas, "Courier New", monospace; word-break: break-all; }
  td.old { color: #f53f3f; }
  td.new { color: #00b42a; }
  .tag { display: inline-block; border: 1px solid; border-radius: 10px; padding: 0 8px; font-size: 11px; line-height: 18px; }
  tr:hover td { background: #f9fafb; }
  .foot { color: #86909c; font-size: 12px; margin-top: 14px; }
</style>
</head>
<body>
<h1>注册表备份对比报告</h1>
<div class="sub">A（基准）：${escapeHtml(head.a || '')} &nbsp;→&nbsp; B（对比）：${escapeHtml(head.b || '')} &nbsp;|&nbsp; 生成时间：${escapeHtml(tsText(Date.now()))}</div>
<div class="cards">${cards}</div>
<table>
<thead><tr><th>变更</th><th>注册表路径</th><th>键名</th><th>类型</th><th>旧值（A）</th><th>新值（B）</th></tr></thead>
<tbody>
${body || '<tr><td colspan="6" style="text-align:center;color:#86909c;padding:24px">没有差异</td></tr>'}
</tbody>
</table>
<div class="foot">由 WinEnv管家 生成 · 仅比较键值，不含注册表项本身的新增 / 删除 · 二进制值按哈希比对</div>
</body>
</html>`
}

/* --------------------------- 依赖分析 --------------------------- */

const REF_RE = /%([A-Za-z_][A-Za-z0-9_()]*?)%/g

function extractRefs(text) {
  const out = []
  const seen = new Set()
  const src = normStr(text)
  REF_RE.lastIndex = 0
  let m = REF_RE.exec(src)
  while (m) {
    const name = m[1]
    const key = name.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      out.push(name)
    }
    m = REF_RE.exec(src)
  }
  return out
}

/** 读取两个环境变量分支的键值（失败按空处理） */
async function readEnvScopes() {
  const paths = regsvc.envPaths()
  const user = new Map()
  const machine = new Map()
  const all = []

  try {
    for (const v of await regsvc.listValues(paths.user, { timeout: 20000 })) {
      user.set(v.name.toLowerCase(), { name: v.name, type: v.type, value: v.value })
      all.push({ scope: 'user', name: v.name, type: v.type, value: v.value })
    }
  } catch { /* 用户分支读不到就当作空 */ }
  try {
    for (const v of await regsvc.listValues(paths.machine, { timeout: 20000 })) {
      machine.set(v.name.toLowerCase(), { name: v.name, type: v.type, value: v.value })
      all.push({ scope: 'machine', name: v.name, type: v.type, value: v.value })
    }
  } catch { /* 系统分支可能需要权限 */ }
  return { user, machine, all, paths }
}

/** 在「变量 -> 引用变量」图上找环 */
function findCycles(graph) {
  const cycles = []
  const state = new Map()
  const stack = []
  const seen = new Set()

  const walk = (node) => {
    state.set(node, 1)
    stack.push(node)
    for (const next of graph.get(node) || []) {
      const s = state.get(next) || 0
      if (s === 0) walk(next)
      else if (s === 1) {
        const idx = stack.indexOf(next)
        if (idx >= 0) {
          const cycle = stack.slice(idx)
          const key = [...cycle].map((n) => n.toUpperCase()).sort().join('|')
          if (!seen.has(key)) {
            seen.add(key)
            cycles.push(cycle)
          }
        }
      }
    }
    stack.pop()
    state.set(node, 2)
  }

  for (const node of graph.keys()) {
    if ((state.get(node) || 0) === 0) walk(node)
  }
  return cycles
}

/** 变量依赖图（仅 REG_SZ / REG_EXPAND_SZ），用于成环检测 */
function buildVarGraph(entries) {
  const graph = new Map()
  const byName = new Map()
  for (const e of entries) {
    if (e.type !== 'REG_SZ' && e.type !== 'REG_EXPAND_SZ') continue
    byName.set(e.name.toLowerCase(), e)
  }
  for (const [key, e] of byName) {
    const refs = extractRefs(e.value).filter((r) => byName.has(r.toLowerCase()))
    graph.set(key, refs.map((r) => r.toLowerCase()))
  }
  return { graph, byName }
}

/* --------------------------- register --------------------------- */

function register(handle) {
  /* ========================= A. 备份管理 ========================= */

  handle('regBackup:list', async () => listBackups())

  handle('regBackup:create', async (event, payload) => {
    const { path: regPath, name, note, tags, format, dir, compress } = payload || {}
    if (!normStr(regPath).trim()) throw new Error('注册表路径不能为空')
    const created = await createBackup({ path: regPath, name, note, tags, format, dir, compress })
    audit('registryBackup', {
      id: created.id,
      path: created.meta.path,
      name: created.meta.name,
      format: created.meta.format,
      keyCount: created.keyCount,
      truncated: created.truncated,
      size: created.size,
      sha256: created.sha256,
      file: created.file
    })
    return { id: created.id, file: created.file, sha256: created.sha256, keyCount: created.keyCount, size: created.size }
  })

  handle('regBackup:preview', async (event, payload) => {
    const { id } = payload || {}
    const loaded = await loadBackup(id, { verify: true })
    const nodes = loaded.nodes || []
    let valueCount = 0
    const pathSet = []
    const seenPath = new Set()
    for (const node of nodes) {
      valueCount += (node.values || []).length
      const key = normStr(node.path).toLowerCase()
      if (key && !seenPath.has(key)) {
        seenPath.add(key)
        if (pathSet.length < 200) pathSet.push(node.path)
      }
    }
    return {
      meta: loaded.meta,
      nodes: nodes.slice(0, PREVIEW_LIMIT),
      total: nodes.length,
      summary: { keyCount: nodes.length, valueCount, paths: pathSet }
    }
  })

  handle('regBackup:restore', async (event, payload) => {
    const { id, dryRun } = payload || {}
    const loaded = await loadBackup(id, { verify: true })
    const regPath = normStr(loaded.meta.path)
    if (!regPath) throw new Error('备份元数据缺少注册表路径，无法恢复')

    const { changes, skippedDeletes } = await buildRestorePlan(regPath, loaded.nodes, !!loaded.meta.truncated)
    if (dryRun === true) {
      return {
        changes: publicChanges(changes),
        summary: {
          create: changes.filter((c) => c.action === 'create').length,
          update: changes.filter((c) => c.action === 'update').length,
          delete: changes.filter((c) => c.action === 'delete').length,
          total: changes.length,
          skippedDeletes
        }
      }
    }

    // 1) 恢复前临时保底备份（失败则整体取消，绝不裸写）
    let safety
    try {
      safety = await createBackup({
        path: regPath,
        name: `RestoreBackup-${fileStamp()}`,
        note: `恢复「${loaded.meta.name || id}」前自动生成，用于回滚`,
        tags: ['自动'],
        format: 'json'
      })
    } catch (err) {
      throw new Error(`无法创建恢复前临时保底备份，已取消恢复：${(err && err.message) || '未知错误'}`)
    }

    if (!changes.length) {
      await regsvc.broadcastRegistryChange()
      audit('registryRestore', { id, path: regPath, applied: 0, safetyBackup: safety.id })
      return { applied: 0, rolledBack: 0, rollbackFailed: 0 }
    }

    markSelfWrite(regPath)

    const applied = []
    let failure = null
    for (const change of changes) {
      try {
        if (change.action === 'delete') {
          await regsvc.deleteValue(change.path, change.name)
          applied.push({ change, undo: { kind: 'set', path: change.path, name: change.name, type: change.beforeType || change.type, value: change.before } })
        } else {
          await regsvc.setValue(change.path, change.name, change.type, change.after)
          applied.push({
            change,
            undo: change.action === 'create'
              ? { kind: 'delete', path: change.path, name: change.name }
              : { kind: 'set', path: change.path, name: change.name, type: change.beforeType || change.type, value: change.before }
          })
        }
      } catch (err) {
        failure = { change, message: (err && err.message) || '写入失败' }
        break
      }
    }

    markSelfWrite(regPath)

    if (failure) {
      let rollbackFailed = 0
      for (const item of [...applied].reverse()) {
        try {
          if (item.undo.kind === 'delete') await regsvc.deleteValue(item.undo.path, item.undo.name)
          else await regsvc.setValue(item.undo.path, item.undo.name, item.undo.type, item.undo.value)
        } catch {
          rollbackFailed += 1
        }
      }
      markSelfWrite(regPath)
      await regsvc.broadcastRegistryChange().catch(() => false)
      audit('registryRestoreRolledBack', {
        id,
        path: regPath,
        failedPath: failure.change.path,
        failedName: failure.change.name,
        message: failure.message,
        applied: applied.length,
        rollbackFailed,
        safetyBackup: safety.id
      })
      throw new Error(
        `恢复「${failure.change.path}${failure.change.name ? '\\' + failure.change.name : ''}」失败：${failure.message}。` +
        `已回滚 ${applied.length - rollbackFailed} 项` +
        (rollbackFailed ? `，另有 ${rollbackFailed} 项回滚未成功` : '') +
        `。恢复前临时备份已保留：${safety.meta.name}`
      )
    }

    await regsvc.broadcastRegistryChange().catch(() => false)
    audit('registryRestore', {
      id,
      path: regPath,
      applied: applied.length,
      created: applied.filter((a) => a.change.action === 'create').length,
      updated: applied.filter((a) => a.change.action === 'update').length,
      deleted: applied.filter((a) => a.change.action === 'delete').length,
      safetyBackup: safety.id
    })
    return { applied: applied.length, rolledBack: 0, rollbackFailed: 0 }
  })

  handle('regBackup:remove', async (event, payload) => {
    const raw = Array.isArray(payload) ? payload : (payload && payload.ids)
    const ids = Array.isArray(raw) ? raw.map((x) => normStr(x).trim()).filter(Boolean) : []
    if (!ids.length) throw new Error('请选择要删除的备份')
    let removed = 0
    const skipped = []
    for (const id of ids) {
      try {
        const { meta, file } = resolveBackup(id)
        if (meta && meta.protected) {
          skipped.push({ id, reason: '受保护' })
          continue
        }
        try { fs.rmSync(file, { force: true }) } catch (err) {
          skipped.push({ id, reason: `删除失败：${(err && err.message) || '文件被占用'}` })
          continue
        }
        try { fs.rmSync(sidecarFile(backupDir(), id), { force: true }) } catch { /* ignore */ }
        removed += 1
      } catch (err) {
        skipped.push({ id, reason: (err && err.message) || '备份不存在' })
      }
    }
    return { removed, skipped }
  })

  handle('regBackup:toggleProtect', async (event, payload) => {
    const { id, protected: prot } = payload || {}
    const sid = normStr(id).trim()
    if (!sid) throw new Error('缺少备份 id')
    const { meta, file } = resolveBackup(sid)
    const next = { ...(meta || {}) }
    next.id = sid
    next.protected = prot === true
    next.format = meta && meta.format ? meta.format : (file.toLowerCase().endsWith('.reg') ? 'reg' : 'json')
    next.file = file
    if (!next.name) next.name = sid
    if (!next.createdAt) next.createdAt = Math.round(fs.statSync(file).mtimeMs)
    writeSidecar(backupDir(), sid, next)
    return { id: sid, protected: next.protected }
  })

  handle('regBackup:exportFile', async (event, payload) => {
    const { id } = payload || {}
    const { meta, file, format } = resolveBackup(id)
    const base = sanitizeFileName(meta && meta.name, path.basename(file, path.extname(file)))
    const ext = format === 'reg' ? 'reg' : 'json'
    const res = await dialog.showSaveDialog({
      title: '导出注册表备份',
      defaultPath: `${base}.${ext}`,
      filters: ext === 'reg'
        ? [{ name: '注册表文件', extensions: ['reg'] }]
        : [{ name: 'JSON 文件', extensions: ['json'] }]
    })
    if (res.canceled || !res.filePath) return { file: '' }
    try {
      fs.copyFileSync(file, res.filePath)
    } catch (err) {
      throw new Error(`导出失败：${(err && err.message) || '无法写入目标文件'}`)
    }
    return { file: res.filePath }
  })

  handle('regBackup:openDir', async () => {
    const dir = backupDir()
    const err = await shell.openPath(dir)
    if (err) throw new Error(`无法打开备份目录：${err}`)
    return { dir }
  })

  handle('regBackup:prune', async (event, payload) => {
    const raw = payload && typeof payload === 'object' ? payload.keep : payload
    const keepNum = Number(raw)
    const keep = Number.isFinite(keepNum) && keepNum > 0 ? Math.floor(keepNum) : 20
    const list = listBackups()
    let removed = 0
    for (const item of list.slice(Math.max(0, keep))) {
      if (item.protected) continue
      try {
        fs.rmSync(item.file, { force: true })
      } catch {
        continue
      }
      try { fs.rmSync(sidecarFile(backupDir(), item.id), { force: true }) } catch { /* ignore */ }
      removed += 1
    }
    return { removed }
  })

  /* ========================= B. 对比 ========================= */

  handle('regDiff:compare', async (event, payload) => {
    const { aId, bId } = payload || {}
    if (!normStr(aId) || !normStr(bId)) throw new Error('请选择两个备份进行对比')
    const a = await loadBackup(aId, { verify: true })
    const b = await loadBackup(bId, { verify: true })
    const rows = diffIndexes(flattenNodes(a.nodes).map, flattenNodes(b.nodes).map)
    const stats = diffStats(rows)
    audit('registryCompare', {
      mode: 'backup',
      aId: a.id,
      bId: b.id,
      aPath: normStr(a.meta.path),
      bPath: normStr(b.meta.path),
      stats
    })
    return { a: backupBrief(a), b: backupBrief(b), stats, rows }
  })

  handle('regDiff:compareWithCurrent', async (event, payload) => {
    const { id, path: pathOverride } = payload || {}
    const loaded = await loadBackup(id, { verify: true })
    const target = normStr(pathOverride).trim() || normStr(loaded.meta.path)
    if (!target) throw new Error('缺少对比的注册表路径')
    const parsed = regsvc.parsePath(target)
    if (!parsed.ok) throw new Error(parsed.message)

    let tree
    try {
      tree = await regsvc.readTree(parsed.full, { maxKeys: RESTORE_MAX_KEYS })
    } catch (err) {
      throw new Error(`读取当前注册表失败：${(err && err.message) || '未知错误'}`)
    }

    const rows = diffIndexes(flattenNodes(loaded.nodes).map, flattenNodes(tree.nodes).map)
    const stats = diffStats(rows)
    audit('registryCompare', { mode: 'current', aId: loaded.id, bPath: parsed.full, stats })
    return {
      a: backupBrief(loaded),
      b: {
        id: 'current',
        name: '当前注册表',
        path: parsed.full,
        createdAt: Date.now()
      },
      stats,
      rows
    }
  })

  handle('regDiff:exportReport', async (event, payload) => {
    const { rows, format, file, labels } = payload || {}
    const list = Array.isArray(rows) ? rows : []
    const kind = format === 'csv' ? 'csv' : 'html'
    const stats = diffStats(list)

    let target = normStr(file).trim()
    if (!target) {
      const res = await dialog.showSaveDialog({
        title: '导出对比报告',
        defaultPath: `注册表对比-${fileStamp()}.${kind}`,
        filters: kind === 'csv'
          ? [{ name: 'CSV 文件', extensions: ['csv'] }]
          : [{ name: 'HTML 文件', extensions: ['html'] }]
      })
      if (res.canceled || !res.filePath) return { file: '' }
      target = res.filePath
    }

    const content = kind === 'csv'
      ? buildCompareCsv(list)
      : buildCompareHtml(list, stats, labels)
    try {
      store.ensureDir(path.dirname(target))
      fs.writeFileSync(target, content, 'utf8')
    } catch (err) {
      throw new Error(`报告写入失败：${(err && err.message) || '目标路径不可写'}`)
    }
    return { file: target, format: kind, size: fs.statSync(target).size, stats }
  })

  handle('regDiff:buildRollback', async (event, payload) => {
    const raw = Array.isArray(payload) ? payload : (payload && payload.rows)
    const rows = Array.isArray(raw) ? raw : []
    if (!rows.length) throw new Error('没有可回滚的差异行')
    const out = []
    for (const row of rows) {
      const type = normStr(row.type) || 'REG_SZ'
      if (row.changeType === 'added') {
        out.push({ path: normStr(row.path), name: normStr(row.name), type, value: '', action: 'delete' })
      } else if (row.changeType === 'deleted') {
        out.push({ path: normStr(row.path), name: normStr(row.name), type, value: normStr(row.oldValue), action: 'create' })
      } else if (row.changeType === 'modified') {
        out.push({ path: normStr(row.path), name: normStr(row.name), type, value: normStr(row.oldValue), action: 'update' })
      }
    }
    return { rows: out }
  })

  /* ========================= C. 依赖分析 ========================= */

  handle('regDep:analyze', async (event, payload) => {
    const p = payload && typeof payload === 'object' ? payload : { path: payload }
    const target = normStr(p.path).trim()
    if (!target) throw new Error('请指定要分析的注册表路径')
    const parsed = regsvc.parsePath(target)
    if (!parsed.ok) throw new Error(parsed.message)
    const names = Array.isArray(p.names) ? p.names.map((n) => normStr(n).toLowerCase()).filter(Boolean) : []

    let values
    try {
      values = await regsvc.listValues(parsed.full, { timeout: 30000 })
    } catch (err) {
      throw new Error(`读取注册表键值失败：${(err && err.message) || '未知错误'}`)
    }

    const scopes = await readEnvScopes()
    const pick = names.length
      ? values.filter((v) => names.includes(normStr(v.name).toLowerCase()))
      : values

    const items = []
    const invalid = []
    for (const v of pick) {
      if (v.type !== 'REG_SZ' && v.type !== 'REG_EXPAND_SZ') continue
      const refs = extractRefs(v.value).map((name) => {
        const lower = name.toLowerCase()
        const hit = scopes.user.get(lower) || scopes.machine.get(lower) || null
        const scope = scopes.user.has(lower) ? 'user' : (scopes.machine.has(lower) ? 'machine' : '')
        if (!hit) invalid.push({ path: parsed.full, name: v.name, ref: name })
        return {
          name,
          exists: !!hit,
          scope,
          value: hit ? normStr(hit.value) : ''
        }
      })
      items.push({ path: parsed.full, name: v.name, type: v.type, raw: normStr(v.value), refs })
    }

    const { graph } = buildVarGraph(scopes.all)
    const cycles = findCycles(graph).map((cycle) => cycle.map((k) => {
      const hit = scopes.user.get(k) || scopes.machine.get(k)
      return hit ? hit.name : k
    }))

    audit('registryDependency', {
      path: parsed.full,
      items: items.length,
      refs: items.reduce((n, it) => n + it.refs.length, 0),
      invalid: invalid.length,
      cycles: cycles.length
    })

    return { items, cycles, invalid }
  })

  handle('regDep:findReferences', async (event, payload) => {
    const p = payload && typeof payload === 'object' ? payload : { varName: payload }
    const varName = normStr(p.varName).trim().replace(/^%|%$/g, '')
    if (!varName) throw new Error('请指定要查找的变量名')
    const rootsIn = Array.isArray(p.roots) ? p.roots.map((r) => normStr(r).trim()).filter(Boolean) : []
    const roots = rootsIn.length ? rootsIn : ['HKCU\\Software']
    const exact = new RegExp(`%${escapeRegExp(varName)}%`, 'i')

    const results = []
    let scanned = 0
    let lastError = ''
    for (const root of roots) {
      let res
      try {
        res = await regsvc.search(root, `%${varName}%`, { scope: 'value', maxResults: 2000 })
      } catch (err) {
        lastError = (err && err.message) || ''
        continue
      }
      scanned += Number(res.scanned) || 0
      for (const row of res.results || []) {
        if (!row || !row.name) continue
        if (!exact.test(normStr(row.value))) continue
        results.push({ path: row.path, name: row.name, value: row.value })
      }
    }
    if (!results.length && scanned === 0 && lastError) {
      throw new Error(`搜索失败：${lastError}`)
    }
    return { results, scanned }
  })

  handle('regDep:graph', async (event, payload) => {
    const p = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : { items: payload }
    const items = Array.isArray(p.items) ? p.items : []
    const nodes = []
    const edges = []
    const seenNode = new Set()

    const addNode = (id, label, kind) => {
      if (seenNode.has(id)) return
      seenNode.add(id)
      nodes.push({ id, label, kind })
    }

    const varEdges = new Map()
    for (const item of items) {
      const keyId = `k:${normStr(item.path)}|${normStr(item.name)}`
      addNode(keyId, normStr(item.name) || '(默认)', 'key')
      const selfLower = normStr(item.name).toLowerCase()
      for (const ref of item.refs || []) {
        const lower = normStr(ref.name).toLowerCase()
        const varId = `v:${lower}`
        addNode(varId, normStr(ref.name), ref.exists ? 'var' : 'invalid')
        edges.push({ from: keyId, to: varId, kind: ref.exists ? 'ref' : 'invalid' })
        if (ref.exists) {
          const deps = varEdges.get(selfLower) || []
          deps.push({ to: lower, from: keyId })
          varEdges.set(selfLower, deps)
        }
      }
    }

    // 被分析项本身也是变量时，检查「变量 -> 引用变量」是否成环，成环的边单独标 cycle
    const graph = new Map()
    for (const [from, deps] of varEdges) {
      graph.set(from, deps.map((d) => d.to))
    }
    const cycles = findCycles(graph)
    const cycleEdge = new Set()
    const labelOf = new Map()
    for (const item of items) labelOf.set(normStr(item.name).toLowerCase(), normStr(item.name))
    for (const cycle of cycles) {
      for (let i = 0; i < cycle.length; i += 1) {
        const from = cycle[i]
        const to = cycle[(i + 1) % cycle.length]
        cycleEdge.add(`${from}>${to}`)
        // 环上的变量可能没出现在任何 refs 里，补建节点保证边两端都存在
        addNode(`v:${from}`, labelOf.get(from) || from, 'var')
        addNode(`v:${to}`, labelOf.get(to) || to, 'var')
      }
    }
    for (const [from, deps] of varEdges) {
      for (const dep of deps) {
        if (!cycleEdge.has(`${from}>${dep.to}`)) continue
        edges.push({ from: `v:${from}`, to: `v:${dep.to}`, kind: 'cycle' })
      }
    }

    return { nodes, edges, cycles }
  })

  /* ========================= D. 变更监控 ========================= */

  handle('regWatch:list', async () => {
    const list = []
    for (const w of watchers.values()) {
      list.push({
        path: w.path,
        running: !!w.running,
        interval: w.interval,
        baselineAt: w.baselineAt,
        eventCount: w.eventCount,
        watchValues: w.options.watchValues !== false,
        ignoreNames: w.options.ignoreNames || [],
        lastError: w.lastError || ''
      })
    }
    list.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    return { watchers: list }
  })

  handle('regWatch:add', async (event, payload) => {
    const p = payload && typeof payload === 'object' ? payload : { path: payload }
    const parsed = regsvc.parsePath(normStr(p.path))
    if (!parsed.ok) throw new Error(parsed.message)
    const key = parsed.full.toLowerCase()

    const rawInterval = Number(p.interval)
    const interval = Number.isFinite(rawInterval) && rawInterval > 0
      ? Math.min(MAX_WATCH_INTERVAL, Math.max(MIN_WATCH_INTERVAL, Math.floor(rawInterval)))
      : DEFAULT_WATCH_INTERVAL
    const options = {
      watchValues: p.watchValues !== false,
      ignoreNames: Array.isArray(p.ignoreNames) ? p.ignoreNames.map((n) => normStr(n)).filter(Boolean) : []
    }

    let tree
    try {
      tree = await regsvc.readTree(parsed.full, { maxKeys: WATCH_MAX_KEYS })
    } catch (err) {
      throw new Error(`无法监听该路径：${(err && err.message) || '注册表项不存在或不可读'}`)
    }

    const existing = watchers.get(key)
    if (existing) stopWatcher(existing)

    const watcher = {
      path: parsed.full,
      interval,
      options,
      baseline: snapshotWatchState(tree, options),
      baselineAt: Date.now(),
      eventCount: 0,
      running: false,
      busy: false,
      failCount: 0,
      lastError: '',
      timer: null
    }
    watchers.set(key, watcher)
    startWatcher(watcher)
    return { path: watcher.path, running: true, interval, baselineAt: watcher.baselineAt }
  })

  handle('regWatch:remove', async (event, payload) => {
    const { path: regPath } = payload || {}
    const watcher = findWatcher(regPath)
    if (!watcher) throw new Error('监听不存在')
    stopWatcher(watcher)
    watchers.delete(watcher.path.toLowerCase())
    return { path: watcher.path, removed: true }
  })

  handle('regWatch:start', async (event, payload) => {
    const { path: regPath } = payload || {}
    const watcher = findWatcher(regPath)
    if (!watcher) throw new Error('监听不存在，请先添加监听')
    if (watcher.running) return { path: watcher.path, running: true }
    let tree
    try {
      tree = await regsvc.readTree(watcher.path, { maxKeys: WATCH_MAX_KEYS })
    } catch (err) {
      throw new Error(`无法恢复监听：${(err && err.message) || '注册表项不可读'}`)
    }
    watcher.baseline = snapshotWatchState(tree, watcher.options)
    watcher.baselineAt = Date.now()
    watcher.failCount = 0
    watcher.lastError = ''
    startWatcher(watcher)
    audit('registryWatchStart', { path: watcher.path, interval: watcher.interval })
    return { path: watcher.path, running: true, baselineAt: watcher.baselineAt }
  })

  handle('regWatch:stop', async (event, payload) => {
    const { path: regPath } = payload || {}
    const watcher = findWatcher(regPath)
    if (!watcher) throw new Error('监听不存在')
    stopWatcher(watcher)
    audit('registryWatchStop', { path: watcher.path, eventCount: watcher.eventCount })
    return { path: watcher.path, running: false }
  })

  handle('regWatch:logs', async (event, payload) => {
    const p = payload || {}
    const limitRaw = Number(p.limit)
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(5000, Math.floor(limitRaw)) : 200
    const filterPath = normStr(p.path).trim()

    const dir = watchDir()
    let files = []
    try {
      files = fs.readdirSync(dir).filter((f) => /^watch-\d{8}\.jsonl$/i.test(f)).sort().reverse()
    } catch {
      return { rows: [] }
    }

    const rows = []
    for (const name of files) {
      if (rows.length >= limit) break
      let lines = []
      try {
        lines = fs.readFileSync(path.join(dir, name), 'utf8').split('\n').filter(Boolean)
      } catch {
        continue
      }
      for (let i = lines.length - 1; i >= 0 && rows.length < limit; i -= 1) {
        let row = null
        try { row = JSON.parse(lines[i]) } catch { continue }
        if (!row || typeof row !== 'object') continue
        if (filterPath && !pathOverlap(row.path, filterPath)) continue
        rows.push({
          at: Number(row.at) || 0,
          atText: normStr(row.atText) || tsText(row.at),
          path: normStr(row.path),
          changeType: normStr(row.changeType),
          name: normStr(row.name),
          oldValue: normStr(row.oldValue),
          newValue: normStr(row.newValue),
          origin: row.origin === 'WinEnv管家' ? 'WinEnv管家' : '外部'
        })
      }
    }
    rows.sort((a, b) => b.at - a.at)
    return { rows: rows.slice(0, limit) }
  })

  handle('regWatch:clearLogs', async () => {
    const dir = watchDir()
    let removed = 0
    try {
      for (const name of fs.readdirSync(dir)) {
        if (!/^watch-\d{8}\.jsonl$/i.test(name)) continue
        try { fs.rmSync(path.join(dir, name), { force: true }); removed += 1 } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    return { removed }
  })

  handle('regWatch:exportLogs', async (event, payload) => {
    const { format, file } = payload || {}
    const kind = format === 'json' ? 'json' : 'csv'
    const dir = watchDir()
    let files = []
    try {
      files = fs.readdirSync(dir).filter((f) => /^watch-\d{8}\.jsonl$/i.test(f)).sort()
    } catch { /* ignore */ }

    const rows = []
    for (const name of files) {
      let lines = []
      try { lines = fs.readFileSync(path.join(dir, name), 'utf8').split('\n').filter(Boolean) } catch { continue }
      for (const line of lines) {
        try {
          const row = JSON.parse(line)
          if (row && typeof row === 'object') rows.push(row)
        } catch { /* 跳过坏行 */ }
      }
    }
    rows.sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0))

    let target = normStr(file).trim()
    if (!target) {
      const res = await dialog.showSaveDialog({
        title: '导出监控日志',
        defaultPath: `注册表监控日志-${fileStamp()}.${kind}`,
        filters: kind === 'json'
          ? [{ name: 'JSON 文件', extensions: ['json'] }]
          : [{ name: 'CSV 文件', extensions: ['csv'] }]
      })
      if (res.canceled || !res.filePath) return { file: '', count: 0 }
      target = res.filePath
    }

    let content
    if (kind === 'json') {
      content = JSON.stringify({ exportedAt: Date.now(), count: rows.length, rows }, null, 2)
    } else {
      const header = ['时间', '注册表路径', '键名', '变更类型', '旧值', '新值', '来源']
      const lines = [header.map(csvCell).join(',')]
      for (const r of rows) {
        lines.push([
          normStr(r.atText) || tsText(r.at),
          normStr(r.path),
          normStr(r.name) || '(默认)',
          CHANGE_LABEL[r.changeType] || normStr(r.changeType),
          normStr(r.oldValue),
          normStr(r.newValue),
          r.origin === 'WinEnv管家' ? 'WinEnv管家' : '外部'
        ].map(csvCell).join(','))
      }
      content = '\ufeff' + lines.join('\r\n') + '\r\n'
    }

    try {
      store.ensureDir(path.dirname(target))
      fs.writeFileSync(target, content, 'utf8')
    } catch (err) {
      throw new Error(`日志导出失败：${(err && err.message) || '目标路径不可写'}`)
    }
    return { file: target, count: rows.length, size: fs.statSync(target).size }
  })

  // 进程退出前兜底清掉定时器（软件关闭即停止监控）
  try {
    app.on('before-quit', () => {
      for (const w of watchers.values()) stopWatcher(w)
      watchers.clear()
    })
  } catch { /* app 不可用时忽略 */ }
}

module.exports = { register }
