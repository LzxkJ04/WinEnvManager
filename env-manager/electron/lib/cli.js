'use strict'
/**
 * 极简命令行接口：WinEnvManager.exe --cli <命令> [参数]
 * 行为受「程序设置 → CLI 与外部调用」控制：
 *   - cliOutputFormat：text 纯文本 / json
 *   - cliReadOnly：true 时禁止 set 写入
 *   - cliLogLevel：运行日志级别；缺省或无法识别按 info，低于该级别不写日志
 * CLI 模式不启动界面，执行完立即退出；写入动作照常进审计日志。
 * 运行日志不记录变量值。writeLog 另按全局 logLevel 过滤，因此 CLI 只能比全局更严。
 */
const registry = require('./registry')
const store = require('./store')

function usage() {
  return [
    'WinEnv管家 CLI 用法：WinEnvManager.exe --cli <命令> [参数]',
    '',
    '命令：',
    '  list [--scope user|machine]            列出环境变量（默认全部）',
    '  get NAME                               读取单个变量',
    '  path-check                             校验当前 PATH（含忽略列表与网络盘选项）',
    '  snapshot list                          列出快照',
    '  set NAME VALUE [--scope machine]       写入变量（只读模式下被拒绝）',
    '  help                                   显示本帮助',
    '',
    '输出格式与写入权限在「程序设置 → CLI 与外部调用」中配置。'
  ].join('\n')
}

