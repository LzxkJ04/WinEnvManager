/**
 * WemTable 纯函数引擎。不依赖 Vue。
 *
 * 筛选对象（按列 key）：
 * - text:  { keyword, exact, caseSensitive, values: string[] }
 * - enum:  { values: Array<string|number> }
 * - number/size: { min, max }  空字符串表示不限制；size 可用 10MB 这类写法
 * - date:  { preset: ''|'today'|'d7'|'d30', start, end }  preset 优先于手填范围
 *
 * 条件格式规则：靠前的整条覆盖靠后的（先命中先生效）。
 * scope=cell 只装饰 columnKey 那一列；scope=row 命中后装饰整行。
 */

export function parseSemver(value) {
  if (value == null) return null
  const text = String(value).trim()
  if (!text) return null
  const parts = text.match(/\d+/g)
  if (!parts || !parts.length) return null
  return parts.map((n) => Number(n))
}

export function parseSize(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN
  if (value == null) return NaN
  const text = String(value).trim().replace(/,/g, '')
  if (!text) return NaN
  const matched = text.match(/^(-?\d+(?:\.\d+)?)\s*([kmgt]?i?b|bytes?)?$/i)
  if (!matched) {
    const n = Number(text)
    return Number.isFinite(n) ? n : NaN
  }
  const n = Number(matched[1])
  const unit = String(matched[2] || 'b').toLowerCase().replace(/ytes?$/, '').replace(/s$/, '')
  const table = { b: 1, k: 1024, kb: 1024, m: 1024 ** 2, mb: 1024 ** 2, g: 1024 ** 3, gb: 1024 ** 3, t: 1024 ** 4, tb: 1024 ** 4, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 }
  const mult = table[unit] || 1
  return n * mult
}

export function rawValue(row, column) {
  if (!row || !column) return undefined
  const key = column.dataIndex || column.key
  return key == null ? undefined : row[key]
}

function pad(n) {
  return String(n).padStart(2, '0')
}

function formatDate(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim()
  const time = toTime(value)
  if (Number.isNaN(time)) return value == null ? '' : String(value)
  const date = new Date(time)
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  if (date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0) return day
  return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function displayText(row, column) {
  const value = rawValue(row, column)
  if (value == null || value === '') return ''
  if (column?.type === 'enum') return enumLabel(column, value)
  if (column?.type === 'date') return formatDate(value)
  return String(value)
}

function enumLabel(column, value) {
  const options = column?.enumOptions || []
  const hit = options.find((item) => String(item.value) === String(value))
  return hit ? String(hit.label ?? hit.value) : String(value)
}

function toTime(value) {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN
  if (value == null) return NaN
  const text = String(value).trim()
  if (!text) return NaN
  const day = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (day) return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])).getTime()
  return Date.parse(text)
}

function isVersionColumn(column) {
  if (!column) return false
  if (column.type === 'version') return true
  const blob = `${column.key || ''} ${column.dataIndex || ''} ${column.title || ''}`
  return blob.includes('版本') || /version/i.test(blob)
}

function isSortEmpty(value, column) {
  if (value == null) return true
  if (typeof value === 'string' && value.trim() === '') return true
  const type = column?.type
  if (type === 'number') return !Number.isFinite(Number(value))
  if (type === 'size') return !Number.isFinite(parseSize(value))
  if (type === 'date') return Number.isNaN(toTime(value))
  return false
}

function compareSemver(a, b) {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (!pa && !pb) return String(a ?? '').localeCompare(String(b ?? ''), 'zh')
  if (!pa) return 1
  if (!pb) return -1
  const length = Math.max(pa.length, pb.length)
  for (let i = 0; i < length; i += 1) {
    const da = pa[i] || 0
    const db = pb[i] || 0
    if (da !== db) return da - db
  }
  return 0
}

export function compareValues(a, b, column = {}) {
  const type = column.type || 'text'
  if (type === 'number' || type === 'size') {
    const na = type === 'size' ? parseSize(a) : Number(a)
    const nb = type === 'size' ? parseSize(b) : Number(b)
    const fa = Number.isFinite(na)
    const fb = Number.isFinite(nb)
    if (!fa && !fb) return 0
    if (!fa) return 1
    if (!fb) return -1
    return na - nb
  }
  if (type === 'date') {
    const ta = toTime(a)
    const tb = toTime(b)
    const fa = !Number.isNaN(ta)
    const fb = !Number.isNaN(tb)
    if (!fa && !fb) return 0
    if (!fa) return 1
    if (!fb) return -1
    return ta - tb
  }
  if (isVersionColumn(column)) return compareSemver(a, b)
  const sa = type === 'enum' ? enumLabel(column, a) : (a == null ? '' : String(a))
  const sb = type === 'enum' ? enumLabel(column, b) : (b == null ? '' : String(b))
  return sa.localeCompare(sb, 'zh')
}

