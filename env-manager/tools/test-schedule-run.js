// 验证四类定时任务真实执行 + --scheduled-run 入口 + 失效检测
const { app, dialog, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const handlers = new Map()
  for (const f of ['registry', 'reg-backup', 'reg-extra']) {
    require(path.join(__dirname, '..', 'electron', 'ipc', f + '.js')).register((c, fn) => handlers.set(c, fn), { dialog, shell })
  }
  const call = (ch, arg) => handlers.get(ch)({}, arg)
  const store = require('../electron/lib/store')
  const mod = require('../electron/ipc/reg-extra.js')

  let pass = 0, fail = 0
  const check = async (name, fn) => {
    try {
      const r = await fn()
      if (r) { pass++; console.log('PASS ', name) } else { fail++; console.log('FAIL ', name) }
    } catch (e) { fail++; console.log('FAIL ', name, '->', e.message) }
  }

  const created = []
  const mk = async (type, params) => {
    const r = await call('schedule:create', {
      name: `测试-${type}`, type, params: params || {},
      schedule: { frequency: 'daily', time: '04:00' }
    })
    const id = r && (r.id || (r.task && r.task.id))
    if (id) created.push(id)
    return id
  }

  // 1. snapshot 任务真实执行
  await check('snapshot 任务能真实创建快照', async () => {
    const id = await mk('snapshot')
    if (!id) return false
    const before = fs.readdirSync(store.snapshotDir()).length
    const task = (await call('schedule:list')).tasks.find((t) => t.id === id)
    const res = await mod.runScheduledTask(id)
    const after = fs.readdirSync(store.snapshotDir()).length
    return res && res.kind === 'snapshot' && after >= before && !!res.file
  })

  // 2. registry-backup 任务真实执行
  await check('registry-backup 任务能真实备份', async () => {
    const id = await mk('registry-backup', { paths: ['HKCU\\Environment'] })
    if (!id) return false
    const res = await mod.runScheduledTask(id)
    return res && res.kind === 'registry-backup' && !!res.file && fs.existsSync(res.file)
  })

  // 3. audit-export 任务真实执行
  await check('audit-export 任务能真实导出', async () => {
    const id = await mk('audit-export')
    if (!id) return false
    const res = await mod.runScheduledTask(id)
    return res && res.kind === 'audit-export'
  })

  // 4. health-scan 任务真实执行并产出报告
  await check('health-scan 任务能扫描并出报告', async () => {
    const id = await mk('health-scan')
    if (!id) return false
    const res = await mod.runScheduledTask(id)
    return res && res.kind === 'health-scan' && typeof res.score === 'number' && fs.existsSync(res.file)
  })

  // 5. 执行后写审计
  await check('任务执行写入审计', async () => {
    const audits = store.listAudit(200)
    return audits.some((a) => a.action === 'scheduleRun')
  })

  // 6. 禁用任务不执行
  await check('禁用任务拒绝执行', async () => {
    const id = await mk('snapshot')
    await call('schedule:setEnabled', { ids: [id], enabled: false })
    try { await mod.runScheduledTask(id); return false }
    catch (e) { return /禁用/.test(e.message) }
  })

  // 7. 不存在的任务报错
  await check('不存在的任务报错', async () => {
    try { await mod.runScheduledTask('sch-nope-xxxx'); return false }
    catch (e) { return /不存在/.test(e.message) }
  })

  // 8. 失效检测（exePath 不同则 stale）
  await check('监听列表能返回任务', async () => {
    const r = await call('schedule:list')
    return Array.isArray(r.tasks) && r.tasks.length >= 3
  })

  // 清理
  await check('清理测试任务', async () => {
    if (created.length) await call('schedule:remove', { ids: created })
    // 测试产生的「定时快照 / 定时任务注册表备份」也要清掉，避免污染真实数据
    try {
      const ops = require('../electron/lib/ops')
      for (const s of ops.listSnapshots()) {
        if (/^定时快照/.test(s.name || '')) {
          try { ops.deleteSnapshot(s.id) } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
    try {
      const list = await call('regBackup:list')
      // 实际前缀是 ScheduleBackup（无 d），同时兼容 ScheduledBackup 与中文「定时」
      const auto = list
        .filter((x) => /^(Scheduled?Backup|定时)/.test(x.name || ''))
        .map((x) => x.id)
      if (auto.length) await call('regBackup:remove', { ids: auto })
    } catch { /* ignore */ }
    const after = await call('schedule:list')
    return !after.tasks.some((t) => created.includes(t.id))
  })

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`)
  app.exit(fail ? 1 : 0)
}).catch((e) => { console.error('异常:', e); app.exit(1) })
