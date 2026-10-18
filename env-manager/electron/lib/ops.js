'use strict'
/**
 * 业务操作：快照生成 / 快照列表 / 备份生成 / 备份解析
 * 被 IPC 层与自动保护流程共同调用。
 */
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const zlib = require('node:zlib')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)
const registry = require('./registry')
const store = require('./store')
const meta = require('./meta')
const snapFile = require('./snapshot-file')

const BACKUP_KIND = 'win-env-manager-backup'
const SNAPSHOT_KIND = 'win-env-manager-snapshot'

function snapshotCompressOn() {
  return store.readConfig().snapshotCompress === true
}

function snapshotPlainPath(id) {
  return path.join(store.snapshotDir(), `${id}.json`)
}

function snapshotGzPath(id) {
  return path.join(store.snapshotDir(), `${id}.json.gz`)
}

/** 同一 id 优先读压缩文件。旧的明文 .json 仍然认。 */
function locateSnapshotFile(id) {
  const gz = snapshotGzPath(id)
  const plain = snapshotPlainPath(id)
  if (fs.existsSync(gz)) return gz
  if (fs.existsSync(plain)) return plain
  return ''
}

function readSnapshotText(file) {
  const buf = fs.readFileSync(file)
  if (String(file).toLowerCase().endsWith('.gz')) return zlib.gunzipSync(buf).toString('utf8')
  return buf.toString('utf8')
}

function writeSnapshotObject(file, obj) {
  const text = JSON.stringify(obj, null, 2)
  if (String(file).toLowerCase().endsWith('.gz')) {
    fs.writeFileSync(file, zlib.gzipSync(Buffer.from(text, 'utf8')))
  } else {
    fs.writeFileSync(file, text, 'utf8')
  }
  return file
}

/** 新快照按开关写 .json.gz 或明文 .json。正文和校验和不变，压缩只包文件。 */
function writeNewSnapshot(id, snapshot) {
  store.ensureDir(store.snapshotDir())
  const file = snapshotCompressOn() ? snapshotGzPath(id) : snapshotPlainPath(id)
  writeSnapshotObject(file, snapshot)
  return file
}

function isSnapshotFileName(name) {
  const lower = String(name || '').toLowerCase()
  return lower.endsWith('.json') || lower.endsWith('.json.gz')
}

function snapshotIdFromName(name) {
  return String(name || '').replace(/\.json\.gz$/i, '').replace(/\.json$/i, '')
}

function pad(n) {
  return String(n).padStart(2, '0')
}

function tsText(d = new Date()) {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  )
}

function fileStamp(d = new Date()) {
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}

function toMap(list) {
  const m = {}
  for (const item of list || []) m[item.name] = item.value
  return m
}

/** 抓取当前完整环境（返回 map 形式，便于差异比较） */
async function captureEnv() {
  const { user, machine } = await registry.readAllEnv()
  return { user: toMap(user), machine: toMap(machine) }
}

/* ------------------------------- 快照 ------------------------------- */

/**
 * 创建快照
 * @param {{name?:string, note?:string, auto?:boolean}} payload
 * @param {object} [env] 可传入已抓取的环境，避免重复读取
 */
async function createSnapshot(payload = {}, env) {
  const data = env || (await captureEnv())
  const now = new Date()
  const id = `${fileStamp(now)}-${crypto.randomBytes(2).toString('hex')}`
  const snapshot = {
    kind: SNAPSHOT_KIND,
    version: 1,
    id,
    name: payload.name && payload.name.trim() ? payload.name.trim() : `快照 ${tsText(now)}`,
    note: payload.note || '',
    auto: !!payload.auto,
    protected: !!payload.protected,
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    createdAt: now.getTime(),
    createdAtText: tsText(now),
    host: os.hostname(),
    user: data.user,
    machine: data.machine,
    counts: { user: Object.keys(data.user).length, machine: Object.keys(data.machine).length }
  }
  attachIntegrity(snapshot, data)
  const file = writeNewSnapshot(id, snapshot)
  snapshot.file = file
  snapshot.size = fs.statSync(file).size
  store.writeLog('info', `创建快照「${snapshot.name}」`, { id, file })
  return snapshot
}

