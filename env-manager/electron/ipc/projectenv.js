'use strict'
/**
 * 项目环境：config/projects.json
 * 只删项目配置，不删项目文件夹。启动终端只通过子进程 env 注入，不写注册表。
 */
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const store = require('../lib/store')
const { parseEnvText } = require('../lib/dotenv-parse')

const TERMINALS = new Set(['cmd', 'powershell', 'pwsh', 'wt'])
const CWD_MODES = new Set(['project', 'custom'])

function projectsFile() {
  return path.join(store.appDataDir(), 'config', 'projects.json')
}

function readProjects() {
  const file = projectsFile()
  if (!fs.existsSync(file)) return []
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!Array.isArray(data)) throw new Error('项目配置格式错误')
  return data
}

function writeProjects(list) {
  const dir = path.join(store.appDataDir(), 'config')
  store.ensureDir(dir)
  fs.writeFileSync(projectsFile(), JSON.stringify(list, null, 2), 'utf8')
}

function hasOwn(obj, key) {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined
}

function asString(v, fallback) {
  return v == null ? fallback : String(v)
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return []
  return tags.map((t) => String(t))
}

function normalizeVars(vars) {
  if (!Array.isArray(vars)) return []
  return vars.map((v) => ({
    name: v && v.name != null ? String(v.name) : '',
    value: v && v.value != null ? String(v.value) : '',
    enabled: !v || v.enabled !== false
  }))
}

function normalizeProject(input, prev) {
  const p = input || {}
  const base = prev || {}
  const terminal = hasOwn(p, 'terminal') ? p.terminal : (base.terminal || 'cmd')
  if (!TERMINALS.has(terminal)) throw new Error('terminal 只能是 cmd、powershell 或 wt')
  const cwdMode = hasOwn(p, 'cwdMode') ? p.cwdMode : (base.cwdMode || 'project')
  if (!CWD_MODES.has(cwdMode)) throw new Error('cwdMode 只能是 project 或 custom')

  const id = hasOwn(p, 'id') && p.id ? String(p.id) : (base.id || crypto.randomUUID())
  return {
    id,
    name: hasOwn(p, 'name') ? asString(p.name, '') : asString(base.name, ''),
    folder: hasOwn(p, 'folder') ? asString(p.folder, '') : asString(base.folder, ''),
    tags: hasOwn(p, 'tags') ? normalizeTags(p.tags) : normalizeTags(base.tags),
    remark: hasOwn(p, 'remark') ? asString(p.remark, '') : asString(base.remark, ''),
    terminal,
    cwdMode,
    customCwd: hasOwn(p, 'customCwd') ? asString(p.customCwd, '') : asString(base.customCwd, ''),
    inheritGlobal: hasOwn(p, 'inheritGlobal') ? !!p.inheritGlobal : (base.inheritGlobal !== undefined ? !!base.inheritGlobal : true),
    vars: hasOwn(p, 'vars') ? normalizeVars(p.vars) : normalizeVars(base.vars),
    preScript: hasOwn(p, 'preScript') ? asString(p.preScript, '') : asString(base.preScript, ''),
    autoDotenv: hasOwn(p, 'autoDotenv') ? !!p.autoDotenv : (base.autoDotenv !== undefined ? !!base.autoDotenv : true),
    launchCommand: hasOwn(p, 'launchCommand') ? asString(p.launchCommand, '') : asString(base.launchCommand, ''),
    updatedAt: new Date().toISOString()
  }
}

function isDirectory(dir) {
  try {
    return !!dir && fs.existsSync(dir) && fs.statSync(dir).isDirectory()
  } catch {
    return false
  }
}

/** Windows 环境块大小写不敏感：同名键先删再写，避免 Path/PATH 并存 */
function assignEnv(env, name, value) {
  const target = String(name)
  if (process.platform === 'win32') {
    const upper = target.toUpperCase()
    for (const key of Object.keys(env)) {
      if (key.toUpperCase() === upper && key !== target) delete env[key]
    }
  }
  env[target] = value == null ? '' : String(value)
}

function buildLaunchEnv(project) {
  const env = {}
  if (project.inheritGlobal !== false) {
    for (const key of Object.keys(process.env)) {
      if (process.env[key] != null) env[key] = String(process.env[key])
    }
  }
  // 本机调试用的 Node 模式标记不能传进用户终端，否则 Electron 会当成 Node 启动
  delete env.ELECTRON_RUN_AS_NODE
  applyDotenv(env, project)
  for (const item of Array.isArray(project.vars) ? project.vars : []) {
    if (!item || item.enabled === false) continue
    const name = item.name != null ? String(item.name) : ''
    if (!name) continue
    assignEnv(env, name, item.value)
  }
  return env
}

function commandExists(cmd) {
  try {
    const found = spawnSync('where.exe', [cmd], { windowsHide: true, encoding: 'utf8', timeout: 4000 })
    return found.status === 0 && String(found.stdout || '').trim().length > 0
  } catch {
    return false
  }
}

