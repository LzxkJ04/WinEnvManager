/**
 * 验证四类定时任务的参数是否真实生效：
 *  - snapshot：protect 生效
 *  - registry-backup：params.path 生效
 *  - audit-export：params.dir 生效
 *  - health-scan：params.dir 生效
 */
const { app, dialog, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

app.disableHardwareAcceleration()
let pass = 0
let fail = 0
const check = (n, c, e) => { if (c) { pass++; console.log('PASS ', n) } else { fail++; console.log('FAIL ', n, e || '') } }

app.whenReady().then(async () => {
  const store = require('../electron/lib/store')
  store.ensureAll()
  const handlers = new Map()
  require('../electron/ipc/reg-extra.js').register((c, f) => handlers.set(c, f), { dialog, shell })
  const call = (ch, arg) => handlers.get(ch)({}, arg)
  const mod = require('../electron/ipc/reg-extra.js')

  const outDir = path.join(store.appDataDir(), '_sched_params_out')
  fs.mkdirSync(outDir, { recursive: true })
  const ids = []
  const createdFiles = []

  try {
    /* 1. snapshot：protect 参数生效 */
    const snapTask = await call('schedule:create', {
      name: 'P-snapshot', type: 'snapshot',
      schedule: { frequency: 'daily', time: '03:00' },
      params: { protect: true }, runHidden: true
    })
    ids.push(snapTask.id || (snapTask.task && snapTask.task.id))
    await mod.runScheduledTask(ids[0])
    const ops = require('../electron/lib/ops')
    const snaps = ops.listSnapshots().filter((s) => /^定时快照/.test(s.name || ''))
    check('1 snapshot 任务产出快照', snaps.length > 0, String(snaps.length))
    check('2 snapshot 的 protect 参数生效', snaps.length > 0 && snaps[0].protected === true,
      JSON.stringify(snaps[0] && { name: snaps[0].name, protected: snaps[0].protected }))
    snaps.forEach((s) => { try { ops.deleteSnapshot(s.id) } catch { /* ignore */ } })

    /* 2. registry-backup：params.path 生效（只备份指定分支） */
    const bakTask = await call('schedule:create', {
      name: 'P-regbackup', type: 'registry-backup',
      schedule: { frequency: 'daily', time: '03:00' },
      params: { path: 'HKCU' + String.fromCharCode(92) + 'Environment' }, runHidden: true
    })
    ids.push(bakTask.id || (bakTask.task && bakTask.task.id))
    await mod.runScheduledTask(ids[1])
    const bakDir = path.join(store.appDataDir(), 'registryBackup')
    const files = fs.existsSync(bakDir)
      ? fs.readdirSync(bakDir).filter((f) => /^ScheduleBackup-/.test(f)).sort()
      : []
    if (files.length) {
      const raw = JSON.parse(fs.readFileSync(path.join(bakDir, files[files.length - 1]), 'utf8'))
      const paths = (raw.nodes || []).map((n) => n.path)
      createdFiles.push(path.join(bakDir, files[files.length - 1]))
      check('3 registry-backup 只包含指定分支',
        paths.length > 0 && paths.every((p) => p.toUpperCase().startsWith('HKCU' + String.fromCharCode(92) + 'ENVIRONMENT')),
        JSON.stringify(paths.slice(0, 3)))
      check('4 registry-backup 未混入系统分支',
        !paths.some((p) => p.toUpperCase().startsWith('HKLM')),
        JSON.stringify(paths.filter((p) => p.toUpperCase().startsWith('HKLM')).slice(0, 2)))
    } else {
      check('3 registry-backup 只包含指定分支', false, '未生成备份文件')
      check('4 registry-backup 未混入系统分支', false, '未生成备份文件')
    }

    /* 3. audit-export：params.dir 生效 */
    const auditTask = await call('schedule:create', {
      name: 'P-auditexport', type: 'audit-export',
      schedule: { frequency: 'daily', time: '03:00' },
      params: { dir: outDir }, runHidden: true
    })
    ids.push(auditTask.id || (auditTask.task && auditTask.task.id))
    await mod.runScheduledTask(ids[2])
    const exported = fs.existsSync(outDir) ? fs.readdirSync(outDir).filter((f) => /^audit-export-/.test(f)) : []
    check('5 audit-export 按指定目录输出', exported.length > 0, JSON.stringify(fs.existsSync(outDir) ? fs.readdirSync(outDir) : []))

    /* 4. health-scan：params.dir 生效 */
    const healthTask = await call('schedule:create', {
      name: 'P-health', type: 'health-scan',
      schedule: { frequency: 'daily', time: '03:00' },
      params: { dir: outDir }, runHidden: true
    })
    ids.push(healthTask.id || (healthTask.task && healthTask.task.id))
    await mod.runScheduledTask(ids[3])
    const reports = fs.existsSync(outDir) ? fs.readdirSync(outDir).filter((f) => /^HealthReport-/.test(f)) : []
    check('6 health-scan 按指定目录输出报告', reports.length > 0, JSON.stringify(fs.existsSync(outDir) ? fs.readdirSync(outDir) : []))

    /* 5. 修改类任务仍被拒绝 */
    let rejected = false
    try {
      await call('schedule:create', { name: 'x', type: 'delete-env', schedule: { frequency: 'daily', time: '03:00' } })
    } catch (e) { rejected = /只读|不允许|修改类/.test(e.message) }
    check('7 修改类任务被后端拒绝', rejected)
  } catch (e) {
    fail++
    console.log('FATAL', e && e.message)
  } finally {
    try { if (ids.filter(Boolean).length) await call('schedule:remove', { ids: ids.filter(Boolean) }) } catch { /* ignore */ }
    // 清掉本轮产生的备份与文件
    try {
      const bakDir = path.join(store.appDataDir(), 'registryBackup')
      if (fs.existsSync(bakDir)) {
        for (const f of fs.readdirSync(bakDir)) {
          if (/^ScheduleBackup-/.test(f)) fs.rmSync(path.join(bakDir, f), { force: true })
        }
      }
    } catch { /* ignore */ }
    try {
      const ops = require('../electron/lib/ops')
      for (const s of ops.listSnapshots()) {
        if (/^定时快照/.test(s.name || '')) { try { ops.deleteSnapshot(s.id) } catch { /* ignore */ } }
      }
    } catch { /* ignore */ }
    try { fs.rmSync(outDir, { recursive: true, force: true }) } catch { /* ignore */ }
    console.log(`\n结果 ${pass} 通过 / ${fail} 失败`)
    app.exit(fail ? 1 : 0)
  }
}).catch((e) => { console.error(e); app.exit(1) })