/** 快照列表（仅元信息） */
function listSnapshots() {
  const dir = store.ensureDir(store.snapshotDir())
  const byId = new Map()
  for (const f of fs.readdirSync(dir)) {
    if (!isSnapshotFileName(f)) continue
    const full = path.join(dir, f)
    try {
      const obj = JSON.parse(readSnapshotText(full))
      const id = obj.id || snapshotIdFromName(f)
      const entry = {
        id,
        name: obj.name || f,
        note: obj.note || '',
        auto: !!obj.auto,
        protected: !!obj.protected,
        tags: Array.isArray(obj.tags) ? obj.tags : [],
        createdAt: obj.createdAt || fs.statSync(full).mtimeMs,
        createdAtText: obj.createdAtText || '',
        host: obj.host || '',
        counts: obj.counts || { user: 0, machine: 0 },
        file: full,
        size: fs.statSync(full).size
      }
      const prev = byId.get(id)
      const gz = full.toLowerCase().endsWith('.json.gz')
      // 同一编号同时有明文和压缩时，列表跟读取一样认压缩文件
      if (!prev || (gz && !String(prev.file).toLowerCase().endsWith('.json.gz'))) byId.set(id, entry)
    } catch (_) { /* 损坏文件跳过 */ }
  }
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt)
}

function readSnapshot(id) {
  const full = locateSnapshotFile(id)
  if (!full) throw new Error('快照文件不存在或已被删除')
  return JSON.parse(readSnapshotText(full))
}

function deleteSnapshot(id) {
  const plain = snapshotPlainPath(id)
  const gz = snapshotGzPath(id)
  if (!fs.existsSync(plain) && !fs.existsSync(gz)) throw new Error('快照文件不存在')
  if (fs.existsSync(plain)) fs.rmSync(plain, { force: true })
  if (fs.existsSync(gz)) fs.rmSync(gz, { force: true })
  store.writeLog('warn', `删除快照 ${id}`)
  return true
}

/** 基础差异计算 */
function diffMaps(leftMap, rightMap) {
  const L = leftMap || {}
  const R = rightMap || {}
  const added = []
  const removed = []
  const changed = []
  for (const name of Object.keys(R)) {
    if (!(name in L)) added.push({ name, to: R[name], scope: 'both' })
    else if (L[name] !== R[name]) changed.push({ name, from: L[name], to: R[name] })
  }
  for (const name of Object.keys(L)) {
    if (!(name in R)) removed.push({ name, from: L[name] })
  }
  return { added, removed, changed }
}

/**
 * 对比两份环境数据
 * 入参形如 { left: {user:{},machine:{}}, right: {user:{},machine:{}} }
 * 或传入 { leftId, rightId, current: true } 由主进程读取
 */
function compareEnv(payload) {
  const left = payload.left || { user: {}, machine: {} }
  const right = payload.right || { user: {}, machine: {} }
  const user = diffMaps(left.user, right.user)
  const machine = diffMaps(left.machine, right.machine)
  const sum = (d) => d.added.length + d.removed.length + d.changed.length
  return {
    user,
    machine,
    summary: {
      added: user.added.length + machine.added.length,
      removed: user.removed.length + machine.removed.length,
      changed: user.changed.length + machine.changed.length,
      total: sum(user) + sum(machine)
    }
  }
}

/* ------------------------------- 备份 ------------------------------- */

function backupFileName(format, prefix = 'EnvBackup') {
  const ext = format === 'reg' ? 'reg' : format === 'txt' ? 'txt' : 'json'
  return `${prefix}-${fileStamp()}.${ext}`
}

/** 生成 json 备份内容 */
function buildJsonBackup(env) {
  return JSON.stringify(
    {
      kind: BACKUP_KIND,
      version: 1,
      createdAt: new Date().getTime(),
      createdAtText: tsText(),
      host: os.hostname(),
      user: env.user,
      machine: env.machine
    },
    null,
    2
  )
}

/** 生成 txt 备份内容 */
function buildTxtBackup(env) {
  const lines = []
  lines.push('# WinEnvManager 环境变量备份')
  lines.push(`# 生成时间: ${tsText()}`)
  lines.push(`# 主机: ${os.hostname()}`)
  lines.push('')
  lines.push('[用户变量]')
  for (const k of Object.keys(env.user).sort()) lines.push(`${k}=${env.user[k]}`)
  lines.push('')
  lines.push('[系统变量]')
  for (const k of Object.keys(env.machine).sort()) lines.push(`${k}=${env.machine[k]}`)
  lines.push('')
  return lines.join('\r\n')
}

