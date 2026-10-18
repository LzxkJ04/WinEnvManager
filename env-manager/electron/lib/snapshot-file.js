'use strict'
/**
 * 快照文件文档：生成、校验、与当前环境做差异。
 * 校验和是去掉 snapshotChecksum 后的 canonical JSON 的 sha256。
 */
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function buildSnapshotDocument(input) {
  const src = input || {}
  const userEnvironment = normalizeEnvList(src.userEnvironment)
  const systemEnvironment = normalizeEnvList(src.systemEnvironment)
  const doc = {
    snapshotMeta: {
      snapshotId: crypto.randomUUID(),
      snapshotName: src.name == null ? '' : String(src.name),
      remark: src.remark == null ? '' : String(src.remark),
      tagList: normalizeTags(src.tags),
      isProtected: false,
      createTime: new Date().toISOString(),
      softwareVersion: readSoftwareVersion(),
      osVersion: os.release(),
      creatorType: src.creatorType == null ? '' : String(src.creatorType),
      totalUserEnvCount: userEnvironment.length,
      totalSystemEnvCount: systemEnvironment.length
    },
    userEnvironment,
    systemEnvironment,
    additionalInfo: {
      formatVersion: 1
    }
  }
  doc.snapshotChecksum = checksumOf(doc)
  return doc
}

function verifySnapshot(doc) {
  try {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
      return { ok: false, reason: '快照文档无效' }
    }
    if (typeof doc.snapshotChecksum !== 'string' || !doc.snapshotChecksum) {
      return { ok: false, reason: '缺少校验和' }
    }
    const actual = checksumOf(doc)
    if (actual !== doc.snapshotChecksum) return { ok: false, reason: '校验和不匹配' }
    return { ok: true, reason: '校验通过' }
  } catch (err) {
    return { ok: false, reason: (err && err.message) || '校验失败' }
  }
}

/**
 * current* 元素可以是 { name, value } 或 { envKey, envValue }。
 * oldValue 来自快照，newValue 来自当前环境。
 * add：当前有、快照无；delete：快照有、当前无；update：两边都有但值不同。
 */
function diffSnapshot(currentUserArray, currentSystemArray, doc) {
  const snap = doc || {}
  return [
    ...diffScope(currentUserArray, snap.userEnvironment, 'user'),
    ...diffScope(currentSystemArray, snap.systemEnvironment, 'system')
  ]
}

function diffScope(currentArray, snapshotArray, scope) {
  const current = toMap(currentArray)
  const previous = toMap(snapshotArray)
  const keys = Array.from(new Set([...current.keys(), ...previous.keys()])).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const out = []
  for (const envKey of keys) {
    const hasCurrent = current.has(envKey)
    const hasPrevious = previous.has(envKey)
    if (hasCurrent && !hasPrevious) {
      out.push({ envKey, scope, change: 'add', oldValue: '', newValue: current.get(envKey) })
    } else if (!hasCurrent && hasPrevious) {
      out.push({ envKey, scope, change: 'delete', oldValue: previous.get(envKey), newValue: '' })
    } else if (current.get(envKey) !== previous.get(envKey)) {
      out.push({ envKey, scope, change: 'update', oldValue: previous.get(envKey), newValue: current.get(envKey) })
    }
  }
  return out
}

function toMap(list) {
  const map = new Map()
  for (const item of Array.isArray(list) ? list : []) {
    const envKey = keyOf(item)
    if (!envKey) continue
    map.set(envKey, valueOf(item))
  }
  return map
}

function normalizeEnvList(list) {
  const out = []
  for (const item of Array.isArray(list) ? list : []) {
    const envKey = keyOf(item)
    if (!envKey) continue
    const envValue = valueOf(item)
    out.push({
      envKey,
      envValue,
      isExpandable: expandableOf(item, envValue)
    })
  }
  return out
}

function keyOf(item) {
  if (!item || typeof item !== 'object') return ''
  if (item.envKey != null && String(item.envKey) !== '') return String(item.envKey)
  if (item.name != null) return String(item.name)
  return ''
}

function valueOf(item) {
  if (!item || typeof item !== 'object') return ''
  if (item.envValue != null) return String(item.envValue)
  if (item.value != null) return String(item.value)
  return ''
}

function expandableOf(item, envValue) {
  if (item && typeof item.isExpandable === 'boolean') return item.isExpandable
  return /%[^%\r\n]+%/.test(String(envValue || ''))
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return []
  return tags.map((t) => String(t))
}

function readSoftwareVersion() {
  try {
    const file = path.join(__dirname, '..', '..', 'package.json')
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
    return pkg && pkg.version ? String(pkg.version) : ''
  } catch {
    return ''
  }
}

function checksumOf(doc) {
  const body = { ...doc }
  delete body.snapshotChecksum
  return crypto.createHash('sha256').update(canonicalJson(body), 'utf8').digest('hex')
}

/** 对象键按码点排序，数组保持原序，无空白。与键的书写顺序无关。 */
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

module.exports = { buildSnapshotDocument, verifySnapshot, diffSnapshot }
