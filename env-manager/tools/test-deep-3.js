/**
 * 第三轮深度核查：
 *  A. 恢复完整性（能删除备份中不存在的多余键值、能重建被删的子项）
 *  B. 变更监控能捕获外部修改并标记来源
 *  C. 健康诊断修复真实生效
 *  D. 配置包密码 / 合并模式 / 版本告警
 *  E. 监控日志裁剪
 *
 * 全部操作都在专用测试键下，结束时自清理。
 */
const { app, dialog, shell } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

app.disableHardwareAcceleration()

const SEP = String.fromCharCode(92)
const BASE = `HKCU${SEP}Environment_WEM_DEEP3`
const SUB = `${BASE}${SEP}Sub`

let pass = 0
let fail = 0
const failures = []

function check(name, cond, extra) {
  if (cond) {
    pass++
    console.log('PASS ', name)
  } else {
    fail++
    failures.push(name)
    console.log('FAIL ', name, extra == null ? '' : extra)
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function ps(script) {
  const out = execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')
  ], { encoding: 'utf8', timeout: 60000 })
  return out
}

function cleanRegistry() {
  try {
    ps(`
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      $p = 'HKCU:\\Environment_WEM_DEEP3'
      if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force }
      'ok'
    `)
  } catch { /* ignore */ }
}

