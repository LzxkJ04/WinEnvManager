'use strict'
/**
 * PowerShell 执行封装
 * 通过 -EncodedCommand(Base64/UTF-16LE) 传入脚本，彻底规避命令行引号与中文编码问题。
 * 输出统一按 UTF-8 读取，保证中文路径 / 中文变量值不乱码。
 */
const { spawn } = require('node:child_process')

const PRELUDE = [
  '$ErrorActionPreference = "Stop"',
  '$ProgressPreference = "SilentlyContinue"',
  '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)',
  '$OutputEncoding = New-Object System.Text.UTF8Encoding($false)'
].join('; ')

/**
 * 转义 PowerShell 单引号字符串字面量
 * @param {string} s
 */
function psQuote(s) {
  return String(s == null ? '' : s).replace(/'/g, "''")
}

/**
 * 执行 PowerShell 脚本并返回 stdout 文本
 * @param {string} script 脚本正文（会在前面自动拼接编码与错误策略前置语句）
 * @param {{timeout?: number}} [options]
 * @returns {Promise<string>}
 */
function runPowerShell(script, options = {}) {
  const timeout = options.timeout || 45000
  return new Promise((resolve, reject) => {
    const full = `${PRELUDE}; ${script}`
    const encoded = Buffer.from(full, 'utf16le').toString('base64')
    let child
    try {
      child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
      )
    } catch (err) {
      return reject(err)
    }

    const outChunks = []
    const errChunks = []
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { child.kill('SIGKILL') } catch (_) { /* ignore */ }
      reject(new Error('命令执行超时，已终止（可能是杀毒软件拦截或系统响应缓慢）'))
    }, timeout)

    child.stdout.on('data', (d) => outChunks.push(d))
    child.stderr.on('data', (d) => errChunks.push(d))

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(`无法启动 PowerShell：${err.message}`))
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const stdout = Buffer.concat(outChunks).toString('utf8')
      const stderr = Buffer.concat(errChunks).toString('utf8')
      if (code !== 0) {
        const detail = (stderr || stdout || '').trim()
        const err = new Error(cleanPowerShellError(detail) || `PowerShell 退出码 ${code}`)
        err.raw = detail
        err.code = code
        return reject(err)
      }
      resolve(stdout)
    })
  })
}

/** 清理 PowerShell 冗长的错误堆栈，只保留可读信息 */
function cleanPowerShellError(text) {
  if (!text) return ''
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const meaningful = lines.filter(
    (l) => !/^\+/.test(l) && !/^所在位置/.test(l) && !/^CategoryInfo/.test(l) && !/^FullyQualifiedErrorId/.test(l)
  )
  return meaningful.slice(0, 3).join(' | ')
}

/**
 * 执行 PowerShell 脚本并解析其输出的 JSON
 * @param {string} script
 * @param {{timeout?: number}} [options]
 */
async function runPowerShellJson(script, options) {
  const text = (await runPowerShell(script, options)).trim()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Error(`解析系统返回数据失败：${text.slice(0, 300)}`)
  }
}

/** 拼接“返回 JSON 结果”的 try/catch 包装，避免异常直接中断进程 */
function wrapJson(body, extraPrelude = '') {
  return `
${extraPrelude}
try {
${body}
} catch {
  @{ ok = $false; message = $_.Exception.Message } | ConvertTo-Json -Depth 6 -Compress
}
`
}

module.exports = { runPowerShell, runPowerShellJson, psQuote, wrapJson, cleanPowerShellError }
