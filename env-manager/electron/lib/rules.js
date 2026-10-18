'use strict'
/**
 * 软件自动识别规则库
 * 内置规则 + 用户自定义规则（%APPDATA%\win-env-manager\scan-rules.json）
 * JSON 结构见产品文档【十八、软件自动识别规则库的 JSON 结构】
 */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const store = require('./store')

const RULE_VERSION = '1.0'
const CUSTOM_FILE = () => path.join(store.appDataDir(), 'scan-rules.json')

/* --------------------------- 内置规则构造工具 --------------------------- */

let seq = 0
function rid(prefix) {
  seq += 1
  return `${prefix}-${crypto.randomBytes(3).toString('hex')}${seq}`
}

/** envTemplate 快捷构造 */
function homeVar(key, remark, scope = 'user') {
  return { varKey: key, varValue: '{{installPath}}', scope, remark: remark || '', pathPosition: '' }
}
function binVar(remark, sub = 'bin', position = 'append', scope = 'user') {
  return {
    varKey: 'PATH',
    varValue: sub ? `{{installPath}}\\${sub}` : '{{installPath}}',
    scope,
    remark: remark || '',
    pathPosition: position
  }
}

function rule(o) {
  return {
    id: o.id || rid(o.key || 'rule'),
    name: o.name,
    alias: o.alias || [],
    category: o.category,
    enable: o.enable !== false,
    description: o.description || '',
    scanSource: o.scanSource || ['registry', 'path-scan', 'customDir'],
    executableName: o.executableName,
    versionCmd: o.versionCmd || '',
    versionRegex: o.versionRegex || '',
    installPathExtract: o.installPathExtract || { mode: 'self', level: 0 },
    envTemplate: o.envTemplate || [],
    dependRuleIds: o.dependRuleIds || [],
    ignoreIfExists: !!o.ignoreIfExists,
    customCheckScript: o.customCheckScript || '',
    tags: o.tags || [],
    builtin: true
  }
}

const C_LANG = '编程语言运行时'
const C_BUILD = '构建&包管理工具'
const C_DB = '数据库 & 中间件'
const C_CONTAINER = '容器、虚拟化 & 云原生'
const C_IDE = 'IDE与工具'
const C_MEDIA = '多媒体、编译、逆向'
const C_OPS = '运维、网络与系统工具'
const C_SCRIPT = '脚本与环境工具'

