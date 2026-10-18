/**
 * 验证 --scheduled-run 主进程入口：创建一个只读任务，然后按系统计划的方式调用。
 */
const { app, dialog, shell } = require('electron')
const { execFileSync, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

app.disableHardwareAcceleration()

let pass = 0
let fail = 0
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('PASS ', name) } else { fail++; console.log('FAIL ', name, extra == null ? '' : extra) }
}

app.whenReady().then(async () => {
  const store = require('../electron/lib/store')
  store.ensureAll()
  const handlers = new Map()
  require('../electron/ipc/reg-extra.js').register((c, f) => handlers.set(c, f), { dialog, shell })
  const call = (ch, arg) => handlers.get(ch)({}, arg)

  const outDir = path.join(store.appDataDir(), '_sched_out')
  fs.mkdirSync(outDir, { recursive: true })

  let id = ''
  try {
    const r = await call('schedule:create', {
      name: 'Deep3-定时入口验证',
      type: 'audit-export',
      schedule: { frequency: 'daily', time: '06:00' },
      params: { dir: outDir, format: 'csv' },
      runHidden: true,
      notifyOnFail: true
    })
    id = r && (r.id || (r.task && r.task.id))
    check('任务创建成功（含计划注册结果字段）', !!id, JSON.stringify(r).slice(0, 300))
    check('创建返回注册状态', r && typeof r.registered === 'boolean', JSON.stringify(Object.keys(r || {})))

    // 直接验证执行器函数可用（等价于 --scheduled-run 的调用路径）
    const mod = require('../electron/ipc/reg-extra.js')
    check('执行器已导出', typeof mod.runScheduledTask === 'function')

    if (typeof mod.runScheduledTask === 'function' && id) {
      const before = fs.readdirSync(outDir).length
      await mod.runScheduledTask(id)
      const after = fs.readdirSync(outDir)
      check('执行后产出了导出文件', after.length > before, `${before} -> ${after.length} ${after.join(',')}`)

      const list = await call('schedule:list')
      const t = (list.tasks || []).find((x) => x.id === id)
      check('任务记录了上次执行结果', !!t && !!t.lastRunAt, JSON.stringify({ lastRunAt: t && t.lastRunAt, lastResult: t && t.lastResult }))
    }
  } catch (e) {
    fail++
    console.log('FATAL', e && e.message)
  } finally {
    try { await call('schedule:remove', { ids: [id] }) } catch { /* ignore */ }
    try { fs.rmSync(outDir, { recursive: true, force: true }) } catch { /* ignore */ }
    console.log(`\n结果 ${pass} 通过 / ${fail} 失败`)
    app.exit(fail ? 1 : 0)
  }
}).catch((e) => { console.error(e); app.exit(1) })