/** 生成 reg 备份内容（合并用户 + 系统两个键的导出） */
async function buildRegBackup() {
  const tmpDir = store.ensureDir(path.join(os.tmpdir(), 'wem-backup'))
  const f1 = path.join(tmpDir, `u-${Date.now()}.reg`)
  const f2 = path.join(tmpDir, `m-${Date.now()}.reg`)
  const tasks = [execFileAsync('reg.exe', ['export', store.USER_REG_KEY, f1, '/y'])]
  let machineOk = true
  try {
    await execFileAsync('reg.exe', ['export', store.MACHINE_REG_KEY, f2, '/y'])
  } catch (_) {
    machineOk = false
  }
  await Promise.all(tasks)

  const read = (f) => {
    const buf = fs.readFileSync(f)
    // reg.exe 导出为 UTF-16LE（带 BOM）
    return buf.toString('utf16le').replace(/^\uFEFF/, '')
  }
  let content = read(f1)
  if (machineOk && fs.existsSync(f2)) {
    let second = read(f2)
    // 去掉第二个文件的版本头
    second = second.replace(/^Windows Registry Editor Version [^\r\n]*\r?\n+/i, '')
    content = content.replace(/\s*$/, '') + '\r\n\r\n' + second
  }
  try { fs.rmSync(f1, { force: true }); fs.rmSync(f2, { force: true }) } catch (_) { /* ignore */ }
  return '\uFEFF' + content
}

/**
 * 创建备份文件
 * @param {{format?:string, targetPath?:string, silent?:boolean, prefix?:string, env?:object}} payload
 */
async function createBackup(payload = {}) {
  const format = ['reg', 'json', 'txt'].includes(payload.format) ? payload.format : 'json'
  const env = payload.env || (await captureEnv())
  const dir = store.resolvedBackupDir()
  const target = payload.targetPath || path.join(dir, backupFileName(format, payload.prefix || 'EnvBackup'))

  if (format === 'reg') {
    const content = await buildRegBackup()
    fs.writeFileSync(target, content, 'utf16le')
  } else if (format === 'txt') {
    fs.writeFileSync(target, '\uFEFF' + buildTxtBackup(env), 'utf8')
  } else {
    fs.writeFileSync(target, buildJsonBackup(env), 'utf8')
  }
  store.writeLog('info', `导出备份（${format.toUpperCase()}）`, target)
  return { file: target, format, size: fs.statSync(target).size }
}

/** 备份文件列表 */
function listBackups() {
  const dir = store.resolvedBackupDir()
  const out = []
  for (const f of fs.readdirSync(dir)) {
    const lower = f.toLowerCase()
    if (!/\.(reg|json|txt)$/.test(lower)) continue
    const full = path.join(dir, f)
    const st = fs.statSync(full)
    out.push({
      name: f,
      file: full,
      format: lower.endsWith('.reg') ? 'reg' : lower.endsWith('.txt') ? 'txt' : 'json',
      size: st.size,
      mtime: st.mtimeMs
    })
  }
  return out.sort((a, b) => b.mtime - a.mtime)
}

function deleteBackup(file) {
  const dir = store.resolvedBackupDir()
  const resolved = path.resolve(file)
  if (!resolved.startsWith(path.resolve(dir))) throw new Error('只能删除备份目录内的文件')
  if (!fs.existsSync(resolved)) throw new Error('备份文件不存在')
  fs.rmSync(resolved, { force: true })
  store.writeLog('warn', '删除备份文件', resolved)
  return true
}

/* ------------------------------- 备份解析 ------------------------------- */

function unescapeRegString(s) {
  return s.replace(/\\(.)/g, (m, c) => {
    if (c === '\\') return '\\'
    if (c === '"') return '"'
    return c
  })
}