const BUILTIN = [
  // ---------------- 语言运行时 ----------------
  rule({
    key: 'jdk', name: 'JDK', alias: ['java', 'jdk', 'openjdk', 'corretto'], category: C_LANG,
    executableName: 'java.exe', versionCmd: '-version',
    versionRegex: 'version "(\\d+(?:\\.\\d+)?[^"]*)"', installPathExtract: { mode: 'parentNLevel', level: 1 },
    description: 'JDK 运行时，自动生成 JAVA_HOME 并把 bin 加入 PATH',
    envTemplate: [homeVar('JAVA_HOME', 'JDK 主目录'), binVar('JDK bin 目录', 'bin', 'prepend')],
    tags: ['java', 'jdk']
  }),
  rule({
    key: 'node', name: 'Node.js', alias: ['node', 'nodejs'], category: C_LANG,
    executableName: 'node.exe', versionCmd: '--version', versionRegex: 'v(\\d+\\.\\d+\\.\\d+)',
    installPathExtract: { mode: 'self', level: 0 },
    description: 'Node.js 运行时，生成 NODE_HOME 并加入 PATH',
    envTemplate: [homeVar('NODE_HOME', 'Node.js 主目录'), binVar('Node.js 主目录', '', 'append')],
    tags: ['node', 'javascript']
  }),
  rule({
    key: 'python', name: 'Python', alias: ['python', 'python3', 'anaconda', 'miniconda'], category: C_LANG,
    executableName: 'python.exe', versionCmd: '--version', versionRegex: 'Python (\\d+\\.\\d+\\.\\d+)',
    installPathExtract: { mode: 'self', level: 0 },
    description: 'Python 解释器，生成 PYTHON_HOME / PYTHONPATH 并加入 PATH 与 Scripts',
    envTemplate: [
      homeVar('PYTHON_HOME', 'Python 主目录'),
      { varKey: 'PYTHONPATH', varValue: '{{installPath}};{{installPath}}\\Lib', scope: 'user', remark: 'Python 模块搜索路径', pathPosition: '' },
      binVar('Python 主目录', '', 'append'),
      binVar('Python Scripts 目录', 'Scripts', 'append')
    ],
    tags: ['python']
  }),
  rule({
    key: 'go', name: 'Go', alias: ['go', 'golang'], category: C_LANG,
    executableName: 'go.exe', versionCmd: 'version', versionRegex: 'go(\\d+\\.\\d+[\\d.]*)',
    installPathExtract: { mode: 'self', level: 0 },
    description: 'Go 工具链，生成 GOROOT / GOPATH / GOBIN',
    envTemplate: [
      homeVar('GOROOT', 'Go 安装目录'),
      { varKey: 'GOPATH', varValue: '%USERPROFILE%\\go', scope: 'user', remark: 'Go 工作区', pathPosition: '' },
      { varKey: 'GOBIN', varValue: '%USERPROFILE%\\go\\bin', scope: 'user', remark: 'Go 可执行文件目录', pathPosition: '' },
      binVar('Go 工具链', 'bin', 'append')
    ],
    tags: ['go', 'golang']
  }),
  rule({
    key: 'rust', name: 'Rust', alias: ['rust', 'cargo', 'rustup'], category: C_LANG,
    executableName: 'cargo.exe', versionCmd: '--version', versionRegex: 'cargo (\\d+\\.\\d+[\\d.]*)',
    installPathExtract: { mode: 'parentNLevel', level: 1 },
    description: 'Rust 工具链，生成 CARGO_HOME / RUSTUP_HOME',
    envTemplate: [
      { varKey: 'CARGO_HOME', varValue: '{{installPath}}', scope: 'user', remark: 'Cargo 主目录', pathPosition: '' },
      { varKey: 'RUSTUP_HOME', varValue: '{{installPath}}\\..\\rustup', scope: 'user', remark: 'Rustup 主目录', pathPosition: '' },
      binVar('Cargo bin 目录', 'bin', 'append')
    ],
    tags: ['rust']
  }),
  rule({
    key: 'php', name: 'PHP', alias: ['php'], category: C_LANG,
    executableName: 'php.exe', versionCmd: '--version', versionRegex: 'PHP (\\d+\\.\\d+[\\d.]*)',
    envTemplate: [homeVar('PHP_HOME', 'PHP 主目录'), binVar('PHP 主目录', '', 'append')], tags: ['php']
  }),
  rule({
    key: 'ruby', name: 'Ruby', alias: ['ruby'], category: C_LANG,
    executableName: 'ruby.exe', versionCmd: '--version', versionRegex: 'ruby (\\d+\\.\\d+\\.\\d+)',
    installPathExtract: { mode: 'parentNLevel', level: 1 },
    envTemplate: [binVar('Ruby bin 目录', 'bin', 'append')], tags: ['ruby']
  }),
  rule({
    key: 'dotnet', name: '.NET SDK', alias: ['dotnet', 'dotnet-sdk'], category: C_LANG,
    executableName: 'dotnet.exe', versionCmd: '--version', versionRegex: '(\\d+\\.\\d+\\.\\d+)',
    installPathExtract: { mode: 'parentNLevel', level: 1 },
    envTemplate: [homeVar('DOTNET_ROOT', '.NET 主目录'), binVar('.NET 主目录', '', 'append')], tags: ['dotnet', 'csharp']
  }),

  // ---------------- 构建与包管理 ----------------
  rule({
    key: 'maven', name: 'Maven', alias: ['maven', 'mvn'], category: C_BUILD,
    executableName: 'mvn.cmd', versionCmd: '--version', versionRegex: 'Apache Maven (\\d+\\.\\d+[\\d.]*)',
    installPathExtract: { mode: 'self', level: 0 },
    envTemplate: [
      homeVar('MAVEN_HOME', 'Maven 主目录'),
      { varKey: 'MAVEN_OPTS', varValue: '-Xms128m -Xmx512m', scope: 'user', remark: 'Maven JVM 参数', pathPosition: '' },
      binVar('Maven bin 目录', 'bin', 'append')
    ],
    tags: ['maven', 'java'], dependRuleIds: ['jdk']
  }),
  rule({
    key: 'gradle', name: 'Gradle', alias: ['gradle'], category: C_BUILD,
    executableName: 'gradle.bat', versionCmd: '--version', versionRegex: 'Gradle (\\d+\\.\\d+[\\d.]*)',
    installPathExtract: { mode: 'self', level: 0 },
    envTemplate: [homeVar('GRADLE_HOME', 'Gradle 主目录'), binVar('Gradle bin 目录', 'bin', 'append')],
    tags: ['gradle'], dependRuleIds: ['jdk']
  }),
  rule({
    key: 'git', name: 'Git', alias: ['git', 'git-for-windows'], category: C_BUILD,
    executableName: 'git.exe', versionCmd: '--version', versionRegex: 'git version (\\d+\\.\\d+[\\d.]*)',
    installPathExtract: { mode: 'parentNLevel', level: 1 },
    envTemplate: [binVar('Git cmd 目录', 'cmd', 'append')], tags: ['git']
  }),
  rule({
    key: 'cmake', name: 'CMake', alias: ['cmake'], category: C_BUILD,
    executableName: 'cmake.exe', versionCmd: '--version', versionRegex: 'cmake version (\\d+\\.\\d+[\\d.]*)',
    installPathExtract: { mode: 'parentNLevel', level: 1 },
    envTemplate: [binVar('CMake bin 目录', 'bin', 'append')], tags: ['cmake']
  }),
  rule({
    key: 'mingw', name: 'MinGW-w64', alias: ['mingw', 'gcc', 'g++'], category: C_BUILD,
    executableName: 'gcc.exe', versionCmd: '--version', versionRegex: 'gcc[^(]*\\(\\w+\\)\\s+(\\d+\\.\\d+[\\d.]*)',
    installPathExtract: { mode: 'parentNLevel', level: 1 },
    envTemplate: [binVar('MinGW bin 目录', 'bin', 'append')], tags: ['gcc', 'c', 'cpp']
  }),
  rule({
    key: 'ninja', name: 'Ninja', alias: ['ninja'], category: C_BUILD,
    executableName: 'ninja.exe', versionCmd: '--version', versionRegex: '(\\d+\\.\\d+\\.\\d+)',
    envTemplate: [binVar('Ninja 目录', '', 'append')], tags: ['ninja']
  }),
  rule({
    key: 'ant', name: 'Apache Ant', alias: ['ant'], category: C_BUILD,
    executableName: 'ant.bat', versionCmd: '-version', versionRegex: 'Apache Ant\\(TM\\) version (\\d+\\.\\d+[\\d.]*)',
    installPathExtract: { mode: 'self', level: 0 },
    envTemplate: [homeVar('ANT_HOME', 'Ant 主目录'), binVar('Ant bin 目录', 'bin', 'append')], tags: ['ant']
  }),

  // ---------------- 数据库与中间件 ----------------
  rule({
    key: 'mysql', name: 'MySQL', alias: ['mysql', 'mariadb'], category: C_DB,
    executableName: 'mysql.exe', versionCmd: '--version', versionRegex: 'Ver\\s+(\\d+\\.\\d+[\\d.]*)',
    installPathExtract: { mode: 'parentNLevel', level: 1 },
    envTemplate: [homeVar('MYSQL_HOME', 'MySQL 主目录'), binVar('MySQL bin 目录', 'bin', 'append')], tags: ['mysql', 'db']
  }),
  rule({
    key: 'postgresql', name: 'PostgreSQL', alias: ['postgres', 'postgresql', 'psql'], category: C_DB,
    executableName: 'psql.exe', versionCmd: '--version', versionRegex: 'psql \\(PostgreSQL\\) (\\d+[\\d.]*)',
    installPathExtract: { mode: 'parentNLevel', level: 2 },
    envTemplate: [homeVar('PGHOME', 'PostgreSQL 主目录'), binVar('PostgreSQL bin 目录', 'bin', 'append')], tags: ['postgresql', 'db']
  }),
  rule({
    key: 'redis', name: 'Redis', alias: ['redis', 'redis-server'], category: C_DB,
    executableName: 'redis-server.exe', versionCmd: '--version', versionRegex: 'v=(\\d+\\.\\d+[\\d.]*)',
    installPathExtract: { mode: 'self', level: 0 },
    envTemplate: [binVar('Redis 目录', '', 'append')], tags: ['redis', 'db']
  }),
  rule({
    key: 'mongodb', name: 'MongoDB', alias: ['mongo', 'mongodb', 'mongod'], category: C_DB,
    executableName: 'mongod.exe', versionCmd: '--version', versionRegex: 'db version v(\\d+\\.\\d+[\\d.]*)',
    installPathExtract: { mode: 'self', level: 0 },
    envTemplate: [binVar('MongoDB bin 目录', 'bin', 'append')], tags: ['mongodb', 'db']
  }),
  rule({
    key: 'elasticsearch', name: 'Elasticsearch', alias: ['elasticsearch', 'es'], category: C_DB,
    executableName: 'elasticsearch.bat', versionCmd: '--version', versionRegex: 'Version:\\s+(\\d+\\.\\d+\\.\\d+)',
    installPathExtract: { mode: 'parentNLevel', level: 1 },
    envTemplate: [homeVar('ES_HOME', 'Elasticsearch 主目录'), binVar('Elasticsearch bin 目录', 'bin', 'append')],
    tags: ['elasticsearch'], dependRuleIds: ['jdk']
  }),
  rule({
    key: 'kafka', name: 'Kafka', alias: ['kafka'], category: C_DB,
    executableName: 'kafka-server-start.bat', versionCmd: '--version', versionRegex: '(\\d+\\.\\d+[\\d.]*)',
    installPathExtract: { mode: 'self', level: 0 },
    envTemplate: [binVar('Kafka bin 目录', 'bin', 'append')], tags: ['kafka'], dependRuleIds: ['jdk']
  }),

  // ---------------- 容器虚拟化 ----------------
  rule({
    key: 'docker', name: 'Docker Desktop', alias: ['docker'], category: C_CONTAINER,
    executableName: 'docker.exe', versionCmd: '--version', versionRegex: 'Docker version (\\d+\\.\\d+[\\d.]*)',
    installPathExtract: { mode: 'parentNLevel', level: 2 },
    envTemplate: [homeVar('DOCKER_HOME', 'Docker 主目录'), binVar('Docker 资源目录', 'resources\\bin', 'append')],
    tags: ['docker', 'container']
  }),
  rule({
    key: 'kubectl', name: 'kubectl', alias: ['kubectl', 'k8s'], category: C_CONTAINER,
    executableName: 'kubectl.exe', versionCmd: 'version --client', versionRegex: 'v(\\d+\\.\\d+\\.\\d+)',
    installPathExtract: { mode: 'self', level: 0 },
    envTemplate: [binVar('kubectl 目录', '', 'append')], tags: ['k8s', 'kubectl']
  }),
  rule({
    key: 'helm', name: 'Helm', alias: ['helm'], category: C_CONTAINER,
    executableName: 'helm.exe', versionCmd: 'version', versionRegex: 'v(\\d+\\.\\d+\\.\\d+)',
    installPathExtract: { mode: 'self', level: 0 },
    envTemplate: [binVar('Helm 目录', '', 'append')], tags: ['helm']
  }),
  rule({
    key: 'terraform', name: 'Terraform', alias: ['terraform'], category: C_CONTAINER,
    executableName: 'terraform.exe', versionCmd: '--version', versionRegex: 'Terraform v(\\d+\\.\\d+\\.\\d+)',
    installPathExtract: { mode: 'self', level: 0 },
    envTemplate: [binVar('Terraform 目录', '', 'append')], tags: ['terraform']
  }),

  // ---------------- IDE 与工具 ----------------
  rule({
    key: 'vscode', name: 'VS Code', alias: ['vscode', 'code', 'visual-studio-code'], category: C_IDE,
    executableName: 'Code.exe', versionCmd: '--version', versionRegex: '(\\d+\\.\\d+\\.\\d+)',
    installPathExtract: { mode: 'self', level: 0 },
    envTemplate: [], tags: ['vscode', 'ide']
  }),
  rule({
    key: 'android-sdk', name: 'Android SDK', alias: ['android-sdk', 'adb', 'sdkmanager'], category: C_MEDIA,
    executableName: 'adb.exe', versionCmd: 'version', versionRegex: 'Android Debug Bridge version (\\d+\\.\\d+\\.\\d+)',
    installPathExtract: { mode: 'parentNLevel', level: 2 },
    description: 'Android SDK，自动生成 ANDROID_HOME 并加入 platform-tools',
    envTemplate: [
      homeVar('ANDROID_HOME', 'Android SDK 根目录'),
      binVar('platform-tools', 'platform-tools', 'append'),
      binVar('tools 目录', 'tools', 'append')
    ],
    tags: ['android']
  }),
  rule({
    key: 'flutter', name: 'Flutter', alias: ['flutter', 'dart'], category: C_MEDIA,
    executableName: 'flutter.bat', versionCmd: '--version', versionRegex: 'Flutter (\\d+\\.\\d+\\.\\d+)',
    installPathExtract: { mode: 'self', level: 0 },
    envTemplate: [binVar('Flutter bin 目录', 'bin', 'prepend')], tags: ['flutter', 'dart']
  }),

  // ---------------- 多媒体与编译 ----------------
  rule({
    key: 'ffmpeg', name: 'FFmpeg', alias: ['ffmpeg', 'ffprobe'], category: C_MEDIA,
    executableName: 'ffmpeg.exe', versionCmd: '-version', versionRegex: 'ffmpeg version (\\w+[\\d.]*)',
    installPathExtract: { mode: 'parentNLevel', level: 1 },
    envTemplate: [binVar('FFmpeg bin 目录', 'bin', 'append')], tags: ['ffmpeg', 'media']
  }),

  // ---------------- 运维网络工具 ----------------
  rule({
    key: 'nginx', name: 'Nginx', alias: ['nginx'], category: C_OPS,
    executableName: 'nginx.exe', versionCmd: '-v', versionRegex: 'nginx/(\\d+\\.\\d+[\\d.]*)',
    installPathExtract: { mode: 'self', level: 0 },
    envTemplate: [binVar('Nginx 主目录', '', 'append')], tags: ['nginx', 'web']
  }),
  rule({
    key: 'openssl', name: 'OpenSSL', alias: ['openssl'], category: C_OPS,
    executableName: 'openssl.exe', versionCmd: 'version', versionRegex: 'OpenSSL (\\d+\\.[\\d.a-z]+)',
    installPathExtract: { mode: 'parentNLevel', level: 1 },
    envTemplate: [binVar('OpenSSL bin 目录', 'bin', 'append')], tags: ['openssl', 'security']
  }),
  rule({
    key: '7zip', name: '7-Zip', alias: ['7zip', '7z'], category: C_IDE,
    executableName: '7z.exe', versionCmd: '', versionRegex: '',
    installPathExtract: { mode: 'parentNLevel', level: 1 },
    envTemplate: [binVar('7-Zip 目录', '', 'append')], tags: ['7zip', 'compress']
  }),
  rule({
    key: 'nssm', name: 'NSSM', alias: ['nssm'], category: C_OPS,
    executableName: 'nssm.exe', versionCmd: '', versionRegex: '',
    envTemplate: [binVar('NSSM 目录', '', 'append')], tags: ['nssm', 'service']
  }),

  // ---------------- 脚本与环境工具 ----------------
  rule({
    key: 'nvm', name: 'nvm-windows', alias: ['nvm'], category: C_SCRIPT,
    executableName: 'nvm.exe', versionCmd: 'version', versionRegex: '(\\d+\\.\\d+\\.\\d+)',
    installPathExtract: { mode: 'self', level: 0 },
    envTemplate: [], tags: ['nvm', 'node'], description: 'Node 多版本管理器，识别后可接管版本切换'
  }),
  rule({
    key: 'scoop', name: 'Scoop', alias: ['scoop'], category: C_SCRIPT,
    executableName: 'scoop.cmd', versionCmd: '--version', versionRegex: 'v?(\\d+\\.\\d+[\\d.]*)',
    envTemplate: [], tags: ['scoop', 'package']
  }),
  rule({
    key: 'choco', name: 'Chocolatey', alias: ['choco', 'chocolatey'], category: C_SCRIPT,
    executableName: 'choco.exe', versionCmd: '--version', versionRegex: '(\\d+\\.\\d+\\.\\d+)',
    envTemplate: [], tags: ['choco', 'package']
  }),
  rule({
    key: 'winget', name: 'Winget', alias: ['winget'], category: C_SCRIPT,
    executableName: 'winget.exe', versionCmd: '--version', versionRegex: 'v?(\\d+[\\d.]*)',
    envTemplate: [], tags: ['winget', 'package']
  })
]

