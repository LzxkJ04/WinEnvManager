'use strict'
/**
 * 开发环境管理 IPC
 * 环境市场 / 已安装管理（自动扫描）/ 任务队列 / 环境审计 / 识别规则库
 */
const fs = require('node:fs')
const path = require('node:path')
const catalog = require('../lib/catalog')
const rules = require('../lib/rules')
const scanner = require('../lib/scanner')
const tasks = require('../lib/tasks')
const registry = require('../lib/registry')
const store = require('../lib/store')
const ops = require('../lib/ops')
const { runPowerShell } = require('../lib/ps')

let scanSignal = { cancelled: false }

function register(handle, ctx) {
  /* ------------------------------ 环境市场 ------------------------------ */

  handle('devenv:listCatalog', async () => ({ items: catalog.loadCatalog(), mirrors: catalog.listMirrors() }))
  handle('devenv:getItem', async (e, id) => catalog.getItem(id))
  handle('devenv:saveCatalog', async (e, items) => catalog.saveUserCatalog(items))
  handle('devenv:resolveUrl', async (e, p) => {
    const item = catalog.getItem(p.itemId)
    if (!item) throw new Error('软件清单项不存在')
    return {
      url: catalog.resolveUrl(item, p.version, p.source || 'mirror', p.customMirror),
      source: p.source || 'mirror'
    }
  })

  /* ------------------------------ 已安装管理 ------------------------------ */

  handle('devenv:scan', async (event, payload) => {
    const opts = payload || {}
    const cfg = store.readConfig()
    scanSignal = { cancelled: false }
    const perfT0 = cfg.perfTrace ? Date.now() : 0

    const timeoutMs = (Number(cfg.scanTimeoutSec) || 90) * 1000
    const timer = setTimeout(() => { scanSignal.cancelled = true }, timeoutMs)

    try {
      const result = await scanner.scan({
        deep: opts.deep !== undefined ? !!opts.deep : !!cfg.deepScan,
        customDirs: cfg.scanCustomDirs || [],
        excludeDirs: cfg.scanExcludeDirs || [],
        excludeNames: cfg.scanExcludeNames || [],
        versionTimeoutSec: opts.versionTimeoutSec,
        skipNetwork: opts.skipNetwork === true,
        skipUsb: opts.skipUsb === true,
        signal: scanSignal,
        onProgress: (info) => {
          ctx.getWindow()?.webContents.send('devenv:scan-progress', info)
        }
      })
      store.writeConfig({ lastScanAt: Date.now() })
      if (cfg.perfTrace) store.writeLog('info', '性能: 本机扫描耗时', `${Date.now() - perfT0} ms`)
      store.writeLog('info', `本机环境扫描完成，发现 ${result.items.length} 项`)
      return result
    } finally {
      clearTimeout(timer)
    }
  })

  handle('devenv:cancelScan', async () => {
    scanSignal.cancelled = true
    return true
  })

  handle('devenv:validateItem', async (e, item) => scanner.validateItem(item))

  /** 依据规则 + 安装目录生成环境变量计划（写入草稿用） */
  handle('devenv:buildPlan', async (e, p) => {
    const ruleObj = rules.getRule(p.ruleId)
    if (!ruleObj) throw new Error('识别规则不存在')
    const envData = await registry.readAllEnv()
    const currentEnv = {
      user: Object.fromEntries(envData.user.map((v) => [v.name, v.value])),
      machine: Object.fromEntries(envData.machine.map((v) => [v.name, v.value]))
    }
    const plan = scanner.buildVarPlan(ruleObj, p.installPath, currentEnv)
    const managed = plan.length > 0 && plan.every((x) => x.op === 'same')
    return { rule: { id: ruleObj.id, name: ruleObj.name }, plan, managed }
  })

  /* ------------------------------ 识别规则库 ------------------------------ */

  handle('rules:list', async () => ({ ruleVersion: rules.RULE_VERSION, rules: rules.listRules() }))
  handle('rules:get', async (e, id) => rules.getRule(id))
  handle('rules:save', async (e, ruleObj) => rules.upsertRule(ruleObj))
  handle('rules:delete', async (e, id) => rules.deleteRule(id))
  handle('rules:export', async () => rules.exportRules())
  handle('rules:import', async (e, text) => rules.importRules(text))

  /* ------------------------------ 任务队列 ------------------------------ */

  handle('task:list', async () => tasks.list())
  handle('task:get', async (e, id) => tasks.get(id))
  handle('task:cancel', async (e, id) => tasks.cancel(id))
  handle('task:pause', async (e, id) => tasks.pause(id))
  handle('task:resume', async (e, id) => tasks.resume(id))
  handle('task:retry', async (e, id) => tasks.retry(id))
  handle('task:clearFinished', async () => tasks.clearFinished())
  handle('task:pauseAll', async () => tasks.pauseAll())
  handle('task:resumeAll', async () => tasks.resumeAll())
  handle('task:setConcurrency', async (e, n) => tasks.setConcurrency(n))

  /** 一键部署：创建部署任务（下载 → 安装/解压 → 校验版本 → 返回变量计划） */
  handle('devenv:deploy', async (e, p) => {
    const cfgBefore = store.readConfig()
    if (cfgBefore.offlineMode) throw new Error('离线模式已开启，下载部署被禁止。可在「程序设置 → 更新与网络」关闭离线模式后再试。')
    const item = catalog.getItem(p.itemId)
    if (!item) throw new Error('软件清单项不存在')
    const version = p.version || (item.versions && item.versions[0])
    if (!version) throw new Error('未选择版本')
    const cfg = store.readConfig()
    const installDir = p.installDir || path.join(store.resolvedDevRoot(), item.id)

    const task = tasks.create({
      name: `部署 ${item.name} ${version}`,
      type: 'deploy',
      groupId: p.groupId || '',
      dependsOn: p.dependsOn || [],
      maxRetries: p.maxRetries === undefined ? 1 : Number(p.maxRetries),
      params: {
        itemId: item.id,
        version,
        installDir,
        mode: p.mode || item.installMode,
        source: p.source || cfg.downloadSource,
        scope: p.scope || 'user',
        customMirror: p.customMirror || '',
        verifyHash: cfg.verifyHash !== false,
        verifyVersion: p.verifyVersion === undefined ? cfg.deployVerifyVersion !== false : p.verifyVersion !== false,
        versionMode: p.versionMode || cfg.multiVersionMode || 'coexist',
        postInstallScript: item.postInstallScript || '',
        registerService: !!(item.registerService && cfg.dbRegisterService)
      }
    })
    store.writeLog('info', `创建部署任务：${item.name} ${version}`, { installDir })
    return task
  })

  /** 卸载已纳入管理的软件 */
  handle('devenv:uninstall', async (e, p) => {
    const task = tasks.create({
      name: `卸载 ${p.name || p.ruleId}`,
      type: 'uninstall',
      params: {
        installPath: p.installPath,
        uninstallCmd: p.uninstallCmd || '',
        mode: p.mode || 'portable',
        ruleId: p.ruleId
      }
    })
    return task
  })

  /** 批量版本校验 */
  handle('devenv:validateBatch', async (e, items) => {
    const list = Array.isArray(items) ? items : []
    const results = []
    for (const item of list) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const r = await scanner.validateItem(item)
        results.push({ ...r, name: item.name, ok: true })
      } catch (err) {
        results.push({ name: item.name, ok: false, message: err.message })
      }
    }
    return results
  })

  /* ------------------------------ 忽略清单 ------------------------------ */

  handle('devenv:listIgnore', async () => store.readConfig().scanIgnoreList || [])
  handle('devenv:addIgnore', async (e, key) => {
    const cfg = store.readConfig()
    const list = new Set(cfg.scanIgnoreList || [])
    list.add(String(key))
    store.writeConfig({ scanIgnoreList: [...list] })
    return true
  })
  handle('devenv:removeIgnore', async (e, key) => {
    const cfg = store.readConfig()
    store.writeConfig({ scanIgnoreList: (cfg.scanIgnoreList || []).filter((x) => x !== key) })
    return true
  })

  /* ------------------------------ 环境审计 ------------------------------ */

  handle('devenv:audit', async (event, payload) => {
    const cfg = store.readConfig()
    scanSignal = { cancelled: false }
    const scanResult = await scanner.scan({
      deep: payload && payload.deep,
      customDirs: cfg.scanCustomDirs || [],
      excludeDirs: cfg.scanExcludeDirs || [],
      excludeNames: cfg.scanExcludeNames || [],
      versionTimeoutSec: payload && payload.versionTimeoutSec,
      skipNetwork: payload && payload.skipNetwork === true,
      skipUsb: payload && payload.skipUsb === true,
      signal: scanSignal,
      onProgress: (info) => ctx.getWindow()?.webContents.send('devenv:scan-progress', info)
    })

    const envData = await registry.readAllEnv()
    const currentEnv = {
      user: Object.fromEntries(envData.user.map((v) => [v.name, v.value])),
      machine: Object.fromEntries(envData.machine.map((v) => [v.name, v.value]))
    }

    const issues = []
    const okItems = []

    // 1. PATH 无效 / 重复
    const pathCheck = await registry.checkPathsExist([
      ...String(currentEnv.user.Path || '').split(';'),
      ...String(currentEnv.machine.Path || '').split(';')
    ].map((s) => s.trim()).filter(Boolean))
    const invalidPaths = pathCheck.filter((p) => !p.exists).map((p) => p.path)
    const seenPath = new Map()
    const dupPaths = []
    for (const p of pathCheck.map((x) => x.path)) {
      const k = p.trim().replace(/[\\/]+$/, '').toLowerCase()
      if (seenPath.has(k)) dupPaths.push(p)
      else seenPath.set(k, p)
    }

    // 2. 每个已发现软件的一致性
    for (const item of scanResult.items) {
      if (item.ignored) continue
      const plan = item.variables || []
      const missingHome = plan.filter((v) => v.name.toUpperCase() !== 'PATH' && v.op !== 'same')
      const missingPath = plan.find((v) => v.name.toUpperCase() === 'PATH' && v.op !== 'same')
      if (missingHome.length) {
        issues.push({
          level: 'error',
          risk: 'high',
          title: `${item.name} 缺少 HOME 类环境变量`,
          detail: missingHome.map((m) => `${m.name}（建议值 ${m.value}）`).join('、'),
          installPath: item.installPath,
          ruleId: item.ruleId,
          fix: missingHome.filter((m) => m.op !== 'same')
        })
      } else {
        okItems.push(`${item.name} 变量完整`)
      }
      if (missingPath) {
        issues.push({
          level: 'error',
          risk: 'medium',
          title: `${item.name} 的 PATH 缺少对应 bin 目录`,
          detail: missingPath.remark || missingPath.pathEntry || '',
          installPath: item.installPath,
          ruleId: item.ruleId,
          fix: [missingPath]
        })
      }
    }

    // 3. 多版本冲突
    const byRule = new Map()
    for (const item of scanResult.items) {
      if (item.ignored) continue
      const list = byRule.get(item.ruleId) || []
      list.push(item)
      byRule.set(item.ruleId, list)
    }
    const conflicts = []
    for (const [ruleId, list] of byRule.entries()) {
      if (list.length > 1) {
        const r = rules.getRule(ruleId)
        conflicts.push({ ruleId, name: (r && r.name) || ruleId, items: list })
      }
    }

    // 4. 变量指向目录失效
    for (const scope of ['user', 'machine']) {
      for (const [name, value] of Object.entries(currentEnv[scope])) {
        if (!/(_HOME|_ROOT)$/i.test(name)) continue
        const expanded = scanner.expandWin(String(value))
        // eslint-disable-next-line no-await-in-loop
        const chk = await registry.checkPathsExist([expanded])
        if (chk[0] && !chk[0].exists) {
          issues.push({
            level: 'warn',
            risk: 'medium',
            title: `变量 ${name} 指向的目录不存在`,
            detail: `${scope === 'machine' ? '系统' : '用户'}变量 ${name} = ${value}`,
            scope,
            name,
            fix: [{ scope, name, value: '', op: 'delete' }]
          })
        }
      }
    }

    const report = {
      scannedAt: Date.now(),
      total: scanResult.items.length,
      managed: scanResult.items.filter((i) => i.managed).length,
      discovered: scanResult.items.filter((i) => !i.managed && !i.ignored).length,
      ignored: scanResult.items.filter((i) => i.ignored).length,
      invalidPaths,
      dupPaths,
      conflicts,
      issues,
      okItems,
      items: scanResult.items,
      summary: {
        errors: issues.filter((i) => i.level === 'error').length,
        warns: issues.filter((i) => i.level === 'warn').length,
        high: issues.filter((i) => i.risk === 'high').length,
        medium: issues.filter((i) => i.risk === 'medium').length,
        low: issues.filter((i) => i.risk === 'low').length
      }
    }
    store.writeLog('warn', '环境审计完成', report.summary)
    return report
  })

  /** 导出审计报告 */
  handle('devenv:exportReport', async (e, p) => {
    const { format, report } = p || {}
    const saved = await ctx.dialog.showSaveDialog(ctx.getWindow(), {
      title: '导出审计报告',
      defaultPath: `环境审计报告-${ops.tsText().replace(/[: ]/g, '-')}.${format === 'md' ? 'md' : format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format === 'md' ? 'md' : format] }]
    })
    if (saved.canceled || !saved.filePath) return { canceled: true }
    const content = renderReport(report, format)
    fs.writeFileSync(saved.filePath, content, 'utf8')
    store.writeLog('info', '导出审计报告', saved.filePath)
    return { file: saved.filePath, size: fs.statSync(saved.filePath).size }
  })

  /** 打开默认安装根目录 / 缓存目录 */
  handle('devenv:openDir', async (e, kind) => {
    const dir = kind === 'cache' ? store.resolvedCacheDir() : store.resolvedDevRoot()
    await ctx.shell.openPath(dir)
    return dir
  })

  handle('devenv:cacheStats', async () => {
    const dir = store.resolvedCacheDir()
    let size = 0
    let count = 0
    const walk = (d) => {
      let entries = []
      try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch (_) { return }
      for (const e of entries) {
        const full = path.join(d, e.name)
        if (e.isDirectory()) walk(full)
        else {
          try { size += fs.statSync(full).size; count += 1 } catch (_) { /* ignore */ }
        }
      }
    }
    walk(dir)
    return { dir, size, count }
  })

  handle('devenv:clearCache', async () => {
    const dir = store.resolvedCacheDir()
    let n = 0
    const walk = (d) => {
      let entries = []
      try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch (_) { return }
      for (const e of entries) {
        const full = path.join(d, e.name)
        if (e.isDirectory()) walk(full)
        try { fs.rmSync(full, { recursive: true, force: true }); n += 1 } catch (_) { /* ignore */ }
      }
    }
    walk(dir)
    store.writeLog('warn', `清空安装包缓存，删除 ${n} 项`)
    return n
  })
}

/* --------------------------- 部署 / 卸载任务处理器 --------------------------- */

function registerTaskHandlers(taskManager) {
  taskManager.registerHandler('deploy', async (params, tctx) => {
    const item = catalog.getItem(params.itemId)
    if (!item) throw new Error('软件清单项不存在')
    const version = params.version
    const installDir = params.installDir
    const url = catalog.resolveUrl(item, version, params.source, params.customMirror)
    const ext = path.extname(new URL(url).pathname).toLowerCase() || '.zip'
    const cacheDir = store.resolvedCacheDir()
    const cacheFile = path.join(cacheDir, `${item.id}-${version}${ext}`)
    const before = store.pruneInstallerCache(fs.existsSync(cacheFile) ? cacheFile : '')
    if (before.removed) tctx.log(`安装包缓存超过上限，已删除 ${before.removed} 个旧文件`)

    tctx.progress({ percent: 2, phase: '下载' })
    tctx.log(`下载源：${params.source === 'official' ? '官方源' : '镜像源'} ${url}`)

    const expectedHash = checksumOf(item, version)
    const verifyHash = params.verifyHash !== false
    if (fs.existsSync(cacheFile) && fs.statSync(cacheFile).size > 0) {
      tctx.log(`命中本地缓存：${cacheFile}`)
      await assertDownloadHash(cacheFile, expectedHash, verifyHash, tctx)
    } else {
      const res = await require('../lib/download').downloadFile({
        url,
        dest: cacheFile,
        sha256: verifyHash ? (expectedHash || undefined) : undefined,
        signal: tctx.signal,
        onProgress: (p) => {
          const percent = p.total ? (p.received / p.total) * 95 : 0
          tctx.progress({ percent, received: p.received, total: p.total, speed: p.speed, phase: '下载' })
        }
      })
      tctx.log(`下载完成：${(res.size / 1024 / 1024).toFixed(2)} MB`)
      if (!verifyHash) tctx.log('已按设置跳过下载哈希校验')
      else if (expectedHash) tctx.log(`哈希校验通过：${res.sha256}`)
      else tctx.log(`清单没有该版本的官方 sha256，实际哈希 ${res.sha256}。不能据此判断文件是否被篡改`)
    }
    const after = store.pruneInstallerCache(cacheFile)
    if (after.removed) tctx.log(`安装包缓存超过上限，已删除 ${after.removed} 个旧文件`)
    if (after.over) tctx.log('当前安装包本身已超过缓存上限，本次文件保留，其余旧文件已尽量清理', 'warn')

    // 安装 / 解压
    tctx.progress({ percent: 96, phase: '安装' })
    if (params.versionMode === 'overwrite' && fs.existsSync(installDir)) {
      tctx.log(`覆盖安装：先清空 ${installDir}`)
      fs.rmSync(installDir, { recursive: true, force: true })
    }
    fs.mkdirSync(installDir, { recursive: true })

    if (ext === '.zip' || params.mode === 'portable') {
      if (ext === '.zip') {
        tctx.log('解压压缩包…')
        await runPowerShell(
          `Expand-Archive -LiteralPath '${cacheFile.replace(/'/g, "''")}' -DestinationPath '${installDir.replace(/'/g, "''")}' -Force`,
          { timeout: 300000 }
        )
        flattenSingleDir(installDir)
      } else {
        throw new Error(`暂不支持该压缩格式 ${ext}，请使用 exe 安装包或手动解压`)
      }
    } else {
      // exe 静默安装
      const args = (params.silentArgs || item.silentArgs || '/S').replace(/\{dir\}/g, installDir)
      tctx.log(`静默安装：${path.basename(cacheFile)} ${args}`)
      const verb = /system/i.test(params.scope) ? ' -Verb RunAs' : ''
      await runPowerShell(
        `$p = Start-Process -FilePath '${cacheFile.replace(/'/g, "''")}' -ArgumentList '${args.replace(/'/g, "''")}' -Wait -PassThru${verb}; $p.ExitCode`,
        { timeout: 900000 }
      )
    }

    // 注册 Windows 服务（可选）
    if (params.registerService && params.postInstallScript) {
      const cmd = params.postInstallScript.replace(/\{dir\}/g, installDir)
      tctx.log(`注册服务：${cmd}`)
      try {
        await runPowerShell(
          `Start-Process -FilePath 'cmd.exe' -ArgumentList '/c cd /d "${installDir}" && ${cmd}' -Verb RunAs -Wait`,
          { timeout: 120000 }
        )
      } catch (err) {
        tctx.log(`注册服务失败（不影响部署）：${err.message}`, 'warn')
      }
    }

    // 版本校验
    let verify = null
    if (params.verifyVersion === false) {
      tctx.log('已按设置跳过部署后版本校验')
    } else if (item.ruleId) {
      const ruleObj = require('../lib/rules').getRule(item.ruleId)
      const exePath = findExeIn(installDir, ruleObj ? ruleObj.executableName : '')
      if (ruleObj && exePath) {
        try {
          const v = await scanner.detectVersion(ruleObj, exePath, installDir)
          const matched = versionMatches(version, v)
          verify = {
            ok: matched,
            version: v,
            expected: version,
            exePath,
            cmd: ruleObj.versionCmd ? `${exePath} ${ruleObj.versionCmd}` : exePath
          }
          if (!v) tctx.log('版本校验未取得输出（可能需要重新打开终端）', 'warn')
          else if (!matched) throw new Error(`版本校验未通过：期望 ${version}，实际 ${v}`)
          else tctx.log(`版本校验通过：${v}`)
        } catch (err) {
          verify = { ok: false, message: err.message, expected: version }
          if (/版本校验未通过/.test(err.message)) {
            tctx.log(err.message, 'error')
            throw err
          }
          tctx.log(`版本校验失败：${err.message}`, 'warn')
        }
      }
    }

    // 生成变量计划（不写注册表，交给草稿）
    let variables = []
    if (item.ruleId) {
      const ruleObj = require('../lib/rules').getRule(item.ruleId)
      if (ruleObj) {
        const envData = await registry.readAllEnv()
        const currentEnv = {
          user: Object.fromEntries(envData.user.map((v) => [v.name, v.value])),
          machine: Object.fromEntries(envData.machine.map((v) => [v.name, v.value]))
        }
        variables = scanner.buildVarPlan(ruleObj, installDir, currentEnv).filter((v) => v.op !== 'same')
      }
    }

    tctx.progress({ percent: 100, phase: '完成' })
    return { installDir, cacheFile, variables, verify }
  })

  taskManager.registerHandler('uninstall', async (params, tctx) => {
    const { installPath, uninstallCmd, mode } = params
    tctx.progress({ percent: 10, phase: '卸载' })
    if (mode === 'installer' && uninstallCmd) {
      tctx.log(`调用自带卸载程序：${uninstallCmd}`)
      await runPowerShell(
        `Start-Process -FilePath 'cmd.exe' -ArgumentList '/c ${uninstallCmd.replace(/"/g, '\\"')}' -Wait`,
        { timeout: 600000 }
      )
    } else {
      tctx.log(`删除目录：${installPath}`)
      if (fs.existsSync(installPath)) fs.rmSync(installPath, { recursive: true, force: true })
    }
    tctx.progress({ percent: 100, phase: '完成' })
    return { installPath, removed: true }
  })

  taskManager.registerHandler('validate', async (params, tctx) => {
    tctx.progress({ percent: 50 })
    const r = await scanner.validateItem(params)
    tctx.progress({ percent: 100 })
    return r
  })
}