/** reg.exe 导出的 hex 串可能被反斜杠换行折成多行，这里先合并为逻辑行 */
function mergeRegContinuations(text) {
  const raw = text.split(/\r?\n/)
  const out = []
  let buffer = ''
  for (const line of raw) {
    const t = line.replace(/\s+$/, '')
    if (buffer !== '') {
      buffer += t.replace(/^\\/, '').trim()
    } else {
      buffer = t
    }
    if (/\\$/.test(t) && !/^\[/.test(t.trim())) {
      buffer = buffer.replace(/\\$/, '')
      continue
    }
    out.push(buffer)
    buffer = ''
  }
  if (buffer !== '') out.push(buffer)
  return out
}

function decodeHexValue(hexPart, type) {
  const cleaned = hexPart.replace(/[\\\s]/g, '')
  const bytes = cleaned
    .split(',')
    .filter((b) => b !== '')
    .map((b) => parseInt(b, 16))
    .filter((n) => !Number.isNaN(n))
  if (!bytes.length) return ''
  const buf = Buffer.from(bytes)
  if (type === 7) {
    // REG_MULTI_SZ
    return buf
      .toString('utf16le')
      .replace(/\u0000+$/g, '')
      .split(/\u0000+/)
      .filter(Boolean)
      .join(';')
  }
  if (type === 4) return String(buf.readUInt32LE(0))
  return buf.toString('utf16le').replace(/\u0000+$/g, '')
}

function parseRegFile(text) {
  const entries = []
  let scope = null
  for (const rawLine of mergeRegContinuations(text)) {
    const line = rawLine.trim()
    if (!line || line.startsWith(';')) continue

    if (line.startsWith('[')) {
      const key = line.slice(line.indexOf('[') + 1, line.lastIndexOf(']'))
      const k = key.toLowerCase().replace(/\s+/g, ' ').trim()
      if (k.includes('hkey_current_user\\environment') || k.includes('hkcu\\environment')) {
        scope = 'user'
      } else if (
        k.includes('hkey_local_machine\\system\\currentcontrolset\\control\\session manager\\environment')
      ) {
        scope = 'machine'
      } else {
        scope = null
      }
      continue
    }
    if (!scope) continue
    if (line.startsWith('@=')) continue

    const m = line.match(/^"((?:[^"\\]|\\.)*)"=(.*)$/)
    if (!m) continue
    const name = unescapeRegString(m[1])
    const rest = m[2].trim()

    if (rest.startsWith('"')) {
      const vm = rest.match(/^"((?:[^"\\]|\\.)*)"/)
      entries.push({ name, value: vm ? unescapeRegString(vm[1]) : '', scope })
    } else {
      const hm = rest.match(/^hex(?:\((\d+)\))?:(.*)$/)
      if (hm) {
        entries.push({ name, value: decodeHexValue(hm[2], hm[1] ? parseInt(hm[1], 10) : 1), scope })
      }
    }
  }
  return entries
}

function parseJsonBackup(text) {
  const obj = JSON.parse(text)
  const entries = []
  const push = (map, scope) => {
    for (const k of Object.keys(map || {})) entries.push({ name: k, value: String(map[k]), scope })
  }
  // 兼容三种结构：
  // 1) {user:{}, machine:{}}                     —— v1 快速格式
  // 2) {vars:[{name,value,scope}]}               —— 导出清单
  // 3) {envData:{userVariables:[], systemVariables:[]}} —— v2 备份格式
  if (Array.isArray(obj.vars)) {
    for (const v of obj.vars) entries.push({ name: v.name, value: String(v.value ?? ''), scope: v.scope || 'user' })
  } else if (obj.envData) {
    for (const v of obj.envData.userVariables || []) entries.push({ name: v.key, value: String(v.value ?? ''), scope: 'user' })
    for (const v of obj.envData.systemVariables || []) entries.push({ name: v.key, value: String(v.value ?? ''), scope: 'machine' })
    if (obj.envData.pathext && obj.envData.pathext.value) {
      entries.push({ name: 'PATHEXT', value: String(obj.envData.pathext.value), scope: 'machine' })
    }
  } else {
    push(obj.user, 'user')
    push(obj.machine, 'machine')
  }
  return entries
}

function parseTxtBackup(text) {
  const entries = []
  let scope = 'user'
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^\uFEFF/, '').trim()
    if (!line) continue
    if (line.startsWith('#')) continue
    if (line.startsWith('[')) {
      const t = line.toLowerCase()
      if (t.includes('系统')) scope = 'machine'
      else if (t.includes('用户')) scope = 'user'
      continue
    }
    const idx = line.indexOf('=')
    if (idx <= 0) continue
    entries.push({ name: line.slice(0, idx).trim(), value: line.slice(idx + 1), scope })
  }
  return entries
}

/**
 * 根据文本内容自动识别格式（JSON / REG / TXT）并解析为变量条目
 * @param {string} text
 * @returns {Array<{name:string,value:string,scope:string}>}
 */
