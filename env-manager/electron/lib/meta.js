'use strict'
/**
 * 变量元数据存储（仅软件内部使用，不写入 Windows 注册表）
 * - 变量备注 / 锁定 / 标签 / 收藏 / 最近修改时间
 * - PATH 条目备注与来源分组标记
 * - 敏感变量标记
 * 持久化：%APPDATA%\win-env-manager\meta.json
 */
const fs = require('node:fs')
const path = require('node:path')
const store = require('./store')

const FILE = () => path.join(store.appDataDir(), 'meta.json')

const EMPTY = {
  version: 1,
  vars: {},      // `${scope}::${NAME}` -> { remark, locked, tags:[], favorite, updatedAt, sensitive }
  path: {},      // `${scope}::${path小写}` -> { remark, sourceTag }
  history: {},   // `${scope}::${NAME}` -> [{ at, value, op }]
  external: { lastHash: '', lastAt: 0 }
}

let cache = null

function load() {
  if (cache) return cache
  try {
    if (fs.existsSync(FILE())) {
      cache = { ...EMPTY, ...JSON.parse(fs.readFileSync(FILE(), 'utf8')) }
    } else {
      cache = JSON.parse(JSON.stringify(EMPTY))
    }
  } catch (_) {
    cache = JSON.parse(JSON.stringify(EMPTY))
  }
  return cache
}

function save() {
  store.ensureDir(store.appDataDir())
  fs.writeFileSync(FILE(), JSON.stringify(cache, null, 2), 'utf8')
  return true
}

function varKey(scope, name) {
  return `${scope}::${String(name || '').toUpperCase()}`
}

function pathKey(scope, p) {
  return `${scope}::${String(p || '').trim().toLowerCase()}`
}

/* ------------------------------ 变量元数据 ------------------------------ */

function getVar(scope, name) {
  return load().vars[varKey(scope, name)] || null
}

function setVar(scope, name, patch) {
  const k = varKey(scope, name)
  const data = load()
  const cur = data.vars[k] || { remark: '', locked: false, tags: [], favorite: false, sensitive: false, updatedAt: 0 }
  data.vars[k] = { ...cur, ...patch }
  save()
  return data.vars[k]
}

function removeVar(scope, name) {
  const data = load()
  delete data.vars[varKey(scope, name)]
  save()
  return true
}

function allVars() {
  return load().vars
}

/** 收藏 / 标签批量 */
function toggleFavorite(scope, name) {
  const cur = getVar(scope, name) || {}
  return setVar(scope, name, { favorite: !cur.favorite })
}

function setTags(scope, name, tags) {
  const list = Array.isArray(tags) ? tags : String(tags || '').split(',').map((t) => t.trim()).filter(Boolean)
  return setVar(scope, name, { tags: [...new Set(list)] })
}

function isLocked(scope, name) {
  const v = getVar(scope, name)
  return !!(v && v.locked)
}

/* ------------------------------ PATH 条目 ------------------------------ */

function getPathMeta(scope, p) {
  return load().path[pathKey(scope, p)] || null
}

function setPathMeta(scope, p, patch) {
  const data = load()
  const k = pathKey(scope, p)
  data.path[k] = { ...(data.path[k] || { remark: '', sourceTag: '' }), ...patch }
  save()
  return data.path[k]
}

function allPathMeta() {
  return load().path
}

/* ------------------------------ 变更历史 ------------------------------ */

function pushHistory(scope, name, op, value, oldValue) {
  const data = load()
  const k = varKey(scope, name)
  const list = data.history[k] || []
  list.unshift({ at: Date.now(), op, value, oldValue: oldValue === undefined ? null : oldValue })
  if (list.length > 40) list.pop()
  data.history[k] = list
  save()
  return true
}

function getHistory(scope, name) {
  return load().history[varKey(scope, name)] || []
}

function pruneHistory(validKeys) {
  const data = load()
  const set = new Set(validKeys)
  for (const k of Object.keys(data.history)) {
    if (!set.has(k)) delete data.history[k]
  }
  save()
}

/* ------------------------------ 外部变更检测 ------------------------------ */

function getExternal() {
  return load().external
}

function setExternal(hash) {
  const data = load()
  data.external = { lastHash: hash || '', lastAt: Date.now() }
  save()
  return data.external
}

module.exports = {
  load,
  save,
  getVar,
  setVar,
  removeVar,
  allVars,
  toggleFavorite,
  setTags,
  isLocked,
  getPathMeta,
  setPathMeta,
  allPathMeta,
  pushHistory,
  getHistory,
  pruneHistory,
  getExternal,
  setExternal,
  varKey
}
