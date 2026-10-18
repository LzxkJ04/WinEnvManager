'use strict'
/**
 * 环境配置集：多套完整环境变量配置，一键切换
 * - 全局配置集 / 项目配置集（绑定本地项目文件夹）
 * - 互斥组：同组内最多 1 套处于「已加载（草稿待提交）」状态
 * 持久化：%APPDATA%\win-env-manager\configsets.json
 */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const store = require('./store')

const FILE = () => path.join(store.appDataDir(), 'configsets.json')

const EMPTY = { version: 1, sets: [], mutexGroups: [], ignorePrompts: [] }

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`
}

function load() {
  try {
    if (fs.existsSync(FILE())) return { ...EMPTY, ...JSON.parse(fs.readFileSync(FILE(), 'utf8')) }
  } catch (_) { /* ignore */ }
  return JSON.parse(JSON.stringify(EMPTY))
}

function save(data) {
  store.ensureDir(store.appDataDir())
  fs.writeFileSync(FILE(), JSON.stringify(data, null, 2), 'utf8')
  return data
}

/* ------------------------------ 配置集 CRUD ------------------------------ */

function listSets() {
  return load().sets
}

function getSet(id) {
  return load().sets.find((s) => s.id === id) || null
}

function createSet(patch) {
  const data = load()
  const set = {
    id: uid('cs'),
    name: patch.name || '新配置集',
    type: patch.type === 'project' ? 'project' : 'global',
    comment: patch.comment || '',
    group: patch.group || '',
    readOnly: false,
    projectDir: patch.projectDir || '',
    folderWatch: !!patch.folderWatch,
    mutexId: patch.mutexId || '',
    variables: Array.isArray(patch.variables) ? patch.variables : [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  data.sets.push(set)
  save(data)
  return set
}

function updateSet(id, patch) {
  const data = load()
  const set = data.sets.find((s) => s.id === id)
  if (!set) throw new Error('配置集不存在')
  if (set.readOnly && !patch._force) throw new Error('该配置集已锁定为只读，不能修改')
  const allowed = ['name', 'comment', 'group', 'type', 'projectDir', 'folderWatch', 'variables', 'mutexId', 'readOnly']
  for (const k of allowed) {
    if (patch[k] !== undefined) set[k] = patch[k]
  }
  set.updatedAt = Date.now()
  save(data)
  return set
}

function deleteSet(id) {
  const data = load()
  const before = data.sets.length
  data.sets = data.sets.filter((s) => s.id !== id)
  save(data)
  return data.sets.length !== before
}

function duplicateSet(id) {
  const src = getSet(id)
  if (!src) throw new Error('配置集不存在')
  return createSet({
    ...src,
    name: `${src.name} 副本`,
    readOnly: false,
    mutexId: ''
  })
}

/* ------------------------------ 互斥组 ------------------------------ */

function listMutex() {
  return load().mutexGroups
}

function getMutex(id) {
  return load().mutexGroups.find((g) => g.id === id) || null
}

function createMutex(patch) {
  const data = load()
  const g = {
    id: uid('mg'),
    name: patch.name || '新互斥组',
    comment: patch.comment || '',
    autoClean: patch.autoClean !== false,
    forceBlock: !!patch.forceBlock,
    snapshotBefore: patch.snapshotBefore !== false,
    createdAt: Date.now()
  }
  data.mutexGroups.push(g)
  save(data)
  return g
}

function updateMutex(id, patch) {
  const data = load()
  const g = data.mutexGroups.find((x) => x.id === id)
  if (!g) throw new Error('互斥组不存在')
  for (const k of ['name', 'comment', 'autoClean', 'forceBlock', 'snapshotBefore']) {
    if (patch[k] !== undefined) g[k] = patch[k]
  }
  save(data)
  return g
}

/** 删除互斥组：仅解除绑定，不删除配置集 */
function deleteMutex(id) {
  const data = load()
  data.mutexGroups = data.mutexGroups.filter((g) => g.id !== id)
  for (const s of data.sets) {
    if (s.mutexId === id) s.mutexId = ''
  }
  save(data)
  return true
}

/** 配置集加入互斥组。一个配置集同时只属于一个组；同一组可以有多个成员，互斥的是草稿里同时生效的那一套。 */
function assignMutex(setId, mutexId) {
  const data = load()
  const set = data.sets.find((s) => s.id === setId)
  if (!set) throw new Error('配置集不存在')
  if (mutexId) {
    const g = data.mutexGroups.find((x) => x.id === mutexId)
    if (!g) throw new Error('互斥组不存在')
  }
  set.mutexId = mutexId || ''
  set.updatedAt = Date.now()
  save(data)
  return set
}

/** 组内当前已加载到草稿的配置集 ID 由渲染端传入查询 */
function membersOf(mutexId) {
  return load().sets.filter((s) => s.mutexId === mutexId)
}

/* ------------------------------ 导入导出 ------------------------------ */

function exportSet(id) {
  const s = getSet(id)
  if (!s) throw new Error('配置集不存在')
  return {
    kind: 'win-env-manager-config-set',
    version: 1,
    exportedAt: new Date().toISOString(),
    set: s
  }
}

function importSet(json, opts = {}) {
  let obj
  try {
    obj = typeof json === 'string' ? JSON.parse(json) : json
  } catch (err) {
    throw new Error(`JSON 解析失败：${err.message}`)
  }
  const src = obj.set || obj
  if (!src || !Array.isArray(src.variables)) throw new Error('配置集文件格式不正确（缺少 variables）')
  const name = src.name || '导入配置集'

  // 同名配置集按「程序设置 → 配置集」的冲突策略处理：merge 仅新增 / overwrite 整套覆盖
  const existing = listSets().find((s) => s.name === name)
  if (existing) {
    const conflict = opts.conflict || 'merge'
    if (conflict === 'overwrite') {
      updateSet(existing.id, {
        variables: src.variables,
        comment: src.comment || existing.comment,
        group: src.group || existing.group
      })
      return { id: existing.id, name, merged: false, added: 0 }
    }
    const have = new Set((existing.variables || []).map((v) => `${v.scope || 'user'}::${String(v.name).toLowerCase()}`))
    const add = (src.variables || []).filter((v) => !have.has(`${v.scope || 'user'}::${String(v.name).toLowerCase()}`))
    updateSet(existing.id, { variables: [...(existing.variables || []), ...add] })
    return { id: existing.id, name, merged: true, added: add.length }
  }

  return createSet({
    name,
    type: src.type,
    comment: src.comment || '',
    group: src.group || '',
    projectDir: src.projectDir || '',
    variables: src.variables,
    mutexId: ''
  })
}

/* ------------------------------ 内置变量模板库 ------------------------------ */

function template(name) {
  const tpl = (key, value, remark, scope = 'user') => ({ key, value, remark: remark || '', scope })
  const library = {
    maven: [
      tpl('MAVEN_HOME', 'C:\\dev\\soft\\apache-maven-3.9.9', 'Maven 主目录'),
      tpl('MAVEN_OPTS', '-Xms128m -Xmx512m', 'Maven JVM 参数'),
      { key: 'PATH', value: '{{MAVEN_HOME}}\\bin', remark: 'Maven bin', scope: 'user', isPathEntry: true }
    ],
    gradle: [
      tpl('GRADLE_HOME', 'C:\\dev\\soft\\gradle-8.10.2', 'Gradle 主目录'),
      tpl('GRADLE_USER_HOME', '%USERPROFILE%\\.gradle', 'Gradle 用户目录'),
      { key: 'PATH', value: '{{GRADLE_HOME}}\\bin', remark: 'Gradle bin', scope: 'user', isPathEntry: true }
    ],
    android: [
      tpl('ANDROID_HOME', 'C:\\dev\\soft\\android-sdk', 'Android SDK 根目录'),
      { key: 'PATH', value: '{{ANDROID_HOME}}\\platform-tools', remark: 'adb 工具', scope: 'user', isPathEntry: true },
      { key: 'PATH', value: '{{ANDROID_HOME}}\\tools', remark: 'SDK tools', scope: 'user', isPathEntry: true }
    ],
    cuda: [
      tpl('CUDA_HOME', 'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.4', 'CUDA 主目录'),
      { key: 'PATH', value: '{{CUDA_HOME}}\\bin', remark: 'CUDA bin', scope: 'user', isPathEntry: true }
    ],
    ffmpeg: [{ key: 'PATH', value: 'C:\\dev\\soft\\ffmpeg\\bin', remark: 'FFmpeg 可执行目录', scope: 'user', isPathEntry: true }],
    proxy: [
      tpl('http_proxy', 'http://127.0.0.1:7890', 'HTTP 代理'),
      tpl('https_proxy', 'http://127.0.0.1:7890', 'HTTPS 代理'),
      tpl('no_proxy', 'localhost,127.0.0.1,*.internal.com', '不走代理的地址')
    ],
    node: [
      tpl('NODE_HOME', 'C:\\dev\\soft\\node-v22.11.0', 'Node.js 主目录'),
      { key: 'PATH', value: '{{NODE_HOME}}', remark: 'Node.js 目录', scope: 'user', isPathEntry: true }
    ],
    java: [
      tpl('JAVA_HOME', 'C:\\dev\\soft\\jdk-17', 'JDK 主目录'),
      { key: 'PATH', value: '{{JAVA_HOME}}\\bin', remark: 'JDK bin', scope: 'user', isPathEntry: true }
    ],
    goenv: [
      tpl('GOROOT', 'C:\\dev\\soft\\go', 'Go 安装目录'),
      tpl('GOPATH', '%USERPROFILE%\\go', 'Go 工作区'),
      { key: 'PATH', value: '%GOPATH%\\bin', remark: 'Go 可执行目录', scope: 'user', isPathEntry: true }
    ],
    python: [
      tpl('PYTHON_HOME', 'C:\\dev\\soft\\python313', 'Python 主目录'),
      tpl('PYTHONPATH', '%PYTHON_HOME%;%PYTHON_HOME%\\Lib', '模块搜索路径'),
      { key: 'PATH', value: '{{PYTHON_HOME}}\\Scripts', remark: 'pip 脚本目录', scope: 'user', isPathEntry: true }
    ]
  }
  return library[name] ? JSON.parse(JSON.stringify(library[name])) : null
}

function listTemplates() {
  return [
    { id: 'java', name: 'Java / JDK', desc: 'JAVA_HOME + PATH' },
    { id: 'node', name: 'Node.js', desc: 'NODE_HOME + PATH' },
    { id: 'python', name: 'Python', desc: 'PYTHON_HOME / PYTHONPATH + Scripts' },
    { id: 'goenv', name: 'Go', desc: 'GOROOT / GOPATH' },
    { id: 'maven', name: 'Maven', desc: 'MAVEN_HOME / MAVEN_OPTS' },
    { id: 'gradle', name: 'Gradle', desc: 'GRADLE_HOME / GRADLE_USER_HOME' },
    { id: 'android', name: 'Android SDK', desc: 'ANDROID_HOME + platform-tools' },
    { id: 'cuda', name: 'CUDA', desc: 'CUDA_HOME + bin' },
    { id: 'ffmpeg', name: 'FFmpeg', desc: 'PATH 条目' },
    { id: 'proxy', name: '代理变量', desc: 'http_proxy / https_proxy / no_proxy' }
  ]
}

/** 项目提示忽略（永久不再提醒） */
function ignorePrompt(setId) {
  const d = load()
  if (!d.ignorePrompts.includes(setId)) d.ignorePrompts.push(setId)
  save(d)
  return true
}

function isIgnored(setId) {
  return load().ignorePrompts.includes(setId)
}

module.exports = {
  listSets,
  getSet,
  createSet,
  updateSet,
  deleteSet,
  duplicateSet,
  listMutex,
  getMutex,
  createMutex,
  updateMutex,
  deleteMutex,
  assignMutex,
  membersOf,
  exportSet,
  importSet,
  template,
  listTemplates,
  ignorePrompt,
  isIgnored,
  load
}
