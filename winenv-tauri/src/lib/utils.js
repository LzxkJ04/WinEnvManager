import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function fmtBytes(n) {
  const v = Number(n) || 0
  if (v < 1024) return `${v} B`
  if (v < 1048576) return `${(v / 1024).toFixed(1)} KB`
  if (v < 1073741824) return `${(v / 1048576).toFixed(2)} MB`
  return `${(v / 1073741824).toFixed(2)} GB`
}

export function fmtSpeed(n) {
  return `${fmtBytes(n)}/s`
}

export function fmtTime(ts) {
  if (!ts) return '—'
  const d = new Date(Number(ts))
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function clip(v, n = 90) {
  const s = String(v ?? '')
  return s.length > n ? s.slice(0, n) + '…' : s || '（空）'
}

/** Windows 内置变量（引用校验时视为存在） */
export const BUILTIN_VARS = new Set([
  'SYSTEMROOT', 'SYSTEMDRIVE', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
  'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'COMMONPROGRAMFILES', 'COMMONPROGRAMFILES(X86)',
  'PUBLIC', 'ALLUSERSPROFILE', 'TEMP', 'TMP', 'COMPUTERNAME', 'USERNAME', 'USERDOMAIN', 'OS',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'PROCESSOR_IDENTIFIER', 'PROCESSOR_LEVEL',
  'PROCESSOR_REVISION', 'PATHEXT', 'COMSPEC', 'WINDIR', 'PSMODULEPATH', 'DRIVERDATA'
])

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
  return SENSITIVE_RULES.filter((r) => r.re.test(text)).map((r) => r.label)
}

export function validateDraft(changes, original, opts = {}) {
  const errors = []
  const warns = []
  const known = new Set()
  for (const scope of ['user', 'machine']) {
    for (const k of Object.keys(original[scope] || {})) known.add(k.toUpperCase())
  }
  for (const c of changes) {
    if (c.action !== 'delete') known.add(String(c.name).toUpperCase())
  }
  let pathLength = 0
  for (const c of changes) {
    const name = String(c.name || '')
    if (!name.trim()) errors.push('存在空变量名')
    if (/[=%]/.test(name)) errors.push(`变量名「${name}」包含非法字符 = 或 %`)
    if (name.length > 255) errors.push(`变量名「${name}」超过 255 字符`)
    if (name.toUpperCase() === 'PATH') pathLength += String(c.value || '').length
    for (const r of String(c.value || '').match(/%([^%|=\s]+)%/g) || []) {
      const n = r.slice(1, -1).toUpperCase()
      if (!known.has(n) && !BUILTIN_VARS.has(n)) warns.push(`${name} 引用了未定义的 %${n}%`)
    }
    if (detectSensitive(name, c.value).length) warns.push(`变量 ${name} 疑似包含密钥/口令，导出备份时建议脱敏`)
  }
  if (opts.validatePath !== false) {
    if (pathLength > 2047) errors.push(`PATH 总长度 ${pathLength} 字符，已超过注册表 2047 上限`)
    else if (pathLength > 1800) warns.push(`PATH 总长度 ${pathLength} 字符，接近 2047 上限`)
  }
  return { errors, warns, pass: errors.length === 0 }
}

export const SOURCE_LABEL = {
  manual: { label: '手动修改', color: 'bg-blue-500/15 text-blue-600 dark:text-blue-400' },
  'env-market': { label: '开发环境', color: 'bg-purple-500/15 text-purple-600 dark:text-purple-400' },
  'config-set': { label: '配置集', color: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400' },
  audit: { label: '审计修复', color: 'bg-orange-500/15 text-orange-600 dark:text-orange-400' },
  import: { label: '批量导入', color: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400' }
}
export function sourceLabel(s) {
  return (SOURCE_LABEL[s] || SOURCE_LABEL.manual).label
}
export function sourceClass(s) {
  return (SOURCE_LABEL[s] || SOURCE_LABEL.manual).color
}

export function buildScript(vars, shell) {
  const lines = []
  if (shell === 'cmd') {
    lines.push('@echo off', 'REM 由 WinEnv管家 生成')
    for (const v of vars) lines.push(v.action === 'delete' ? `set ${v.name}=` : `set "${v.name}=${String(v.value).replace(/"/g, '')}"`)
  } else {
    lines.push('# 由 WinEnv管家 生成')
    for (const v of vars) lines.push(v.action === 'delete' ? `Remove-Item Env:\\${v.name} -ErrorAction SilentlyContinue` : `$Env:${v.name} = "${String(v.value).replace(/"/g, '`"')}"`)
  }
  return lines.join('\r\n')
}

export function buildMarkdownChangelog(changes) {
  const lines = ['# WinEnv管家 环境变量变更说明', '', `- 生成时间：${new Date().toLocaleString('zh-CN')}`, `- 变更条目：${changes.length}`, '']
  const groups = {}
  for (const c of changes) (groups[c.source || 'manual'] = groups[c.source || 'manual'] || []).push(c)
  for (const [src, list] of Object.entries(groups)) {
    lines.push(`## ${sourceLabel(src)}（${list.length} 条）`, '', '| 变更 | 归属 | 变量名 | 新值 |', '| --- | --- | --- | --- |')
    for (const c of list) {
      const op = { create: '新增', update: '修改', delete: '删除' }[c.action] || c.action
      lines.push(`| ${op} | ${c.scope === 'machine' ? '系统' : '用户'} | ${c.name} | \`${clip(c.value, 80)}\` |`)
    }
    lines.push('')
  }
  return lines.join('\r\n')
}