function checksumOf(item, version) {
  const map = item && item.checksums
  if (!map || typeof map !== 'object') return ''
  const hit = map[version]
  if (!hit) return ''
  if (typeof hit === 'string') return hit.trim()
  return String(hit.sha256 || hit.sha || '').trim()
}

async function assertDownloadHash(file, expectedHash, verifyHash, tctx) {
  if (!verifyHash) {
    tctx.log('已按设置跳过下载哈希校验')
    return
  }
  const { hashFile } = require('../lib/download')
  const actual = await hashFile(file, 'sha256')
  const expected = String(expectedHash || '').trim()
  if (!expected) {
    tctx.log(`清单没有该版本的官方 sha256，实际哈希 ${actual}。不能据此判断文件是否被篡改`)
    return
  }
  if (expected.toLowerCase() !== String(actual).toLowerCase()) {
    try { fs.rmSync(file, { force: true }) } catch (_) { /* 缓存删不掉时仍要让任务失败 */ }
    throw new Error(`哈希校验失败：期望 ${expected}，实际 ${actual}。已删除缓存，避免安装被篡改的文件`)
  }
  tctx.log(`哈希校验通过：${actual}`)
}

function versionMatches(expected, actual) {
  const left = String(expected || '').trim()
  const right = String(actual || '').trim()
  if (!left || !right) return false
  const norm = (s) => s.toLowerCase().replace(/^v/, '').replace(/\s+/g, '')
  const a = norm(left)
  const b = norm(right)
  if (a === b || a.includes(b) || b.includes(a)) return true
  const core = (s) => {
    const m = s.match(/\d+(?:\.\d+){1,3}/)
    return m ? m[0] : ''
  }
  const ca = core(a)
  const cb = core(b)
  return !!(ca && cb && (ca === cb || ca.startsWith(`${cb}.`) || cb.startsWith(`${ca}.`)))
}