function parseTextContent(text) {
  const clean = String(text == null ? '' : text).replace(/^\uFEFF/, '')
  const trimmed = clean.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return parseJsonBackup(trimmed)
    } catch (_) {
      // 不是 JSON，继续按其它格式尝试
    }
  }
  if (/^Windows Registry Editor/i.test(trimmed) || /^\s*\[HKEY_/im.test(clean)) {
    return parseRegFile(clean)
  }
  return parseTxtBackup(clean)
}

/**
 * 读取备份文件并预览全部变更项
 * @param {{file:string, defaultScope?:string}} payload
 */
async function importPreview(payload) {
  const file = payload.file
  if (!file || !fs.existsSync(file)) throw new Error('备份文件不存在')
  const ext = path.extname(file).toLowerCase()
  const buf = fs.readFileSync(file)
  let text
  if (buf[0] === 0xff && buf[1] === 0xfe) text = buf.toString('utf16le').replace(/^\uFEFF/, '')
  else if (buf[0] === 0xfe && buf[1] === 0xff) text = buf.swap16().toString('utf16le').replace(/^\uFEFF/, '')
  else text = buf.toString('utf8').replace(/^\uFEFF/, '')

  let entries = parseTextContent(text)
  if (payload.defaultScope && ext !== '.reg') {
    entries = entries.map((e) => ({ ...e, scope: payload.defaultScope }))
  }

  // 与当前环境对比，标注 新增 / 更新 / 相同
  const current = await captureEnv()
  const items = entries.map((e) => {
    const cur = current[e.scope] || {}
    const exists = Object.prototype.hasOwnProperty.call(cur, e.name)
    let action = 'create'
    if (exists && cur[e.name] === e.value) action = 'same'
    else if (exists) action = 'update'
    return { ...e, action, currentValue: exists ? cur[e.name] : null }
  })

  return {
    file,
    format: ext.replace('.', ''),
    total: items.length,
    creatable: items.filter((i) => i.action === 'create').length,
    updatable: items.filter((i) => i.action === 'update').length,
    same: items.filter((i) => i.action === 'same').length,
    items
  }
}

/* ======================= v2：详细快照 / 备份（含加密与增量） ======================= */

const ENC_HEADER = 'WEMENC1:'

/** AES-256-GCM 加密（scrypt 派生密钥） */
function encryptText(text, password) {
  if (!password) throw new Error('未提供加密密码')
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const key = crypto.scryptSync(String(password), salt, 32)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return (
    ENC_HEADER +
    Buffer.concat([salt, iv, tag, enc]).toString('base64')
  )
}

function decryptText(blob, password) {
  const s = String(blob || '').trim()
  if (!s.startsWith(ENC_HEADER)) return s
  if (!password) throw new Error('该备份已加密，请输入密码')
  try {
    const raw = Buffer.from(s.slice(ENC_HEADER.length), 'base64')
    const salt = raw.subarray(0, 16)
    const iv = raw.subarray(16, 28)
    const tag = raw.subarray(28, 44)
    const data = raw.subarray(44)
    const key = crypto.scryptSync(String(password), salt, 32)
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  } catch (err) {
    throw new Error('解密失败：密码错误或文件已损坏')
  }
}

function isEncrypted(text) {
  return String(text || '').trim().startsWith(ENC_HEADER)
}

function systemVersionText() {
  return `${os.type()} ${os.release()}`
}

/** 抓取当前环境（含元数据），返回 v2 详细结构 */
async function captureEnvDetailed() {
  const { user, machine } = await registry.readAllEnv()
  const map = (list, scope) =>
    list.map((v) => {
      const m = meta.getVar(scope, v.name) || {}
      return {
        key: v.name,
        value: v.value,
        remark: m.remark || '',
        locked: !!m.locked,
        source: m.source || 'system-native'
      }
    })
  const pathextEntry = [...user, ...machine].find((v) => v.name.toUpperCase() === 'PATHEXT')
  return {
    userEnv: map(user, 'user'),
    systemEnv: map(machine, 'machine'),
    pathext: { value: pathextEntry ? pathextEntry.value : '', locked: false }
  }
}

function detailedToMaps(d) {
  const toMap = (list) => {
    const m = {}
    for (const v of list || []) m[v.key] = v.value
    return m
  }
  return { user: toMap(d.userEnv), machine: toMap(d.systemEnv) }
}

