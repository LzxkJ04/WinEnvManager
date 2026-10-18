// 验证便携模式：数据目录跟随程序目录、注册表备份随 UserData 迁移
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const store = require('../electron/lib/store')
  let pass = 0, fail = 0
  const check = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ', name) }
    else { fail++; console.log('FAIL ', name, extra || '') }
  }

  const isPortable = store.isPortable()
  const dataDir = store.appDataDir()
  console.log('便携模式:', isPortable)
  console.log('数据目录:', dataDir)

  check('WEM_PORTABLE=1 时进入便携模式', isPortable === true)
  check('数据目录在 PORTABLE_EXECUTABLE_DIR 下', dataDir.toLowerCase().includes('.tmp-portable-test'),
    `实际: ${dataDir}`)
  check('数据目录含 UserData 段', /UserData/i.test(dataDir), `实际: ${dataDir}`)

  // 注册表备份应落在便携目录
  const handlers = new Map()
  const { dialog, shell } = require('electron')
  require('../electron/ipc/reg-backup.js').register((c, fn) => handlers.set(c, fn), { dialog, shell })
  const call = (ch, arg) => handlers.get(ch)({}, arg)

  try {
    const r = await call('regBackup:create', { path: 'HKCU\\Environment', name: '便携测试', format: 'json' })
    const inPortable = r.file.toLowerCase().includes('.tmp-portable-test')
    check('注册表备份写入便携目录', inPortable, `实际: ${r.file}`)
    // 清理
    await call('regBackup:remove', { ids: [r.id] })
  } catch (e) {
    check('注册表备份写入便携目录', false, e.message)
  }

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`)
  app.exit(fail ? 1 : 0)
}).catch((e) => { console.error(e); app.exit(1) })