function flattenSingleDir(dir) {
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch (_) { return }
  if (entries.length === 1 && entries[0].isDirectory()) {
    const inner = path.join(dir, entries[0].name)
    const target = path.join(path.dirname(dir), `.wem-tmp-${Date.now()}`)
    try {
      fs.renameSync(inner, target)
      fs.rmSync(dir, { recursive: true, force: true })
      fs.renameSync(target, dir)
    } catch (_) { /* ignore */ }
  }
}

function findExeIn(dir, exeName) {
  if (!exeName) return ''
  const candidates = [
    path.join(dir, exeName),
    path.join(dir, 'bin', exeName),
    path.join(dir, 'cmd', exeName)
  ]
  if (candidates.some((c) => fs.existsSync(c))) return candidates.find((c) => fs.existsSync(c))
  // 一层子目录粗查
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const c = path.join(dir, e.name, exeName)
      if (fs.existsSync(c)) return c
    }
  } catch (_) { /* ignore */ }
  return ''
}

/* ------------------------------ 报告渲染 ------------------------------ */

function renderReport(report, format) {
  if (format === 'csv') {
    const rows = [['风险', '级别', '标题', '详情', '安装路径']]
    for (const i of report.issues || []) rows.push([i.risk || '', i.level || '', i.title || '', i.detail || '', i.installPath || ''])
    return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n')
  }
  if (format === 'html') {
    const rows = (report.issues || [])
      .map(
        (i) =>
          `<tr class="${i.level}"><td>${i.risk || ''}</td><td>${i.level || ''}</td><td>${i.title || ''}</td><td>${i.detail || ''}</td></tr>`
      )
      .join('')
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>环境审计报告</title>
<style>body{font-family:"Segoe UI","Microsoft YaHei",sans-serif;margin:24px;color:#1d2129}
h1{font-size:20px}table{border-collapse:collapse;width:100%;font-size:13px}
th,td{border:1px solid #e5e6eb;padding:8px;text-align:left}
th{background:#f5f6f8}tr.error td{background:rgba(245,63,63,.08)}
tr.warn td{background:rgba(255,125,0,.08)}meta{color:#86909c}</style></head><body>
<h1>WinEnv管家 · 环境审计报告</h1>
<p class="meta">生成时间 ${new Date().toLocaleString('zh-CN')} · 扫描 ${report.total} 项 · 已纳管 ${report.managed} · 待接管 ${report.discovered}</p>
<table><thead><tr><th>风险</th><th>级别</th><th>问题</th><th>详情</th></tr></thead><tbody>${rows}</tbody></table>
</body></html>`
  }
  const lines = []
  lines.push('# WinEnv管家 · 环境审计报告')
  lines.push('')
  lines.push(`- 生成时间：${new Date().toLocaleString('zh-CN')}`)
  lines.push(`- 扫描软件：${report.total} 项（已纳管 ${report.managed}，待接管 ${report.discovered}）`)
  lines.push(`- 问题：❌ ${report.summary.errors} 个异常，⚠️ ${report.summary.warns} 个警告`)
  lines.push('')
  lines.push('## 问题清单')
  lines.push('')
  for (const i of report.issues || []) {
    lines.push(`- **[${i.risk || ''}] ${i.title}** — ${i.detail || ''}`)
  }
  if (!report.issues || !report.issues.length) lines.push('- 未发现问题 ✅')
  lines.push('')
  lines.push('## PATH 无效条目')
  for (const p of report.invalidPaths || []) lines.push(`- ${p}`)
  if (!(report.invalidPaths || []).length) lines.push('- 无')
  lines.push('')
  lines.push('## PATH 重复条目')
  for (const p of report.dupPaths || []) lines.push(`- ${p}`)
  if (!(report.dupPaths || []).length) lines.push('- 无')
  lines.push('')
  lines.push('## 多版本共存')
  for (const c of report.conflicts || []) {
    lines.push(`- ${c.name}：${c.items.map((i) => `${i.version || '未知版本'} @ ${i.installPath}`).join('；')}`)
  }
  if (!(report.conflicts || []).length) lines.push('- 无')
  return lines.join('\r\n')
}

module.exports = { register, registerTaskHandlers, renderReport, assertDownloadHash, versionMatches }
