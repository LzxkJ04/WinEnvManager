'use strict'
/**
 * 分析类 IPC：变量元数据 / 敏感值检测 / 引用图谱 / 使用统计 / 外部变更检测
 */
const fs = require('node:fs')
const path = require('node:path')
const meta = require('../lib/meta')
const registry = require('../lib/registry')
const ops = require('../lib/ops')
const store = require('../lib/store')
const { runPowerShell } = require('../lib/ps')

/** 敏感值识别规则 */
const SENSITIVE_RULES = [
  { id: 'aws-key', label: 'AWS Access Key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'private-key', label: '私钥内容', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: 'jwt', label: 'JWT Token', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/ },
  { id: 'api-key', label: 'API Key', re: /\b(sk|pk|rk|api|token|key)[_-]?[A-Za-z0-9]{24,}\b/i },
  { id: 'hex-secret', label: '十六进制密钥', re: /\b[a-f0-9]{40,}\b/i },
  { id: 'pwd-in-name', label: '口令类变量', re: /(password|passwd|pwd|secret|token|apikey|api_key|access[_-]?key)/i },
  { id: 'conn-string', label: '连接串口令', re: /(password|pwd)=[^;\s]{4,}/i }
]

function detectSensitive(name, value) {
  const text = `${name}\n${value}`
  const hits = []
  for (const r of SENSITIVE_RULES) {
    if (r.re.test(text)) hits.push(r.label)
  }
  return hits
}

/** 从变量值中提取 %引用%（排除含空格/等号/竖线的非法名） */
function extractRefs(value) {
  const out = []
  const re = /%([^%|=\s]+)%/g
  let m
  while ((m = re.exec(String(value || '')))) out.push(m[1].toUpperCase())
  return out
}

/**
 * 检测变量引用环。输入 [{name, value}]，返回环列表（每个环是变量名数组）。
 * 长度为 1 表示自引用（如 JAVA_HOME=%JAVA_HOME%\bin）。
 * 指向不存在变量的引用不算环（那是断裂引用，由 brokenRefs 负责）。
 */
function detectCycles(vars) {
  const graph = new Map()
  const self = new Set()
  for (const v of vars || []) {
    const n = String(v.name || '').toUpperCase()
    if (!n) continue
    if (!graph.has(n)) graph.set(n, new Set())
    for (const r of extractRefs(v.value)) {
      if (r === n) self.add(n)
      else graph.get(n).add(r)
    }
  }
  const color = new Map()
  const stack = []
  const found = []
  const dfs = (node) => {
    color.set(node, 'gray')
    stack.push(node)
    for (const nxt of graph.get(node) || []) {
      if (!graph.has(nxt)) continue
      const c = color.get(nxt)
      if (c === 'gray') found.push(stack.slice(stack.indexOf(nxt)))
      else if (c !== 'black') dfs(nxt)
    }
    stack.pop()
    color.set(node, 'black')
  }
  for (const n of graph.keys()) if (!color.has(n)) dfs(n)

  // 归一化去重：旋转到字典序最小的起点，并在正反两个方向里取较小者
  const seen = new Set()
  const cycles = []
  const push = (arr) => {
    const variants = [arr, [...arr].reverse()]
    let best = null
    for (const v of variants) {
      const min = v.reduce((a, b) => (a < b ? a : b))
      const i = v.indexOf(min)
      const key = v.slice(i).concat(v.slice(0, i)).join('>')
      if (best === null || key < best) best = key
    }
    if (!seen.has(best)) {
      seen.add(best)
      cycles.push(best.split('>'))
    }
  }
  for (const n of self) push([n])
  for (const c of found) push(c.map((s) => s.toUpperCase()))
  return cycles
}

function maskValue(value) {
  let out = String(value || '')
  out = out.replace(/\b([A-Za-z0-9_-]{8})[A-Za-z0-9_-]{16,}([A-Za-z0-9_-]{4})\b/g, (m, a, b) => `${a}****${b}`)
  out = out.replace(/(password|passwd|pwd|secret|token|apikey|api_key|access[_-]?key)([=:]\s*)(\S+)/gi,
    (m, a, b, c) => `${a}${b}${'*'.repeat(Math.min(12, c.length))}`)
  return out
}

function register(handle, ctx) {
  /* ------------------------------ 变量元数据 ------------------------------ */

  handle('meta:all', async () => ({ vars: meta.allVars(), path: meta.allPathMeta() }))

  handle('meta:set', async (e, p) => {
    const { scope, name, patch } = p || {}
    if (!scope || !name) throw new Error('缺少变量标识')
    return meta.setVar(scope, name, patch || {})
  })

  handle('meta:toggleFavorite', async (e, p) => meta.toggleFavorite(p.scope, p.name))

  handle('meta:setTags', async (e, p) => meta.setTags(p.scope, p.name, p.tags))

  handle('meta:setLocked', async (e, p) => meta.setVar(p.scope, p.name, { locked: !!p.locked }))

  handle('meta:removeVar', async (e, p) => meta.removeVar(p.scope, p.name))

  handle('meta:history', async (e, p) => meta.getHistory(p.scope, p.name))

  handle('meta:pathSet', async (e, p) => meta.setPathMeta(p.scope, p.path, p.patch || {}))

  handle('meta:markSensitive', async (e, p) => {
    const hits = detectSensitive(p.name, p.value)
    if (hits.length) meta.setVar(p.scope, p.name, { sensitive: true, sensitiveLabels: hits })
    return { hits }
  })

  /* ------------------------------ 敏感值批量扫描 ------------------------------ */

  handle('analyze:sensitiveScan', async () => {
    const { user, machine } = await registry.readAllEnv()
    const out = []
    for (const scope of ['user', 'machine']) {
      for (const v of scope === 'user' ? user : machine) {
        const hits = detectSensitive(v.name, v.value)
        if (hits.length) {
          out.push({ scope, name: v.name, value: v.value, labels: hits, masked: maskValue(v.value) })
        }
      }
    }
    return { total: out.length, items: out }
  })

  /* ------------------------------ 变量引用图谱 ------------------------------ */

  handle('analyze:refs', async (e, p) => {
    const name = String(p.name || '').toUpperCase()
    if (!name) throw new Error('缺少变量名')
    const { user, machine } = await registry.readAllEnv()
    const res = []
    for (const scope of ['user', 'machine']) {
      for (const v of scope === 'user' ? user : machine) {
        if (v.name.toUpperCase() === name) continue
        const re = new RegExp(`%${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}%`, 'i')
        if (re.test(String(v.value))) {
          res.push({ scope, name: v.name, value: v.value, kind: 'variable' })
        }
      }
    }
    // PATH 中引用
    for (const scope of ['user', 'machine']) {
      const hit = (scope === 'user' ? user : machine).find((v) => v.name.toUpperCase() === 'PATH')
      if (hit) {
        const entries = String(hit.value).split(';').map((s) => s.trim()).filter(Boolean)
        for (const e of entries) {
          const re = new RegExp(`%${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}%`, 'i')
          if (re.test(e)) res.push({ scope, name: 'PATH', value: e, kind: 'path-entry' })
        }
      }
    }
    return { name, referencedBy: res, count: res.length }
  })

  /** 扫描所有变量的断裂引用（%XXX% 指向不存在的变量） */
  handle('analyze:brokenRefs', async () => {
    const { user, machine } = await registry.readAllEnv()
    const known = new Set([...user, ...machine].map((v) => v.name.toUpperCase()))
    const builtin = new Set(['SYSTEMROOT', 'SYSTEMDRIVE', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA',
      'LOCALAPPDATA', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'COMMONPROGRAMFILES',
      'COMMONPROGRAMFILES(X86)', 'PUBLIC', 'ALLUSERSPROFILE', 'TEMP', 'TMP', 'COMPUTERNAME',
      'USERNAME', 'USERDOMAIN', 'OS', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'PATHEXT',
      'COMSPEC', 'WINDIR', 'PSMODULEPATH', 'DRIVERDATA'])
    const broken = []
    const scanList = (list, scope) => {
      for (const v of list) {
        const refs = String(v.value).match(/%([^%|=\s]+)%/g) || []
        for (const r of refs) {
          const n = r.slice(1, -1).toUpperCase()
          if (known.has(n) || builtin.has(n)) continue
          broken.push({ scope, name: v.name, ref: n, value: v.value })
        }
      }
    }
    scanList(user, 'user')
    scanList(machine, 'machine')
    return { total: broken.length, items: broken }
  })

  /* ------------------------------ 循环引用检测 ------------------------------ */

  // 基于生效环境（同名时用户值优先于系统值）建引用图，找出 %VAR% 展开环
  handle('analyze:circularRefs', async () => {
    const { user, machine } = await registry.readAllEnv()
    const effective = new Map()
    for (const v of machine) effective.set(v.name.toUpperCase(), v)
    for (const v of user) effective.set(v.name.toUpperCase(), v)
    const cycles = detectCycles([...effective.values()])
    return {
      total: cycles.length,
      items: cycles.map((chain) => ({
        chain,
        self: chain.length === 1,
        note: chain.length === 1
          ? `${chain[0]} 的值引用了自身，展开时会得到未解析的原文`
          : `${chain.join(' → ')} → ${chain[0]} 形成闭环，相关变量都无法正确展开`
      }))
    }
  })

  /* ------------------------------ 同名遮蔽分析 ------------------------------ */

  // Windows 规则：用户与系统存在同名变量时，除 PATH（两者拼接生效）外，用户值会遮蔽系统值。
  handle('analyze:nameShadow', async () => {
    const { user, machine } = await registry.readAllEnv()
    const mMap = new Map(machine.map((v) => [v.name.toUpperCase(), v]))
    const items = []
    for (const u of user) {
      const key = String(u.name || '').toUpperCase()
      const m = mMap.get(key)
      if (!m) continue
      if (key === 'PATH') {
        items.push({
          name: u.name, kind: 'path', severity: 'info',
          userValue: u.value, machineValue: m.value,
          note: 'PATH 特殊：用户与系统值会拼接生效，不构成遮蔽'
        })
      } else if (String(u.value) === String(m.value)) {
        items.push({
          name: u.name, kind: 'duplicate', severity: 'low',
          userValue: u.value, machineValue: m.value,
          note: '用户与系统定义了相同值，属冗余，可删除其一'
        })
      } else {
        items.push({
          name: u.name, kind: 'shadow', severity: 'medium',
          userValue: u.value, machineValue: m.value,
          note: '用户值遮蔽系统值：新进程实际读到的是用户值'
        })
      }
    }
    const counts = { shadow: 0, duplicate: 0, path: 0 }
    for (const i of items) counts[i.kind]++
    return { total: items.length, counts, items }
  })

  /* ------------------------------ 外部变更检测 ------------------------------ */

  handle('analyze:externalCheck', async () => {
    const cfg = store.readConfig()
    if (cfg.detectExternal === false) return { enabled: false, changed: false }
    const fp = await ops.envFingerprint()
    const rec = meta.getExternal()
    const changed = !!rec.lastHash && rec.lastHash !== fp
    meta.setExternal(fp)
    return { enabled: true, changed, fingerprint: fp, lastAt: rec.lastAt }
  })

  /* ------------------------------ 注册表权限诊断 ------------------------------ */

  handle('analyze:registryAcl', async () => {
    const results = []
    const probe = async (label, keyPath, writable) => {
      try {
        if (writable) {
          await runPowerShell(
            `$k = Get-Item -LiteralPath '${keyPath}'; $v = '__wem_probe_' + (Get-Random); ` +
            `New-ItemProperty -LiteralPath $k.PSPath -Name $v -Value '1' -PropertyType String -ErrorAction Stop | Out-Null; ` +
            `Remove-ItemProperty -LiteralPath $k.PSPath -Name $v -ErrorAction SilentlyContinue; 'ok'`,
            { timeout: 20000 }
          )
          results.push({ target: label, writable: true, readable: true, message: '可读可写' })
        } else {
          await runPowerShell(`(Get-Item -LiteralPath '${keyPath}').GetValueNames() | Out-Null; 'ok'`, { timeout: 20000 })
          results.push({ target: label, writable: false, readable: true, message: '可读，无写权限' })
        }
      } catch (err) {
        results.push({ target: label, writable: false, readable: false, message: err.message })
      }
    }
    const admin = await registry.isAdmin()
    await probe('用户变量 HKCU\\Environment', 'HKCU:\\Environment', true)
    await probe('系统变量 HKLM Session Manager\\Environment',
      'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment', admin)
    return { admin, results }
  })

  /* ------------------------------ 终端环境对比 ------------------------------ */

  handle('analyze:terminalEnv', async (e, p) => {
    const shell = (p && p.shell) || 'cmd'
    const script = shell === 'powershell'
      ? `Get-ChildItem Env: | ForEach-Object { "$($_.Name)=$($_.Value)" }`
      : `set`
    const raw = await runPowerShell(script, { timeout: 30000 })
    const live = {}
    for (const line of String(raw).split(/\r?\n/)) {
      const idx = line.indexOf('=')
      if (idx <= 0) continue
      live[line.slice(0, idx).toUpperCase()] = line.slice(idx + 1)
    }

    const data = await registry.readAllEnv()
    const registryEnv = {}
    for (const v of data.machine) registryEnv[v.name.toUpperCase()] = v.value
    // 用户变量里可能包含 %VAR% 引用，用实时环境展开后再比较，避免误报
    const expandWith = (map, s) =>
      String(s || '').replace(/%([^%]+)%/g, (m, n) => {
        const key = n.toUpperCase()
        if (map[key] !== undefined) return map[key]
        return m
      })
    for (const v of data.user) {
      const key = v.name.toUpperCase()
      registryEnv[key] = String(v.value).includes('%') ? expandWith(live, v.value) : v.value
    }

    const onlyInTerminal = []
    const onlyInRegistry = []
    const different = []
    for (const k of Object.keys(live)) {
      if (k === 'PATH') continue
      if (!(k in registryEnv)) onlyInTerminal.push({ name: k, value: live[k] })
      else if (registryEnv[k] !== live[k]) different.push({ name: k, terminal: live[k], registry: registryEnv[k] })
    }
    for (const k of Object.keys(registryEnv)) {
      if (k === 'PATH') continue
      if (!(k in live)) onlyInRegistry.push({ name: k, value: registryEnv[k] })
    }
    return { shell, total: Object.keys(live).length, onlyInTerminal, onlyInRegistry, different }
  })

  /* ------------------------------ PATH 性能检测 ------------------------------ */

  handle('analyze:pathPerf', async () => {
    const data = await registry.readAllEnv()
    const cfg = store.readConfig()
    const items = []
    let ignoredTotal = 0
    let skippedTotal = 0
    for (const scope of ['user', 'machine']) {
      const hit = (scope === 'user' ? data.user : data.machine).find((v) => v.name.toUpperCase() === 'PATH')
      const dirs = String(hit ? hit.value : '').split(';').map((s) => s.trim()).filter(Boolean)
      const chk = await registry.classifyPaths(dirs, { config: cfg })
      const ignored = chk.filter((c) => c.type === 'ignored').length
      const skipped = chk.filter((c) => c.type === 'network-skipped' || c.type === 'removable-skipped').length
      ignoredTotal += ignored
      skippedTotal += skipped
      const invalid = chk.filter((c) => !c.exists && c.type !== 'network-skipped' && c.type !== 'removable-skipped').length
      items.push({
        scope,
        count: dirs.length,
        length: String(hit ? hit.value : '').length,
        invalid,
        ignored,
        skipped,
        dup: dirs.length - new Set(dirs.map((d) => d.toLowerCase())).length
      })
    }
    const total = items.reduce((a, b) => a + b.count, 0)
    const totalLen = items.reduce((a, b) => a + b.length, 0)
    const invalid = items.reduce((a, b) => a + b.invalid, 0)
    const advice = []
    if (total > 40) advice.push('PATH 条目超过 40 条，终端每次解析可执行文件会明显变慢，建议清理不常用目录。')
    if (totalLen > 1800) advice.push('PATH 总长度接近 2047 字符上限，有被截断风险，请精简。')
    if (invalid > 0) advice.push(`存在 ${invalid} 条无效目录，会拖慢每次命令查找，建议清理。`)
    if (ignoredTotal > 0) advice.push(`已按全局忽略列表跳过 ${ignoredTotal} 条目录，不计入无效统计。`)
    if (skippedTotal > 0) advice.push(`${skippedTotal} 条网络盘 / 可移动磁盘路径按设置未真实检测。`)
    if (total >= 20 && total <= 40 && invalid === 0) advice.push('PATH 规模正常，无需优化。')
    if (!advice.length) advice.push('当前 PATH 配置良好。')
    return { items, total, totalLen, invalid, ignored: ignoredTotal, skipped: skippedTotal, advice }
  })

  /* ------------------------------ 存储占用统计 ------------------------------ */

  handle('analyze:storage', async () => {
    const stat = (dir) => {
      let size = 0
      let files = 0
      const walk = (d) => {
        let entries = []
        try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch (_) { return }
        for (const e of entries) {
          const full = path.join(d, e.name)
          if (e.isDirectory()) walk(full)
          else {
            try { size += fs.statSync(full).size; files += 1 } catch (_) { /* ignore */ }
          }
        }
      }
      if (fs.existsSync(dir)) walk(dir)
      return { dir, size, files }
    }
    const cfg = store.readConfig()
    return {
      config: stat(path.dirname(store.configFile())),
      snapshots: stat(store.snapshotDir()),
      logs: stat(store.logDir()),
      cache: stat(store.resolvedCacheDir()),
      backups: stat(store.resolvedBackupDir())
    }
  })
}

module.exports = { register, detectSensitive, maskValue, SENSITIVE_RULES, extractRefs, detectCycles }