/** 创建 v2 快照（同时写入兼容字段，v1 阅读器仍可读取） */
async function createSnapshotV2(payload = {}, envDetailed) {
  const detailed = envDetailed || (await captureEnvDetailed())
  const maps = detailedToMaps(detailed)
  const now = new Date()
  const id = `${fileStamp(now)}-${crypto.randomBytes(2).toString('hex')}`

  const snapshot = {
    kind: SNAPSHOT_KIND,
    version: 2,
    id,
    meta: {
      snapshotId: id,
      name: payload.name && payload.name.trim() ? payload.name.trim() : `快照 ${tsText(now)}`,
      comment: payload.note || '',
      createTime: tsText(now),
      version: 'WinEnv管家 v2.0',
      isAutoSnapshot: !!payload.auto,
      systemVersion: systemVersionText()
    },
    name: payload.name && payload.name.trim() ? payload.name.trim() : `快照 ${tsText(now)}`,
    note: payload.note || '',
    auto: !!payload.auto,
    protected: !!payload.protected,
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    createdAt: now.getTime(),
    createdAtText: tsText(now),
    host: os.hostname(),
    user: maps.user,
    machine: maps.machine,
    userEnv: detailed.userEnv,
    systemEnv: detailed.systemEnv,
    pathext: detailed.pathext,
    counts: { user: detailed.userEnv.length, machine: detailed.systemEnv.length }
  }
  attachIntegrity(snapshot, maps)
  const file = writeNewSnapshot(id, snapshot)
  snapshot.file = file
  snapshot.size = fs.statSync(file).size
  store.writeLog('info', `创建快照「${snapshot.name}」`, { id, file })
  return snapshot
}

/** 快照数量上限清理（删除最早的自动快照优先；受保护快照永不删除） */
function pruneSnapshots(max) {
  const limit = Number(max) || 0
  if (limit <= 0) return 0
  const list = listSnapshots()
  if (list.length <= limit) return 0
  const excess = list.slice(limit).filter((s) => !s.protected).sort((a, b) => (a.auto === b.auto ? 0 : a.auto ? -1 : 1))
  let n = 0
  for (const s of excess) {
    try {
      fs.rmSync(s.file, { force: true })
      n += 1
    } catch (_) { /* ignore */ }
  }
  return n
}

/** 清理预览：返回即将被自动清理的快照（不执行删除） */
function previewPruneSnapshots(max) {
  const limit = Number(max) || 0
  if (limit <= 0) return { limit, total: listSnapshots().length, willRemove: [], protectedCount: 0 }
  const list = listSnapshots()
  const protectedCount = list.filter((s) => s.protected).length
  const willRemove = list.length <= limit
    ? []
    : list.slice(limit).filter((s) => !s.protected).map((s) => ({ id: s.id, name: s.name, auto: s.auto, createdAtText: s.createdAtText, size: s.size }))
  return { limit, total: list.length, willRemove, protectedCount }
}

/** 快照保护标记：受保护快照不会被自动清理 */
function setSnapshotProtected(id, val) {
  const file = locateSnapshotFile(id)
  if (!file) throw new Error('快照不存在')
  const obj = JSON.parse(readSnapshotText(file))
  obj.protected = !!val
  if (obj.meta) obj.meta.protected = !!val
  writeSnapshotObject(file, obj)
  return { id, protected: !!val }
}

/** 读取快照（自动兼容 v1 / v2 结构），归一化为 {user:{},machine:{}} + 详细数组 */
function readSnapshotAny(id, opts = {}) {
  const full = locateSnapshotFile(id)
  if (!full) throw new Error('快照文件不存在或已被删除')
  const raw = JSON.parse(readSnapshotText(full))
  const checksum = verifyStoredSnapshot(raw)
  if (!checksum.ok && opts.skipHash !== true) throw new Error(`快照校验失败：${checksum.reason}`)
  if (!checksum.ok) checksum.skipped = true
  const out = {
    ...raw,
    user: raw.user || {},
    machine: raw.machine || {},
    userEnv: raw.userEnv || Object.keys(raw.user || {}).map((k) => ({ key: k, value: raw.user[k], remark: '', locked: false, source: 'system-native' })),
    systemEnv: raw.systemEnv || Object.keys(raw.machine || {}).map((k) => ({ key: k, value: raw.machine[k], remark: '', locked: false, source: 'system-native' })),
    pathext: raw.pathext || { value: '', locked: false },
    checksum
  }
  return out
}

