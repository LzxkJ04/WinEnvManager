'use strict'
/**
 * .env / .properties 纯文本解析。
 * 重复键保留最后一条，并在 errors 里给出警告。
 * 变量名为空、含空白、含 = 或 ; 时，entries 仍保留并标 invalid:true。
 */

function parseEnvText(text, options) {
  const opts = options || {}
  const filename = opts.filename == null ? '' : String(opts.filename)
  const ignoreComments = opts.ignoreComments !== false
  const ignoreEmpty = opts.ignoreEmpty !== false
  const trimKey = opts.trimKey !== false
  const trimValue = opts.trimValue !== false
  const properties = isPropertiesFile(filename)

  const entries = []
  const errors = []
  const indexByKey = new Map()
  const lines = String(text == null ? '' : text).replace(/^\uFEFF/, '').split(/\r?\n/)

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1
    const raw = lines[i]
    if (!String(raw).trim()) {
      if (!ignoreEmpty) errors.push({ line: lineNo, message: '空行' })
      continue
    }
    if (ignoreComments && isCommentLine(raw, properties)) continue

    const split = properties ? splitProperties(raw) : splitDotenv(raw)
    if (!split) {
      errors.push({ line: lineNo, message: '无法解析该行' })
      continue
    }

    let key = properties ? unescapeProperties(split.key) : split.key
    let value = properties ? unescapeProperties(split.value) : finalizeDotenvValue(split.value, trimValue)
    if (trimKey) key = key.trim()
    if (properties && trimValue) value = value.trim()

    const entry = { key, value, line: lineNo, file: filename }
    const reason = invalidKeyReason(key)
    if (reason) {
      entry.invalid = true
      errors.push({ line: lineNo, message: reason })
    }

    if (indexByKey.has(key)) {
      errors.push({ line: lineNo, message: `重复变量「${key}」，已保留最后一条` })
      entries[indexByKey.get(key)] = entry
    } else {
      indexByKey.set(key, entries.length)
      entries.push(entry)
    }
  }

  return { entries, errors }
}

function isPropertiesFile(filename) {
  const base = String(filename || '').replace(/\\/g, '/').split('/').pop() || ''
  const dot = base.lastIndexOf('.')
  if (dot < 0) return false
  return base.slice(dot).toLowerCase() === '.properties'
}

function isCommentLine(line, properties) {
  const t = String(line).trimStart()
  if (t.startsWith('#')) return true
  return properties && t.startsWith('!')
}

/** .env：去掉可选的 export 前缀，按第一个 = 切开，引号外的 # 视为注释 */
function splitDotenv(raw) {
  const line = stripExport(String(raw))
  const eq = line.indexOf('=')
  if (eq < 0) return null
  return {
    key: line.slice(0, eq),
    value: stripUnquotedHash(line.slice(eq + 1))
  }
}

function stripExport(line) {
  const m = /^(\s*)export\s+([\s\S]*)$/.exec(line)
  if (!m || m[2].indexOf('=') < 0) return line
  return m[1] + m[2]
}

/** 引号内的 # 保留；引号外的 # 起注释 */
function stripUnquotedHash(input) {
  let quote = ''
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i]
    if (quote === '"' && c === '\\') {
      i += 1
      continue
    }
    if (quote) {
      if (c === quote) quote = ''
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      continue
    }
    if (c === '#') return input.slice(0, i)
  }
  return input
}

function finalizeDotenvValue(raw, trimValue) {
  const probe = String(raw).trim()
  if (probe.length >= 2) {
    const q = probe[0]
    if ((q === '"' || q === "'") && probe.endsWith(q)) {
      const inner = probe.slice(1, -1)
      return q === '"' ? unescapeDoubleQuoted(inner) : inner
    }
  }
  return trimValue ? String(raw).trim() : String(raw)
}

/** 双引号 .env：展开 \\ \" \' \n \r \t。单引号不走这里。 */
function unescapeDoubleQuoted(s) {
  let out = ''
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '\\' && i + 1 < s.length) {
      const n = s[i + 1]
      if (n === 'n') out += '\n'
      else if (n === 'r') out += '\r'
      else if (n === 't') out += '\t'
      else if (n === '\\' || n === '"' || n === "'") out += n
      else out += '\\' + n
      i += 1
      continue
    }
    out += s[i]
  }
  return out
}

/** .properties：第一个未转义的 = 或 : 为分隔符 */
function splitProperties(line) {
  const s = String(line)
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '\\') {
      i += 1
      continue
    }
    if (s[i] === '=' || s[i] === ':') {
      return { key: s.slice(0, i), value: s.slice(i + 1) }
    }
  }
  return null
}

/** \\ \n \t，其余 \X 去掉反斜杠保留 X（这样 \= \: 不会被当成分隔符） */
function unescapeProperties(s) {
  const src = String(s)
  let out = ''
  for (let i = 0; i < src.length; i += 1) {
    if (src[i] === '\\' && i + 1 < src.length) {
      const n = src[i + 1]
      if (n === 'n') out += '\n'
      else if (n === 't') out += '\t'
      else if (n === '\\') out += '\\'
      else out += n
      i += 1
      continue
    }
    out += src[i]
  }
  return out
}

function invalidKeyReason(key) {
  if (key == null || String(key) === '') return '变量名为空'
  const reasons = []
  if (/\s/.test(key)) reasons.push('变量名含空格')
  if (String(key).includes('=')) reasons.push('变量名含 =')
  if (String(key).includes(';')) reasons.push('变量名含 ;')
  return reasons.join('；')
}

module.exports = { parseEnvText }