/* ------------------------------ 规则库读写 ------------------------------ */

function builtinRules() {
  return JSON.parse(JSON.stringify(BUILTIN))
}

function customRules() {
  try {
    if (fs.existsSync(CUSTOM_FILE())) {
      const obj = JSON.parse(fs.readFileSync(CUSTOM_FILE(), 'utf8'))
      return Array.isArray(obj.ruleList) ? obj.ruleList : []
    }
  } catch (_) { /* ignore */ }
  return []
}

function saveCustomRules(list) {
  store.ensureDir(store.appDataDir())
  fs.writeFileSync(
    CUSTOM_FILE(),
    JSON.stringify({ ruleVersion: RULE_VERSION, ruleList: list }, null, 2),
    'utf8'
  )
  return true
}

/** 合并后的完整规则库（内置 + 自定义，同 ID 自定义覆盖内置） */
function listRules() {
  const map = new Map()
  for (const r of BUILTIN) map.set(r.id, r)
  for (const r of customRules()) map.set(r.id, { ...r, builtin: false, custom: true })
  return [...map.values()]
}

function getRule(id) {
  return listRules().find((r) => r.id === id) || null
}

function upsertRule(ruleObj) {
  const err = validateRule(ruleObj)
  if (err) throw new Error(err)
  const list = customRules()
  const idx = list.findIndex((r) => r.id === ruleObj.id)
  const next = { ...ruleObj, builtin: false, custom: true }
  if (idx >= 0) list[idx] = next
  else list.push(next)
  saveCustomRules(list)
  return next
}