function listFromMap(map) {
  return Object.keys(map || {}).map((name) => ({ name, value: map[name] == null ? '' : String(map[name]) }))
}

function attachIntegrity(snapshot, maps) {
  const integrity = snapFile.buildSnapshotDocument({
    name: snapshot.name,
    remark: snapshot.note,
    tags: snapshot.tags,
    creatorType: snapshot.auto ? 'auto' : 'manual',
    userEnvironment: listFromMap(maps && maps.user),
    systemEnvironment: listFromMap(maps && maps.machine)
  })
  snapshot.integrity = integrity
  snapshot.snapshotChecksum = integrity.snapshotChecksum
  return snapshot
}

function mapsFromIntegrity(doc) {
  const toEnvMap = (list) => {
    const out = {}
    for (const item of list || []) {
      if (!item || !item.envKey) continue
      out[String(item.envKey)] = item.envValue == null ? '' : String(item.envValue)
    }
    return out
  }
  return {
    user: toEnvMap(doc && doc.userEnvironment),
    machine: toEnvMap(doc && doc.systemEnvironment)
  }
}

function sameMaps(left, right) {
  const a = left || {}
  const b = right || {}
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    const hasA = Object.prototype.hasOwnProperty.call(a, key)
    const hasB = Object.prototype.hasOwnProperty.call(b, key)
    if (hasA !== hasB) return false
    if (String(a[key] ?? '') !== String(b[key] ?? '')) return false
  }
  return true
}

/** 有校验文档则核对 sha256，并确认正文与校验文档一致。旧快照没有校验和时允许继续。 */
function verifyStoredSnapshot(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, legacy: false, reason: '快照文档无效' }
  if (!raw.integrity) return { ok: true, legacy: true, reason: '旧快照没有校验和' }
  const result = snapFile.verifySnapshot(raw.integrity)
  if (!result.ok) return { ok: false, legacy: false, reason: result.reason }
  const maps = mapsFromIntegrity(raw.integrity)
  if (!sameMaps(raw.user, maps.user) || !sameMaps(raw.machine, maps.machine)) {
    return { ok: false, legacy: false, reason: '快照正文与校验文档不一致' }
  }
  return { ok: true, legacy: false, reason: '校验通过' }
}

/** 备份保留数量清理 */
function pruneBackups(max) {
  const limit = Number(max) || 0
  if (limit <= 0) return 0
  const files = listBackups().filter((f) => f.format === 'json')
  if (files.length <= limit) return 0
  let n = 0
  for (const f of files.slice(limit)) {
    try {
      fs.rmSync(f.file, { force: true })
      n += 1
    } catch (_) { /* ignore */ }
  }
  return n
}

function findLatestBackup(format = 'json') {
  const files = listBackups().filter((f) => f.format === format)
  return files[0] || null
}

/**
 * 创建 v2 备份（支持加密 / 增量 / 备注 / 校验值）
 * @param {{format?:string, backupName?:string, comment?:string, backupType?:'full'|'increment',
 *          password?:string, targetPath?:string, silent?:boolean, prefix?:string, env?:object}} payload
 */
