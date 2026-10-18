'use strict'
/**
 * 批量导入解析器：.env / .properties / 纯文本 key=value
 * 规则见产品文档【九、模块8 · 批量导入 .env/.properties 字段映射规则】
 */
const path = require('node:path')

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/

function isBlank(line) {
  return !line || !line.trim()
}

/** 展开转义 */
function unescapeEnvValue(s) {
  return String(s).replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, '\\')
}

/** 展开.properties转义，含 \uXXXX */
function unescapePropsValue(s) {
  return String(s).replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\=/g, '=').replace(/\\:/g, ':').replace(/\\\\/g, '\\')
}

/**
 * 解析 .env
 * @returns {{entries:Array, issues:Array}}
 */
function parseDotEnv(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/)
  const entries = []
  const issues = []

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (isBlank(line)) continue
    const trimmed = line.trim()
    if (trimmed.startsWith('#')) continue // 注释行

    const eq = line.indexOf('=')
    if (eq <= 0) {
      issues.push({ line: i + 1, text: line, level: 'warn', message: '缺少等号，已跳过' })
      continue
    }

    const rawKey = line.slice(0, eq).trim()
    let value = line.slice(eq + 1)

    // 引号包裹（支持跨行）
    let closed = true
    const first = value.trim()[0]
    if (first === '"' || first === "'") {
      const quote = first
      let buf = value
      // 去掉首引号后，若本行未闭合则继续吞并后续行
      let body = buf.trim().slice(1)
      while (!hasClosingQuote(body, quote) && i + 1 < lines.length) {
        i += 1
        body += '\n' + lines[i]
      }
      if (!hasClosingQuote(body, quote)) {
        closed = false
        issues.push({ line: i + 1, text: lines[i], level: 'warn', message: '引号未闭合，按原样保留' })
      } else {
        const idx = body.lastIndexOf(quote)
        value = body.slice(0, idx)
      }
      if (closed) {
        value = quote === '"' ? unescapeEnvValue(value) : value
      }
    }

    // ${VAR} -> %VAR%
    value = value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, n) => `%${n}%`)

    const keyIssue = checkKey(rawKey)
    if (keyIssue) {
      issues.push({ line: i + 1, text: line, level: 'error', message: keyIssue, key: rawKey, value })
      entries.push({ key: rawKey, value, line: i + 1, issues: [keyIssue], kind: 'dotenv', valid: false })
      continue
    }

    entries.push({
      key: rawKey.toUpperCase(),          // .env 键名自动转大写
      originalKey: rawKey,
      value,
      line: i + 1,
      issues: [],
      kind: 'dotenv',
      isPathKey: rawKey.toUpperCase() === 'PATH',
      valid: true
    })
  }

  return { entries, issues }
}

function hasClosingQuote(body, quote) {
  // 简化判定：以引号结尾视为闭合（忽略转义复杂性）
  return body.trimEnd().endsWith(quote)
}

function checkKey(rawKey) {
  const k = String(rawKey || '').trim()
  if (!k) return '禁止空键名'
  if (k.startsWith('=')) return '变量名不能以等号开头'
  if (!KEY_RE.test(k)) return `键名包含非法字符：${k}`
  if (k.length > 255) return '键名过长'
  return null
}

/**
 * 解析 .properties
 */
function parseProperties(text) {
  const rawLines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/)
  const entries = []
  const issues = []

  // 先合并反斜杠续行
  const lines = []
  for (let i = 0; i < rawLines.length; i += 1) {
    let cur = rawLines[i]
    while (/\\$/.test(cur) && i + 1 < rawLines.length) {
      cur = cur.replace(/\\$/, '') + rawLines[i + 1]
      i += 1
    }
    lines.push(cur)
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (isBlank(line)) continue
    const t = line.trim()
    if (t.startsWith('#') || t.startsWith('!')) continue

    let eq = -1
    for (let j = 0; j < line.length; j += 1) {
      const ch = line[j]
      if (ch === '\\') { j += 1; continue }   // 跳过转义字符
      if (ch === '=' || ch === ':') { eq = j; break }
    }
    if (eq <= 0) {
      issues.push({ line: i + 1, text: line, level: 'warn', message: '缺少键值分隔符，已跳过' })
      continue
    }

    const rawKey = line.slice(0, eq).trim().replace(/\\(.)/g, '$1')
    const value = unescapePropsValue(line.slice(eq + 1).trim())

    const keyIssue = checkKey(rawKey)
    if (keyIssue) {
      issues.push({ line: i + 1, text: line, level: 'error', message: keyIssue, key: rawKey, value })
      entries.push({ key: rawKey, value, line: i + 1, issues: [keyIssue], kind: 'properties', valid: false })
      continue
    }

    entries.push({
      key: rawKey,
      originalKey: rawKey,
      value,
      line: i + 1,
      issues: [],
      kind: 'properties',
      isPathKey: rawKey.toUpperCase() === 'PATH',
      valid: true
    })
  }

  return { entries, issues }
}

/** 纯文本 key=value */
function parsePlain(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/)
  const entries = []
  const issues = []
  let scope = 'user'
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim()
    if (!t) continue
    if (t.startsWith('#')) continue
    if (t.startsWith('[')) {
      scope = /系统|MACHINE|SYSTEM/i.test(t) ? 'machine' : 'user'
      continue
    }
    const eq = t.indexOf('=')
    if (eq <= 0) {
      issues.push({ line: i + 1, text: t, level: 'warn', message: '缺少等号，已跳过' })
      continue
    }
    const rawKey = t.slice(0, eq).trim()
    const value = t.slice(eq + 1)
    const keyIssue = checkKey(rawKey)
    entries.push({
      key: rawKey, originalKey: rawKey, value, line: i + 1,
      issues: keyIssue ? [keyIssue] : [], kind: 'plain', valid: !keyIssue,
      defaultScope: scope
    })
  }
  return { entries, issues }
}

/** 自动识别格式并解析 */
function parseAuto(text, fileName) {
  const clean = String(text || '').replace(/^\uFEFF/, '')
  const ext = path.extname(fileName || '').toLowerCase()
  if (ext === '.env' || /^[A-Za-z_][A-Za-z0-9_]*=/m.test(clean.trim().split('\n')[0] || '') === false && ext !== '.properties') {
    // 继续走自动判断
  }
  if (ext === '.properties') return parseProperties(clean)
  if (ext === '.env') return parseDotEnv(clean)

  // 无扩展名时启发式：包含 spring. 或点号键名较多 → properties；否则 .env
  const sample = clean.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#')).slice(0, 30)
  const dotKeys = sample.filter((l) => /^[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]*\s*[=:]/.test(l)).length
  const upperKeys = sample.filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l.trim())).length
  if (dotKeys > upperKeys) return parseProperties(clean)
  return parseDotEnv(clean)
}

module.exports = { parseDotEnv, parseProperties, parsePlain, parseAuto, checkKey }