app.whenReady().then(async () => {
  const store = require('../electron/lib/store')
  store.ensureAll()

  const handlers = new Map()
  const ctx = { dialog, shell, getWindow: () => null }

  require('../electron/ipc/registry.js').register((c, f) => handlers.set(c, f), ctx)
  require('../electron/ipc/reg-backup.js').register((c, f) => handlers.set(c, f), ctx)
  require('../electron/ipc/reg-extra.js').register((c, f) => handlers.set(c, f), ctx)

  const call = (ch, arg) => {
    const fn = handlers.get(ch)
    if (!fn) throw new Error(`通道未实现: ${ch}`)
    return fn({}, arg)
  }

  const createdBackups = []
  const createdSchedules = []
  const tmpDir = path.join(os.tmpdir(), `wem-deep3-${Date.now()}`)
  fs.mkdirSync(tmpDir, { recursive: true })

  try {
    /* ============ A. 恢复完整性 ============ */
    cleanRegistry()
    await call('reg:createKey', { parentPath: BASE, keyName: 'Sub' })
    await call('reg:setValue', { path: BASE, name: 'Keep', type: 'REG_SZ', value: 'v1' })
    await call('reg:setValue', { path: BASE, name: 'WillChange', type: 'REG_SZ', value: 'old' })
    await call('reg:setValue', { path: SUB, name: 'Nested', type: 'REG_EXPAND_SZ', value: '%TEMP%' })

    const bak = await call('regBackup:create', {
      path: BASE, name: 'Deep3-Base', note: '深度核查基线', tags: ['test'], format: 'json'
    })
    createdBackups.push(bak.id)
    check('A1 基线备份创建成功', !!bak.id, JSON.stringify(bak))

    // 制造三类差异：改值、新增多余键值、删除子项
    await call('reg:setValue', { path: BASE, name: 'WillChange', type: 'REG_SZ', value: 'changed' })
    await call('reg:setValue', { path: BASE, name: 'ExtraNow', type: 'REG_SZ', value: 'should-be-removed' })
    await call('reg:deleteKey', { path: SUB, recursive: true })

    const dry = await call('regBackup:restore', { id: bak.id, dryRun: true })
    const acts = new Set(dry.changes.map((c) => c.action))
    check('A2 dryRun 能识别 update', acts.has('update'), JSON.stringify(dry.summary))
    check('A3 dryRun 能识别 delete（多余键值）', acts.has('delete'), JSON.stringify(dry.summary))
    check('A4 dryRun 能识别 create（被删的子项）', acts.has('create'), JSON.stringify(dry.summary))

    const res = await call('regBackup:restore', { id: bak.id })
    check('A5 恢复执行成功', res.applied > 0, JSON.stringify(res))

    const after = await call('reg:values', BASE)
    const map = new Map(after.values.map((v) => [v.name, v.value]))
    check('A6 被修改的值已还原', map.get('WillChange') === 'old', String(map.get('WillChange')))
    check('A7 多余的键值已被删除', !map.has('ExtraNow'), String(map.get('ExtraNow')))
    check('A8 保留值未被破坏', map.get('Keep') === 'v1', String(map.get('Keep')))

    const subAfter = await call('reg:values', SUB)
    const nested = (subAfter.values || []).find((v) => v.name === 'Nested')
    check('A9 被删的子项已重建', !!nested, JSON.stringify(subAfter.values))
    check('A10 子项 EXPAND_SZ 原文保留', nested && nested.value === '%TEMP%', nested && nested.value)

    // 恢复自身产生的保底备份应可列出
    const listAfter = await call('regBackup:list')
    const safety = listAfter.filter((b) => /^RestoreBackup-/.test(b.name))
    check('A11 恢复前保底备份已生成', safety.length > 0, String(safety.length))
    safety.forEach((b) => createdBackups.push(b.id))

    /* ============ B. 变更监控 ============ */
    await call('regWatch:add', { path: BASE, interval: 800, watchValues: true })
    const wlist = await call('regWatch:list')
    check('B1 监听已加入', (wlist.watchers || []).some((w) => w.path === BASE), JSON.stringify(wlist))

    await call('regWatch:clearLogs')
    await sleep(900)
    // 外部进程直接改注册表，绕开本软件
    ps(`
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      Set-ItemProperty -Path 'HKCU:\\Environment_WEM_DEEP3' -Name 'Keep' -Value 'external-edit'
      'ok'
    `)
    await sleep(2600)
    const logs = await call('regWatch:logs', { limit: 50 })
    const hit = (logs.rows || []).filter((r) => r.name === 'Keep' && String(r.newValue) === 'external-edit')
    check('B2 捕获到外部键值修改', hit.length > 0, JSON.stringify((logs.rows || []).slice(0, 3)))
    check('B3 来源标记为外部', hit.length > 0 && hit[0].origin === '外部', hit[0] && hit[0].origin)

    // 本软件写入应标记为自身
    await call('regWatch:clearLogs')
    await sleep(900)
    await call('reg:setValue', { path: BASE, name: 'Keep', type: 'REG_SZ', value: 'self-edit' })
    await sleep(2600)
    const logs2 = await call('regWatch:logs', { limit: 50 })
    const self = (logs2.rows || []).filter((r) => r.name === 'Keep' && String(r.newValue) === 'self-edit')
    check('B4 本软件写入被标记为自身', self.length > 0 && self[0].origin === 'WinEnv管家', self[0] && self[0].origin)

    await call('regWatch:stop', { path: BASE })
    const stopped = await call('regWatch:list')
    const w = (stopped.watchers || []).find((x) => x.path === BASE)
    check('B5 监听可暂停', !w || w.running === false, JSON.stringify(w))
    await call('regWatch:remove', { path: BASE })
    const removed = await call('regWatch:list')
    check('B6 监听已移除', !(removed.watchers || []).some((x) => x.path === BASE))

    /* ============ C. 健康诊断修复 ============ */
    // C1/C2 用「引用不存在变量」：这是文档明确要求的通用检测项，且不需要改真实 PATH
    const envKey = 'WEM_TEST_DEEP3_BADREF'
    const userEnvPath = 'HKCU' + SEP + 'Environment'
    try {
      await call('reg:setValue', {
        path: userEnvPath, name: envKey, type: 'REG_EXPAND_SZ',
        value: '%WEM_NO_SUCH_VAR_XYZ%\\bin'
      })

      const scan = await call('health:scan')
      const mine = (scan.items || []).filter(
        (i) => i.type === 'invalid-reference' && String(i.name || '').toUpperCase() === envKey
      )
      check('C1 诊断能定位到无效变量引用', mine.length > 0,
        JSON.stringify((scan.items || []).filter((i) => i.type === 'invalid-reference').slice(0, 3)))
      check('C2 引用类问题被正确标记为不可自动修复', mine.length > 0 && mine[0].fixable === false,
        JSON.stringify(mine[0] || {}))
    } finally {
      try { await call('reg:deleteValue', { path: userEnvPath, name: envKey }) } catch { /* ignore */ }
    }

    // C3~C5 用真实 PATH 的修复链路：备份原值 → 注入重复条目 → 修复 → 断言 → 还原
    let origPath = ''
    let origKind = ''
    try {
      const pv0 = await call('reg:values', userEnvPath)
      const p = (pv0.values || []).find((v) => String(v.name).toUpperCase() === 'PATH')
      origPath = p ? String(p.value) : ''
      origKind = p ? String(p.type) : ''
    } catch { /* ignore */ }

    try {
      await call('reg:setValue', {
        path: userEnvPath, name: 'Path', type: 'REG_EXPAND_SZ',
        value: `${origPath};C:\\Windows;;C:\\Windows;`
      })

      const scan2 = await call('health:scan')
      const fixes = (scan2.items || []).filter((i) => i.type === 'path-duplicate' || i.type === 'path-format')
      check('C3 诊断能发现 PATH 重复与格式问题', fixes.length > 0,
        JSON.stringify((scan2.items || []).map((i) => i.type)))

      if (fixes.length) {
        const ids = fixes.filter((i) => i.fixable).map((i) => i.id)
        const pv = await call('health:previewFix', { ids })
        check('C4 预览给出了修复动作', (pv.actions || []).length > 0, JSON.stringify(pv).slice(0, 300))

        const fx = await call('health:applyFix', { ids })
        if (fx.backupId) createdBackups.push(fx.backupId)
        check('C5 修复执行成功并生成了备份', (fx.applied > 0) && !!fx.backupId, JSON.stringify(fx))

        const v2 = await call('reg:values', userEnvPath)
        const got = (v2.values || []).find((v) => String(v.name).toUpperCase() === 'PATH')
        const val = got ? String(got.value) : ''
        check('C6 修复后不再有重复与空段', !/;;/.test(val) && !/;\s*$/.test(val), val)
        check('C7 修复后路径条数减少', val.split(';').filter((s) => s.trim()).length <= origPath.split(';').filter((s) => s.trim()).length + 1,
          `orig=${origPath.split(';').filter((s) => s.trim()).length} now=${val.split(';').filter((s) => s.trim()).length}`)
      }
    } finally {
      // 无论成败都还原真实 PATH，且保持 ExpandString 类型
      try {
        await call('reg:setValue', {
          path: userEnvPath, name: 'Path',
          type: origKind === 'REG_SZ' ? 'REG_SZ' : 'REG_EXPAND_SZ',
          value: origPath
        })
      } catch { /* ignore */ }
    }

    const restored = await call('reg:values', userEnvPath)
    const backPath = (restored.values || []).find((v) => String(v.name).toUpperCase() === 'PATH')
    check('C8 真实 PATH 已按原样还原',
      !!backPath && String(backPath.value) === origPath && String(backPath.type) === (origKind || String(backPath.type)),
      `orig=${origPath} now=${backPath && backPath.value}`)

    /* ============ D. 配置包密码 / 合并 / 版本 ============ */
    const plainFile = path.join(tmpDir, 'plain.wemcfg')
    const encFile = path.join(tmpDir, 'enc.wemcfg')

    const ex1 = await call('configPack:exportPack', {
      modules: ['config'], note: 'deep3 明文', tags: ['test'], file: plainFile
    })
    check('D1 明文配置包导出成功', !!ex1.file && fs.existsSync(ex1.file), JSON.stringify(ex1))

    const ex2 = await call('configPack:exportPack', {
      modules: ['config'], note: 'deep3 加密', tags: ['test'], file: encFile, password: 'Pa55w0rd!'
    })
    check('D2 加密配置包导出成功', !!ex2.file && fs.existsSync(ex2.file), JSON.stringify(ex2))

    let noPwdRejected = false
    try { await call('configPack:inspectPack', { file: encFile }) } catch (e) {
      noPwdRejected = /密码/.test(e.message)
    }
    check('D3 加密包无密码被拒绝', noPwdRejected)

    let wrongPwdRejected = false
    try { await call('configPack:inspectPack', { file: encFile, password: 'wrong' }) } catch (e) {
      wrongPwdRejected = /密码|解密|校验/.test(e.message)
    }
    check('D4 错误密码被拒绝', wrongPwdRejected)

    const okInspect = await call('configPack:inspectPack', { file: encFile, password: 'Pa55w0rd!' })
    check('D5 正确密码可读取', !!(okInspect.manifest), JSON.stringify(okInspect).slice(0, 300))
    check('D6 清单含模块信息', Array.isArray(okInspect.manifest && okInspect.manifest.modules) && okInspect.manifest.modules.length > 0)

    // 明文包的 SHA256 校验
    const rawText = fs.readFileSync(ex1.file, 'utf8')
    const magic = rawText.slice(0, 7)
    check('D7 配置包带文件头魔数', magic === 'WEMCFG1', JSON.stringify(magic))

    const tamper = path.join(tmpDir, 'tamper.wemcfg')
    fs.writeFileSync(tamper, rawText.replace(/"note"\s*:\s*"[^"]*"/, '"note":"hacked"'), 'utf8')
    let tamperRejected = false
    try { await call('configPack:inspectPack', { file: tamper }) } catch (e) {
      tamperRejected = /校验|篡改|损坏/.test(e.message)
    }
    check('D8 篡改包被哈希校验拦截', tamperRejected)

    // 合并模式：本地有本地独有收藏时不应被清空
    const beforeFav = await call('regFav:list')
    const beforeCount = (beforeFav.items || []).length
    const imp = await call('configPack:importPack', {
      file: plainFile, modules: ['config'], mode: 'merge'
    })
    check('D9 合并导入成功', !!imp && imp.restartRequired === true, JSON.stringify(imp).slice(0, 300))
    const afterFav = await call('regFav:list')
    check('D10 合并导入未破坏本地收藏', (afterFav.items || []).length >= beforeCount,
      `before=${beforeCount} after=${(afterFav.items || []).length}`)

    // 导入前自动备份
    const packDir = path.join(store.appDataDir(), 'configPack')
    const pre = fs.existsSync(packDir) ? fs.readdirSync(packDir).filter((f) => /^PreImport-/.test(f)) : []
    check('D11 导入前已自动备份当前配置', pre.length > 0, String(pre.length))

    /* ============ E. 日志裁剪与失效任务 ============ */
    const keep = 5
    const cfg = store.readConfig()
    const oldKeep = cfg.scheduleLogKeep
    store.writeConfig({ scheduleLogKeep: keep })
    try {
      await call('regWatch:add', { path: BASE, interval: 700, watchValues: true })
      for (let i = 0; i < 8; i++) {
        await call('reg:setValue', { path: BASE, name: 'Keep', type: 'REG_SZ', value: `trim-${i}` })
        await sleep(1100)
      }
      await sleep(1600)
      const afterTrim = await call('regWatch:logs', { limit: 500 })
      const total = (afterTrim.rows || []).length
      check('E1 监控日志按设置裁剪', total <= keep + 2, `keep=${keep} actual=${total}`)
      await call('regWatch:stop', { path: BASE })
      await call('regWatch:remove', { path: BASE })
    } finally {
      store.writeConfig({ scheduleLogKeep: oldKeep })
    }

    const sc = await call('schedule:create', {
      name: 'Deep3-任务', type: 'registry-backup',
      schedule: { frequency: 'daily', time: '04:10' },
      params: { path: BASE }, runHidden: true, notifyOnFail: true
    })
    const sid = sc && (sc.id || (sc.task && sc.task.id))
    if (sid) createdSchedules.push(sid)
    check('E2 定时任务创建成功', !!sid, JSON.stringify(sc).slice(0, 300))

    const sl = await call('schedule:list')
    const task = (sl.tasks || []).find((t) => t.id === sid)
    check('E3 列表返回任务并带 stale 字段', !!task && typeof task.stale === 'boolean', JSON.stringify(task).slice(0, 200))

    const prev = await call('schedule:preview', { schedule: { frequency: 'weekly', time: '09:30', weekdays: [1, 5] } })
    check('E4 计划预览可读', !!(prev.description), JSON.stringify(prev).slice(0, 200))
  } catch (err) {
    fail++
    failures.push('未捕获异常')
    console.log('FATAL', err && err.message)
    console.log(err && err.stack)
  } finally {
    /* ---------- 清理 ---------- */
    try { await call('regWatch:remove', { path: BASE }) } catch { /* ignore */ }
    try { cleanRegistry() } catch { /* ignore */ }
    try { await call('reg:deleteValue', { path: 'HKCU' + SEP + 'Environment', name: 'WEM_TEST_DEEP3_BADREF' }) } catch { /* ignore */ }
    try { await call('reg:deleteValue', { path: 'HKCU' + SEP + 'Environment', name: 'WEM_TEST_DEEP3_PATH' }) } catch { /* ignore */ }

    const ids = createdBackups.filter(Boolean)
    for (const id of ids) {
      try { await call('regBackup:toggleProtect', { id, protected: false }) } catch { /* ignore */ }
    }
    try { if (ids.length) await call('regBackup:remove', { ids }) } catch { /* ignore */ }

    try { if (createdSchedules.length) await call('schedule:remove', { ids: createdSchedules }) } catch { /* ignore */ }

    // 清掉本轮产生的所有测试备份（含保底备份与自动备份）
    try {
      const rest = await call('regBackup:list')
      const junk = (rest || [])
        .filter((b) => /^(Deep3-|RestoreBackup-|HealthFixBackup-|ScheduleBackup-)/.test(b.name || '')
          || (b.tags || []).includes('test'))
        .map((b) => b.id)
      if (junk.length) await call('regBackup:remove', { ids: junk })
    } catch { /* ignore */ }

    try {
      const packDir = path.join(store.appDataDir(), 'configPack')
      if (fs.existsSync(packDir)) {
        fs.readdirSync(packDir)
          .filter((f) => /^PreImport-/.test(f))
          .forEach((f) => { try { fs.unlinkSync(path.join(packDir, f)) } catch { /* ignore */ } })
      }
    } catch { /* ignore */ }

    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }

    console.log(`\n结果 ${pass} 通过 / ${fail} 失败`)
    if (failures.length) console.log('失败项: ' + failures.join(' | '))
    app.exit(fail ? 1 : 0)
  }
}).catch((e) => {
  console.error('启动失败', e)
  app.exit(1)
})