function writePreScript(project, terminal) {
  const text = String(project.preScript || '').replace(/^\uFEFF/, '').trim()
  if (!text) return ''
  const ps = terminal === 'powershell' || terminal === 'pwsh'
  const ext = ps ? 'ps1' : 'cmd'
  const file = path.join(os.tmpdir(), `wem-launch-${String(project.id || 'project').replace(/[^\w.-]/g, '_')}.${ext}`)
  const body = ps ? `${text}\r\n` : `@echo off\r\nchcp 65001 >nul\r\n${text}\r\n`
  fs.writeFileSync(file, `\uFEFF${body}`, 'utf8')
  return file
}

function spawnSpec(terminal, cwd, scriptFile) {
  if (terminal === 'powershell' || terminal === 'pwsh') {
    const args = ['-NoExit', '-ExecutionPolicy', 'Bypass']
    if (scriptFile) args.push('-File', scriptFile)
    return { cmd: terminal === 'pwsh' ? 'pwsh.exe' : 'powershell.exe', args }
  }
  if (terminal === 'wt') {
    const args = []
    if (cwd) args.push('-d', cwd)
    if (scriptFile) args.push('cmd', '/k', scriptFile)
    return { cmd: 'wt.exe', args }
  }
  return { cmd: 'cmd.exe', args: scriptFile ? ['/k', scriptFile] : ['/k'] }
}

function applyDotenv(env, project) {
  if (project.autoDotenv !== true) return
  const folder = project.folder ? String(project.folder) : ''
  if (!folder) return
  const file = path.join(folder, '.env')
  if (!fs.existsSync(file)) return
  const parsed = parseEnvText(fs.readFileSync(file, 'utf8'), { filename: '.env' })
  for (const entry of parsed.entries || []) {
    if (!entry || entry.invalid || !entry.key) continue
    assignEnv(env, entry.key, entry.value)
  }
}

function register(handle, ctx) {
  void ctx

  handle('project:list', async () => readProjects())

  handle('project:save', async (_e, payload) => {
    const incoming = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.projects) ? payload.projects : null)
    if (incoming) {
      const prev = readProjects()
      const prevById = new Map(prev.map((item) => [item.id, item]))
      const seen = new Set()
      const next = incoming.map((item) => {
        const id = item && item.id ? String(item.id) : ''
        const saved = normalizeProject(item, id ? prevById.get(id) : null)
        if (!String(saved.name || '').trim()) throw new Error('项目名称不能为空')
        if (seen.has(saved.id)) throw new Error('项目 id 重复')
        seen.add(saved.id)
        return saved
      })
      writeProjects(next)
      return next
    }
    const list = readProjects()
    const id = payload && payload.id
    const idx = id ? list.findIndex((item) => item.id === id) : -1
    const saved = normalizeProject(payload, idx >= 0 ? list[idx] : null)
    if (!String(saved.name || '').trim()) throw new Error('项目名称不能为空')
    if (idx >= 0) list[idx] = saved
    else list.push(saved)
    writeProjects(list)
    return saved
  })

  handle('project:remove', async (_e, payload) => {
    const id = payload && payload.id
    if (!id) throw new Error('缺少项目 id')
    const list = readProjects()
    const next = list.filter((item) => item.id !== id)
    if (next.length === list.length) throw new Error('项目不存在')
    writeProjects(next)
    return { removed: true, id }
  })

  handle('project:parseFile', async (_e, payload) => {
    const p = payload || {}
    return parseEnvText(p.text == null ? '' : String(p.text), {
      filename: p.filename == null ? '' : String(p.filename)
    })
  })

  handle('project:launch', async (_e, payload) => {
    const id = payload && payload.id
    if (!id) throw new Error('缺少项目 id')
    const project = readProjects().find((item) => item.id === id)
    if (!project) throw new Error('项目不存在')

    const folder = project.folder ? String(project.folder) : ''
    let cwd = ''
    let warning = ''
    if (project.cwdMode === 'custom') {
      const custom = project.customCwd ? String(project.customCwd) : ''
      if (isDirectory(custom)) cwd = custom
      else if (isDirectory(folder)) {
        cwd = folder
        warning = '自定义工作目录不存在，已改在项目文件夹打开'
      } else warning = '自定义工作目录不存在，终端改在默认目录打开'
    } else if (folder) {
      if (isDirectory(folder)) cwd = folder
      else warning = '项目文件夹不存在，终端改在默认目录打开'
    }

    const terminal = TERMINALS.has(project.terminal) ? project.terminal : 'cmd'
    const spec = spawnSpec(terminal, cwd, writePreScript(project, terminal))
    if ((terminal === 'pwsh' || terminal === 'wt') && !commandExists(spec.cmd)) {
      throw new Error(terminal === 'pwsh' ? '未找到 pwsh.exe，请安装 PowerShell 7，或改用 PowerShell' : '未找到 wt.exe，请安装 Windows 终端，或改用命令提示符')
    }
    const child = spawn(spec.cmd, spec.args, {
      cwd: cwd || undefined,
      env: buildLaunchEnv(project),
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      shell: false
    })
    child.on('error', () => {})
    child.unref()

    store.appendAudit({
      origin: 'GUI',
      action: 'projectLaunch',
      count: 1,
      items: [{
        name: project.name || project.id,
        scope: 'project',
        ok: true,
        before: '',
        after: cwd
      }]
    })

    return { pid: child.pid, terminal, cwd, warning }
  })
}

module.exports = { register, buildLaunchEnv }