async function run(args, opts = {}) {
  const cfg = store.readConfig()
  const json = cfg.cliOutputFormat === 'json'
  const cmd = String(args[0] || 'help').toLowerCase()
  const rest = args.slice(1)
  const outFile = opts.outFile || ''
  const fs = require('node:fs')

  const CLI_LOG_RANK = { debug: 10, info: 20, warn: 30, warning: 30, error: 40 }
  const cliLogRank = (level) => {
    const key = String(level || 'info').toLowerCase()
    return Object.prototype.hasOwnProperty.call(CLI_LOG_RANK, key) ? CLI_LOG_RANK[key] : CLI_LOG_RANK.info
  }
  // 先按 cliLogLevel 丢掉更低级别，再交给 writeLog；写失败不得改变退出码
  const logCli = (level, message, detail) => {
    try {
      if (cliLogRank(level) < cliLogRank(cfg.cliLogLevel)) return
      store.writeLog(level, message, detail)
    } catch { /* 日志失败不改变退出码 */ }
  }

  // portable 单文件 exe 属于 GUI 子系统，stdout 不一定接回终端；支持 --cli-out <file> 把结果落文件
  const write = (text) => {
    if (outFile) {
      try { fs.writeFileSync(outFile, String(text) + '\n', 'utf8') } catch { /* 忽略写失败 */ }
    }
    console.log(text)
  }
  const writeErr = (text) => {
    if (outFile) {
      try { fs.writeFileSync(outFile, String(text) + '\n', 'utf8') } catch { /* ignore */ }
    }
    console.error(text)
  }

  const fail = (msg, code) => {
    writeErr(json ? JSON.stringify({ error: msg }) : msg)
    return code
  }

  switch (cmd) {
    case 'help':
    case '--help':
    case '-h':
      logCli('debug', 'CLI help', { command: cmd })
      write(usage())
      return 0

    case 'list': {
      const scopeIdx = rest.indexOf('--scope')
      const only = scopeIdx >= 0 ? String(rest[scopeIdx + 1] || 'all').toLowerCase() : 'all'
      const data = await registry.readAllEnv()
      if (json) {
        const out = {}
        if (only !== 'machine') out.user = data.user.map((v) => ({ name: v.name, value: v.value }))
        if (only !== 'user') out.machine = data.machine.map((v) => ({ name: v.name, value: v.value }))
        write(JSON.stringify(out, null, 2))
      } else {
        if (only !== 'machine') {
          write(`[用户变量] ${data.user.length} 项`)
          for (const v of data.user) write(`  ${v.name}=${v.value}`)
        }
        if (only !== 'user') {
          write(`[系统变量] ${data.machine.length} 项`)
          for (const v of data.machine) write(`  ${v.name}=${v.value}`)
        }
      }
      let listed = 0
      if (only !== 'machine') listed += data.user.length
      if (only !== 'user') listed += data.machine.length
      logCli('info', 'CLI list', { command: 'list', count: listed })
      return 0
    }

    case 'get': {
      const name = rest[0]
      if (!name) {
        logCli('error', 'CLI 校验失败', { command: 'get' })
        return fail('用法: --cli get NAME', 2)
      }
      const data = await registry.readAllEnv()
      const hit = [...data.user, ...data.machine].find((v) => v.name.toUpperCase() === String(name).toUpperCase())
      if (!hit) {
        logCli('warn', 'CLI get 未找到变量', { command: 'get', name })
        return fail(`变量 ${name} 不存在`, 1)
      }
      if (json) write(JSON.stringify({ name: hit.name, scope: hit.scope, value: hit.value }, null, 2))
      else write(`${hit.scope === 'machine' ? '[系统] ' : '[用户] '}${hit.name}=${hit.value}`)
      logCli('info', 'CLI get', { command: 'get', name: hit.name, scope: hit.scope })
      return 0
    }

    case 'path-check': {
      const data = await registry.readAllEnv()
      const out = {}
      let count = 0
      for (const scope of ['user', 'machine']) {
        const hit = (scope === 'user' ? data.user : data.machine).find((v) => v.name.toUpperCase() === 'PATH')
        const dirs = String(hit ? hit.value : '').split(';').map((s) => s.trim()).filter(Boolean)
        count += dirs.length
        out[scope] = await registry.classifyPaths(dirs, { config: cfg })
      }
      write(JSON.stringify(out, null, 2))
      logCli('info', 'CLI path-check', { command: 'path-check', count })
      return 0
    }

    case 'snapshot': {
      if (String(rest[0] || 'list').toLowerCase() !== 'list') {
        logCli('error', 'CLI 校验失败', { command: 'snapshot' })
        return fail('仅支持 snapshot list', 2)
      }
      const ops = require('./ops')
      const list = ops.listSnapshots().map((s) => ({ id: s.id, name: s.name, createdAt: s.createdAtText, protected: !!s.protected }))
      write(json ? JSON.stringify(list, null, 2) : list.map((s) => `${s.id}  ${s.name}${s.protected ? '  [受保护]' : ''}`).join('\n'))
      logCli('info', 'CLI snapshot', { command: 'snapshot', count: list.length })
      return 0
    }

    case 'set': {
      if (cfg.cliReadOnly !== false) {
        logCli('warn', 'CLI 只读拒绝 set', { command: 'set', name: rest[0] || '' })
        return fail('CLI 处于只读模式，禁止写入。可在「程序设置 → CLI 与外部调用」允许写入。', 3)
      }
      const name = rest[0]
      const value = rest[1] || ''
      const scopeIdx = rest.indexOf('--scope')
      const scope = scopeIdx >= 0 && String(rest[scopeIdx + 1]).toLowerCase() === 'machine' ? 'machine' : 'user'
      if (!name) {
        logCli('error', 'CLI 校验失败', { command: 'set' })
        return fail('用法: --cli set NAME VALUE [--scope machine]', 2)
      }
      const check = registry.validateName(name)
      if (!check.ok) {
        logCli('error', 'CLI 校验失败', { command: 'set', name })
        return fail(check.message, 2)
      }
      await registry.writeValue(scope, name, value)
      store.appendAudit({
        origin: 'CLI',
        action: 'set',
        count: 1,
        items: [{ name, scope, ok: true, before: '', after: value }]
      })
      if (json) write(JSON.stringify({ ok: true, name, scope, value }, null, 2))
      else write(`已写入${scope === 'machine' ? '系统' : '用户'}变量 ${name}=${value}`)
      logCli('info', 'CLI set', { command: 'set', name, scope })
      return 0
    }

    default:
      logCli('error', 'CLI 未知命令', { command: cmd })
      return fail(`未知命令 ${cmd}，使用 --cli help 查看帮助`, 2)
  }
}

module.exports = { run }