async function createBackupV2(payload = {}) {
  const format = ['reg', 'json', 'txt'].includes(payload.format) ? payload.format : 'json'

  if (format !== 'json') {
    // reg / txt 仍走 v1 逻辑
    return createBackup(payload)
  }

  const type = payload.backupType === 'increment' ? 'increment' : 'full'
  const current = payload.env || (await captureEnvDetailed())
  const dir = store.resolvedBackupDir()

  let changedUser = current.userEnv
  let changedMachine = current.systemEnv
  let baseName = ''
  if (type === 'increment') {
    const latest = findLatestBackup('json')
    if (latest && fs.existsSync(latest.file)) {
      let baseText = fs.readFileSync(latest.file, 'utf8')
      if (isEncrypted(baseText)) {
        if (!payload.password) throw new Error('上一份备份已加密，增量备份需要输入相同密码')
        baseText = decryptText(baseText, payload.password)
      }
      const base = JSON.parse(baseText)
      const baseUser = new Map((base.envData?.userVariables || []).map((v) => [v.key, v.value]))
      const baseMachine = new Map((base.envData?.systemVariables || []).map((v) => [v.key, v.value]))
      changedUser = current.userEnv.filter((v) => baseUser.get(v.key) !== v.value)
      changedMachine = current.systemEnv.filter((v) => baseMachine.get(v.key) !== v.value)
      baseName = path.basename(latest.file)
      if (!changedUser.length && !changedMachine.length) {
        return { file: latest.file, format, size: fs.statSync(latest.file).size, empty: true }
      }
    } else {
      baseName = ''
    }
  }

  const now = new Date()
  const body = {
    kind: BACKUP_KIND,
    backupMeta: {
      backupId: `bk-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`,
      backupName: payload.backupName || `${type === 'increment' ? '增量备份' : '全量备份'}${fileStamp(now)}`,
      comment: payload.comment || '',
      backupType: type,
      createTime: tsText(now),
      encrypt: false,
      checksum: '',
      softwareVersion: 'WinEnv管家 v2.0'
    },
    envData: {
      userVariables: changedUser,
      systemVariables: changedMachine,
      pathext: current.pathext || { value: '', locked: false }
    },
    baseBackup: baseName,
    extra: {
      configSetList: [],
      scanIgnoreList: store.readConfig().scanIgnoreList || []
    },
    // 兼容字段：让 v1 阅读器与现有导入逻辑可直接读取
    user: Object.fromEntries(current.userEnv.map((v) => [v.key, v.value])),
    machine: Object.fromEntries(current.systemEnv.map((v) => [v.key, v.value]))
  }

  const checksum = crypto.createHash('md5').update(JSON.stringify(body.envData)).digest('hex')
  body.backupMeta.checksum = checksum
  body.backupMeta.encrypt = !!payload.password

  const target = payload.targetPath || path.join(dir, `${(payload.prefix || 'Backup')}-${fileStamp(now)}.json`)
  let text = JSON.stringify(body, null, 2)
  if (payload.password) text = encryptText(text, payload.password)
  fs.writeFileSync(target, text, 'utf8')
  store.writeLog('info', `导出备份（${type === 'increment' ? '增量' : '全量'} JSON）`, target)
  return { file: target, format, size: fs.statSync(target).size, type, baseName }
}

/** 读取备份文件（自动识别 v1/v2 与加密），归一化为条目数组 */
function readBackupAny(file, password) {
  if (!fs.existsSync(file)) throw new Error('备份文件不存在')
  const buf = fs.readFileSync(file)
  let text
  if (buf[0] === 0xff && buf[1] === 0xfe) text = buf.toString('utf16le').replace(/^\uFEFF/, '')
  else text = buf.toString('utf8')
  if (isEncrypted(text)) text = decryptText(text, password)
  const obj = JSON.parse(text)
  const entries = parseJsonBackup(text)
  return {
    raw: obj,
    meta: obj.backupMeta || {},
    entries,
    checksumOk: obj.backupMeta ? verifyChecksum(obj) : true
  }
}

function verifyChecksum(obj) {
  try {
    const calc = crypto.createHash('md5').update(JSON.stringify(obj.envData)).digest('hex')
    return !obj.backupMeta?.checksum || calc === obj.backupMeta.checksum
  } catch (_) {
    return false
  }
}

/** 当前环境指纹，用于外部变更检测 */
async function envFingerprint() {
  const { user, machine } = await registry.readAllEnv()
  const parts = [...user, ...machine]
    .map((v) => `${v.scope}:${v.name}=${v.value}`)
    .sort()
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex')
}

module.exports = {
  captureEnv,
  captureEnvDetailed,
  detailedToMaps,
  createSnapshot,
  createSnapshotV2,
  listSnapshots,
  readSnapshot,
  readSnapshotAny,
  verifyStoredSnapshot,
  pruneSnapshots,
  previewPruneSnapshots,
  setSnapshotProtected,
  deleteSnapshot,
  pruneSnapshots,
  pruneBackups,
  compareEnv,
  diffMaps,
  createBackup,
  createBackupV2,
  readBackupAny,
  findLatestBackup,
  listBackups,
  deleteBackup,
  importPreview,
  parseTextContent,
  encryptText,
  decryptText,
  isEncrypted,
  envFingerprint,
  backupFileName,
  tsText,
  BACKUP_KIND,
  SNAPSHOT_KIND
}