function deleteRule(id) {
  const list = customRules()
  const next = list.filter((r) => r.id !== id)
  saveCustomRules(next)
  return next.length !== list.length
}

/** 导入规则 JSON：重复 ID 覆盖，非法规则单独列出 */
function importRules(jsonText) {
  let obj
  try {
    obj = JSON.parse(jsonText)
  } catch (err) {
    throw new Error(`JSON 解析失败：${err.message}`)
  }
  const list = Array.isArray(obj) ? obj : Array.isArray(obj.ruleList) ? obj.ruleList : null
  if (!list) throw new Error('规则文件缺少 ruleList 数组')

  const current = customRules()
  const byId = new Map(current.map((r) => [r.id, r]))
  const imported = []
  const skipped = []
  for (const r of list) {
    const err = validateRule(r)
    if (err) {
      skipped.push({ name: r.name || r.id || '(未命名)', reason: err })
      continue
    }
    const item = { ...r, id: r.id || rid(r.key || 'rule'), builtin: false, custom: true }
    byId.set(item.id, item)
    imported.push(item.name || item.id)
  }
  saveCustomRules([...byId.values()])
  return { imported: imported.length, skipped, total: byId.size }
}

/** 校验单条规则 */
function validateRule(r) {
  if (!r || typeof r !== 'object') return '规则必须为对象'
  if (!r.name) return '缺少 name'
  if (!r.executableName) return '缺少 executableName'
  if (!Array.isArray(r.envTemplate)) return 'envTemplate 必须为数组'
  for (const t of r.envTemplate) {
    if (!t.varKey) return `envTemplate 缺少 varKey`
    if (!t.varValue) return `envTemplate ${t.varKey} 缺少 varValue`
    if (!['user', 'system'].includes(t.scope)) return `envTemplate ${t.varKey} scope 非法`
    if (t.varKey.toUpperCase() === 'PATH' && !['append', 'prepend'].includes(t.pathPosition)) {
      return `PATH 模板必须指定 pathPosition（append/prepend）`
    }
  }
  if (r.installPathExtract && !['self', 'parentNLevel', 'registryValue', 'custom'].includes(r.installPathExtract.mode)) {
    return 'installPathExtract.mode 非法'
  }
  if (r.versionRegex) {
    try {
      // eslint-disable-next-line no-new
      new RegExp(r.versionRegex)
    } catch (err) {
      return `versionRegex 非法：${err.message}`
    }
  }
  return null
}

function exportRules() {
  return JSON.stringify({ ruleVersion: RULE_VERSION, ruleList: listRules() }, null, 2)
}

module.exports = {
  RULE_VERSION,
  builtinRules,
  customRules,
  saveCustomRules,
  listRules,
  getRule,
  upsertRule,
  deleteRule,
  importRules,
  exportRules,
  validateRule
}
