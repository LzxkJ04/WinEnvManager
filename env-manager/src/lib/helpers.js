/**
 * 渲染端通用工具：草稿校验、敏感值识别、来源标记、格式化
 */

export const SOURCE_LABEL = {
  manual: { label: '手动修改', color: 'blue' },
  'env-market': { label: '开发环境', color: 'purple' },
  'config-set': { label: '配置集', color: 'cyan' },
  audit: { label: '审计修复', color: 'orange' },
  import: { label: '批量导入', color: 'geekblue' }
}

export function sourceLabel(s) {
  return (SOURCE_LABEL[s] || { label: '手动修改', color: 'blue' }).label
}
export function sourceColor(s) {
  return (SOURCE_LABEL[s] || { color: 'blue' }).color
}

/** 敏感值识别（与主进程 analyze.js 保持同一套规则） */
const SENSITIVE_RULES = [
  { id: 'aws-key', label: 'AWS Access Key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'private-key', label: '私钥内容', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: 'jwt', label: 'JWT Token', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/ },
  { id: 'api-key', label: 'API Key', re: /\b(sk|pk|rk|api|token|key)[_-]?[A-Za-z0-9]{24,}\b/i },
  { id: 'hex-secret', label: '十六进制密钥', re: /\b[a-f0-9]{40,}\b/i },
  { id: 'pwd-in-name', label: '口令类变量', re: /(password|passwd|pwd|secret|token|apikey|api_key|access[_-]?key)/i },
  { id: 'conn-string', label: '连接串口令', re: /(password|pwd)=[^;\s]{4,}/i }
]

export function detectSensitive(name, value) {
  const text = `${name}\n${value}`
  const hits = []
  for (const r of SENSITIVE_RULES) {
    if (r.re.test(text)) hits.push(r.label)
  }
  return hits
}

export function maskValue(value) {
  let out = String(value || '')
  out = out.replace(/\b([A-Za-z0-9_-]{8})[A-Za-z0-9_-]{16,}([A-Za-z0-9_-]{4})\b/g, (m, a, b) => `${a}****${b}`)
  out = out.replace(/(password|passwd|pwd|secret|token|apikey|api_key|access[_-]?key)([=:]\s*)(\S+)/gi,
    (m, a, b, c) => `${a}${b}${'*'.repeat(Math.min(12, c.length))}`)
  return out
}

/** 导出用脱敏：长密钥打码；规则命中但正文没变化时整段换成星号。 */
export function maskSensitiveExport(name, value) {
  const raw = value == null ? '' : String(value)
  const masked = maskValue(raw)
  if (detectSensitive(name, raw).length && masked === raw) return '****'
  return masked
}

/** Windows 内置变量（引用校验时视为存在） */
export const BUILTIN_VARS = new Set([
  'SYSTEMROOT', 'SYSTEMDRIVE', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
  'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'COMMONPROGRAMFILES', 'COMMONPROGRAMFILES(X86)',
  'PUBLIC', 'ALLUSERSPROFILE', 'TEMP', 'TMP', 'COMPUTERNAME', 'USERNAME', 'USERDOMAIN', 'OS',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'PROCESSOR_IDENTIFIER', 'PROCESSOR_LEVEL',
  'PROCESSOR_REVISION', 'PATHEXT', 'COMSPEC', 'WINDIR', 'PSMODULEPATH', 'DRIVERDATA', 'ERRORLEVEL'
])

/**
 * 草稿前置校验（对应保存弹窗「区域2：前置校验结果面板」）
 * @returns {{errors:[], warns:[], pass:boolean}}
 */
export function validateDraft(changes, original, opts = {}) {
  const errors = []
  const warns = []

  const known = new Set()
  for (const scope of ['user', 'machine']) {
    for (const [k, v] of Object.entries(original[scope] || {})) known.add(k.toUpperCase())
  }
  // 草稿新增的变量也视为存在
  for (const c of changes) {
    if (c.action !== 'delete') known.add(String(c.name).toUpperCase())
  }

  let pathLength = 0
  for (const c of changes) {
    const name = String(c.name || '')
    // 1. 变量名合法性
    if (!name.trim()) errors.push(`存在空变量名`)
    if (/[=%]/.test(name)) errors.push(`变量名「${name}」包含非法字符 = 或 %`)
    if (/[\u0000-\u001f]/.test(name)) errors.push(`变量名「${name}」包含不可见控制字符`)
    if (name.length > 255) errors.push(`变量名「${name}」超过 255 字符`)

    // 2. PATH 长度
    if (name.toUpperCase() === 'PATH') {
      pathLength += String(c.value || '').length
    }

    // 3. 断裂引用
    const refs = String(c.value || '').match(/%([^%|=\s]+)%/g) || []
    for (const r of refs) {
      const n = r.slice(1, -1).toUpperCase()
      if (!known.has(n) && !BUILTIN_VARS.has(n)) {
        warns.push(`${c.scope === 'machine' ? '系统' : '用户'}变量 ${name} 引用了未定义的 %${n}%`)
      }
    }

    // 4. 敏感值提醒（设置关闭后不再提示，用户仍可在导出时主动脱敏）
    if (opts.detectSensitive !== false && detectSensitive(name, c.value).length) {
      warns.push(`变量 ${name} 疑似包含密钥 / 口令，导出备份时建议脱敏`)
    }
  }

  if (opts.validatePath !== false) {
    if (pathLength > 2047) errors.push(`PATH 总长度 ${pathLength} 字符，已超过注册表 2047 上限`)
    else if (pathLength > 1800) warns.push(`PATH 总长度 ${pathLength} 字符，接近 2047 上限`)
  }

  return { errors, warns, pass: errors.length === 0 }
}

/** 展开字符串中的 %VAR%（基于给定变量表） */
export function expandVars(text, maps) {
  return String(text || '').replace(/%([^%]+)%/g, (m, n) => {
    const key = n.toUpperCase()
    for (const scope of ['user', 'machine']) {
      const map = maps[scope] || {}
      const hit = Object.keys(map).find((k) => k.toUpperCase() === key)
      if (hit !== undefined) return map[hit]
    }
    return m
  })
}

export function formatBytes(n) {
  const v = Number(n) || 0
  if (v < 1024) return `${v} B`
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`
  if (v < 1024 * 1024 * 1024) return `${(v / 1024 / 1024).toFixed(2)} MB`
  return `${(v / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function formatSpeed(n) {
  return `${formatBytes(n)}/s`
}

export function formatTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function clipText(v, n = 90) {
  const s = String(v ?? '')
  return s.length > n ? s.slice(0, n) + '…' : s || '（空）'
}

const LIST_ENV_NAMES = new Set(['PATH', 'PATHEXT', 'PSMODULEPATH'])

function splitListValue(value) {
  return String(value || '').split(';').map((part) => part.trim()).filter(Boolean)
}

/** 路径类变量按分号去重合并：保留当前顺序，只追加还没有的项。比较时忽略大小写。 */
export function mergeListValue(current, incoming) {
  const seen = new Set()
  const out = []
  for (const part of [...splitListValue(current), ...splitListValue(incoming)]) {
    const key = part.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(part)
  }
  return out.join(';')
}

/**
 * 导入冲突的「合并」：
 * PATH / PATHEXT / PSMODULEPATH，或任一侧带分号的值，按条目去重追加。
 * 其它变量保留当前非空值，避免把 JAVA_HOME 这类单值拼坏。
 */
export function mergeImportedValue(name, current, incoming) {
  const upper = String(name || '').toUpperCase()
  const cur = current == null ? '' : String(current)
  const next = incoming == null ? '' : String(incoming)
  if (LIST_ENV_NAMES.has(upper) || cur.includes(';') || next.includes(';')) return mergeListValue(cur, next)
  return cur || next
}

/** 生成 CMD set / PowerShell 脚本 */
export function buildScript(vars, shell) {
  const lines = []
  if (shell === 'cmd') {
    lines.push('@echo off')
    lines.push('REM 由 WinEnv管家 生成的环境变量脚本')
    for (const v of vars) {
      lines.push(v.action === 'delete' ? `set ${v.name}=` : `set "${v.name}=${String(v.value).replace(/"/g, '')}"`)
    }
  } else {
    lines.push('# 由 WinEnv管家 生成的环境变量脚本')
    for (const v of vars) {
      lines.push(v.action === 'delete' ? `Remove-Item Env:\\${v.name} -ErrorAction SilentlyContinue` : `$Env:${v.name} = "${String(v.value).replace(/"/g, '`"')}"`)
    }
  }
  return lines.join('\r\n')
}

/** 生成 Markdown 变更说明文档 */
export function buildMarkdownChangelog(changes, meta = {}) {
  const lines = ['# WinEnv管家 环境变量变更说明', '']
  lines.push(`- 生成时间：${new Date().toLocaleString('zh-CN')}`)
  if (meta.note) lines.push(`- 备注：${meta.note}`)
  lines.push(`- 变更条目：${changes.length}`)
  lines.push('')
  const groups = {}
  for (const c of changes) {
    const s = c.source || 'manual'
    groups[s] = groups[s] || []
    groups[s].push(c)
  }
  for (const [src, list] of Object.entries(groups)) {
    lines.push(`## ${sourceLabel(src)}（${list.length} 条）`)
    lines.push('')
    lines.push('| 变更 | 归属 | 变量名 | 新值 |')
    lines.push('| --- | --- | --- | --- |')
    for (const c of list) {
      const op = { create: '新增', update: '修改', delete: '删除' }[c.action] || c.action
      lines.push(`| ${op} | ${c.scope === 'machine' ? '系统' : '用户'} | ${c.name} | \`${clipText(c.value, 80)}\` |`)
    }
    lines.push('')
  }
  return lines.join('\r\n')
}