function columnMap(columns) {
  const map = new Map()
  ;(columns || []).forEach((column) => {
    if (!column) return
    if (column.key != null) map.set(column.key, column)
    if (column.dataIndex != null) map.set(column.dataIndex, column)
  })
  return map
}

export function sortRows(rows, columns, sorts) {
  const list = Array.isArray(rows) ? rows : []
  const active = (sorts || []).filter((item) => item && item.key && item.order).slice(0, 3)
  if (!active.length) return list.slice()
  const map = columnMap(columns)
  const indexed = list.map((row, index) => ({ row, index }))
  indexed.sort((a, b) => {
    for (const sort of active) {
      const column = map.get(sort.key) || { key: sort.key, type: 'text' }
      const va = rawValue(a.row, column)
      const vb = rawValue(b.row, column)
      const ea = isSortEmpty(va, column)
      const eb = isSortEmpty(vb, column)
      if (ea && eb) continue
      if (ea) return 1
      if (eb) return -1
      const compared = compareValues(va, vb, column)
      if (compared !== 0) return sort.order === 'desc' ? -compared : compared
    }
    return a.index - b.index
  })
  return indexed.map((item) => item.row)
}

function startOfDay(date) {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function endOfDay(date) {
  const next = new Date(date)
  next.setHours(23, 59, 59, 999)
  return next
}

function dateBounds(filter, now = new Date()) {
  if (!filter) return [null, null]
  if (filter.preset === 'today') return [startOfDay(now), endOfDay(now)]
  if (filter.preset === 'd7') {
    const start = startOfDay(now)
    start.setDate(start.getDate() - 6)
    return [start, endOfDay(now)]
  }
  if (filter.preset === 'd30') {
    const start = startOfDay(now)
    start.setDate(start.getDate() - 29)
    return [start, endOfDay(now)]
  }
  const start = filter.start ? startOfDay(new Date(toTime(filter.start))) : null
  const end = filter.end ? endOfDay(new Date(toTime(filter.end))) : null
  return [
    start && !Number.isNaN(start.getTime()) ? start : null,
    end && !Number.isNaN(end.getTime()) ? end : null
  ]
}

export function isFilterActive(filter, type = 'text') {
  if (!filter || typeof filter !== 'object') return false
  if (type === 'number' || type === 'size') {
    return (filter.min !== '' && filter.min != null) || (filter.max !== '' && filter.max != null)
  }
  if (type === 'date') return !!(filter.preset || filter.start || filter.end)
  if (type === 'enum') return Array.isArray(filter.values) && filter.values.length > 0
  if (filter.keyword && String(filter.keyword).trim()) return true
  return Array.isArray(filter.values) && filter.values.length > 0
}

function matchText(row, column, filter) {
  const text = displayText(row, column)
  if (Array.isArray(filter.values) && filter.values.length) {
    if (!filter.values.map(String).includes(text)) return false
  }
  const keyword = filter.keyword == null ? '' : String(filter.keyword)
  if (!keyword.trim()) return true
  const source = filter.caseSensitive ? text : text.toLowerCase()
  const query = filter.caseSensitive ? keyword : keyword.toLowerCase()
  if (filter.exact) return source === query
  return source.includes(query)
}

function matchNumber(row, column, filter) {
  const raw = rawValue(row, column)
  const value = column.type === 'size' ? parseSize(raw) : Number(raw)
  if (!Number.isFinite(value)) return false
  const parseBound = (input) => {
    if (input === '' || input == null) return null
    const n = column.type === 'size' ? parseSize(input) : Number(input)
    return Number.isFinite(n) ? n : null
  }
  const min = parseBound(filter.min)
  const max = parseBound(filter.max)
  if (min != null && value < min) return false
  if (max != null && value > max) return false
  return true
}

function matchDate(row, column, filter) {
  const time = toTime(rawValue(row, column))
  if (Number.isNaN(time)) return false
  const [start, end] = dateBounds(filter)
  if (start && time < start.getTime()) return false
  if (end && time > end.getTime()) return false
  return true
}

function matchEnum(row, column, filter) {
  const raw = rawValue(row, column)
  return (filter.values || []).map(String).includes(String(raw))
}

function matchColumn(row, column, filter) {
  const type = column?.type || 'text'
  if (type === 'number' || type === 'size') return matchNumber(row, column, filter)
  if (type === 'date') return matchDate(row, column, filter)
  if (type === 'enum') return matchEnum(row, column, filter)
  return matchText(row, column, filter)
}

export function applyFilters(rows, columns, filters) {
  const list = Array.isArray(rows) ? rows : []
  const map = columnMap(columns)
  const entries = Object.entries(filters || {}).filter(([key, filter]) => {
    const column = map.get(key) || { key, type: 'text' }
    return isFilterActive(filter, column.type || 'text')
  })
  if (!entries.length) return list.slice()
  return list.filter((row) => entries.every(([key, filter]) => {
    const column = map.get(key) || { key, dataIndex: key, type: 'text' }
    return matchColumn(row, column, filter)
  }))
}

export function autofitWidth(texts, options = {}) {
  const minWidth = Number.isFinite(Number(options.minWidth)) ? Number(options.minWidth) : 80
  const maxWidth = Number.isFinite(Number(options.maxWidth)) ? Number(options.maxWidth) : 640
  const padding = Number.isFinite(Number(options.padding)) ? Number(options.padding) : 24
  let max = 0
  ;(Array.isArray(texts) ? texts : []).forEach((item) => {
    const text = item == null ? '' : String(item)
    let width = 0
    for (const ch of text) {
      width += ch.codePointAt(0) > 255 ? 14 : 8
    }
    if (width > max) max = width
  })
  const width = Math.ceil(max + padding)
  return Math.max(minWidth, Math.min(maxWidth, Math.max(width, minWidth)))
}

function isEmptyValue(value) {
  return value == null || (typeof value === 'string' && value.trim() === '')
}

function ruleValueOf(rule, row, column, value, columns) {
  const key = rule?.columnKey
  if (!key) return value
  if (column && (column.key === key || column.dataIndex === key)) return value
  const target = (columns || []).find((item) => item && (item.key === key || item.dataIndex === key))
  if (target) return rawValue(row, target)
  return row ? row[key] : undefined
}

function matchCondition(rule, raw) {
  const type = rule?.type || 'text'
  const op = rule?.op || 'contains'
  if (op === 'empty') return isEmptyValue(raw)
  if (op === 'notEmpty') return !isEmptyValue(raw)
  if (type === 'number' || type === 'size') {
    const value = type === 'size' ? parseSize(raw) : Number(raw)
    const left = type === 'size' ? parseSize(rule.value) : Number(rule.value)
    const right = type === 'size' ? parseSize(rule.value2) : Number(rule.value2)
    if (!Number.isFinite(value)) return false
    if (op === 'gt') return value > left
    if (op === 'gte') return value >= left
    if (op === 'lt') return value < left
    if (op === 'lte') return value <= left
    if (op === 'eq') return value === left
    if (op === 'neq') return value !== left
    if (op === 'between') {
      if (!Number.isFinite(left) || !Number.isFinite(right)) return false
      const min = Math.min(left, right)
      const max = Math.max(left, right)
      return value >= min && value <= max
    }
    return false
  }
  if (type === 'date') {
    const time = toTime(raw)
    const left = toTime(rule.value)
    const right = toTime(rule.value2)
    if (Number.isNaN(time)) return false
    if (op === 'before') return !Number.isNaN(left) && time < left
    if (op === 'after') return !Number.isNaN(left) && time > left
    if (op === 'eq') {
      if (Number.isNaN(left)) return false
      const a = startOfDay(new Date(time)).getTime()
      const b = startOfDay(new Date(left)).getTime()
      return a === b
    }
    if (op === 'between') {
      if (Number.isNaN(left) || Number.isNaN(right)) return false
      const min = Math.min(left, right)
      const max = endOfDay(new Date(Math.max(left, right))).getTime()
      return time >= startOfDay(new Date(min)).getTime() && time <= max
    }
    return false
  }
  const text = raw == null ? '' : String(raw)
  if (op === 'in') {
    const list = Array.isArray(rule.value)
      ? rule.value.map(String)
      : String(rule.value ?? '').split(',').map((item) => item.trim()).filter(Boolean)
    return list.includes(text)
  }
  const sample = rule.value == null ? '' : String(rule.value)
  if (op === 'eq') return text === sample
  if (op === 'neq') return text !== sample
  const source = text.toLowerCase()
  const query = sample.toLowerCase()
  if (op === 'contains') return source.includes(query)
  if (op === 'notContains') return !source.includes(query)
  if (op === 'startsWith') return source.startsWith(query)
  if (op === 'endsWith') return source.endsWith(query)
  return false
}

function styleFromRule(rule, audit) {
  const style = {}
  if (rule.background) style.background = rule.background
  if (!audit && rule.color) style.color = rule.color
  if (rule.bold) style.fontWeight = '700'
  if (rule.italic) style.fontStyle = 'italic'
  return style
}

export function applyFormats(value, row, column, rules, options = {}) {
  const list = Array.isArray(rules) ? rules : []
  const key = column?.key || column?.dataIndex
  for (const rule of list) {
    if (!rule || rule.enabled === false) continue
    const scope = rule.scope === 'row' ? 'row' : 'cell'
    if (scope === 'cell' && rule.columnKey && rule.columnKey !== key && rule.columnKey !== column?.dataIndex) continue
    if (scope === 'row' && !rule.columnKey) continue
    const sample = ruleValueOf(rule, row, column, value, options.columns)
    if (!matchCondition(rule, sample)) continue
    return styleFromRule(rule, !!options.audit)
  }
  return {}
}

function csvCell(value) {
  const text = value == null ? '' : String(value)
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function plainCell(value) {
  return (value == null ? '' : String(value)).replace(/[\t\r\n]+/g, ' ')
}

function htmlEscape(value) {
  return (value == null ? '' : String(value))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function exportColumns(columns, rows, options) {
  const includeHidden = !!options.includeHidden
  const cols = (columns || []).filter((column) => {
    if (!column) return false
    if (includeHidden) return column.key !== '__select' && column.key !== '__drag' && column.key !== '__expand'
    return column.visible !== false && column.hidden !== true
  })
  if (!options.includeStatus) return cols
  const known = new Set()
  ;(columns || []).forEach((column) => {
    if (column?.key) known.add(column.key)
    if (column?.dataIndex) known.add(column.dataIndex)
  })
  const extra = new Set()
  ;(rows || []).forEach((row) => {
    Object.keys(row || {}).forEach((key) => {
      if (known.has(key) || key.startsWith('__')) return
      if (key === 'status' || key === 'state' || key === 'enabled' || key.startsWith('_') || key.includes('状态')) {
        extra.add(key)
      }
    })
  })
  extra.forEach((key) => {
    cols.push({ key, dataIndex: key, title: key, type: 'text', visible: true })
  })
  return cols
}

function cellExport(row, column, format) {
  if (format === 'json') {
    const value = rawValue(row, column)
    return value == null ? null : value
  }
  return displayText(row, column)
}

export function exportText(rows, columns, format, options = {}) {
  const kind = format || 'csv'
  const list = Array.isArray(rows) ? rows : []
  const cols = exportColumns(columns, list, options)
  const includeHeader = options.includeHeader !== false
  if (kind === 'json') {
    const data = list.map((row) => {
      const item = {}
      cols.forEach((column) => {
        item[column.key || column.dataIndex] = cellExport(row, column, 'json')
      })
      return item
    })
    return JSON.stringify(data, null, 2)
  }
  if (kind === 'html') {
    const head = includeHeader
      ? `<thead><tr>${cols.map((column) => `<th>${htmlEscape(column.title || column.key)}</th>`).join('')}</tr></thead>`
      : ''
    const body = list.map((row) => `<tr>${cols.map((column) => `<td>${htmlEscape(displayText(row, column))}</td>`).join('')}</tr>`).join('')
    return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><table border="1" cellspacing="0" cellpadding="4">${head}<tbody>${body}</tbody></table></body></html>`
  }
  const sep = ','
  const useCsv = kind === 'csv'
  const lines = []
  if (includeHeader) {
    const titles = cols.map((column) => column.title || column.key || '')
    lines.push(useCsv ? titles.map(csvCell).join(sep) : titles.map(plainCell).join('\t'))
  }
  list.forEach((row) => {
    const cells = cols.map((column) => displayText(row, column))
    lines.push(useCsv ? cells.map(csvCell).join(sep) : cells.map(plainCell).join('\t'))
  })
  return lines.join('\r\n')
}
