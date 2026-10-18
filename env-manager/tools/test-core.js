// 核心链路自测：注册表读写（含中文）、快照、备份导出与解析
const { app, dialog, shell, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const store = require('../electron/lib/store')
const registry = require('../electron/lib/registry')
const ops = require('../electron/lib/ops')

const results = []
function check(name, pass, extra) {
  results.push({ name, pass, extra })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  :: ' + extra : ''}`)
}

app.whenReady().then(async () => {
  store.ensureAll()

  // 1. 读取
  const before = await registry.readAllEnv()
  check('读取全部环境变量', before.user.length > 0 && before.machine.length > 0,
    `用户 ${before.user.length} / 系统 ${before.machine.length}`)

  // 2. 管理员判定
  const admin = await registry.isAdmin()
  check('管理员权限判定', typeof admin === 'boolean', `admin=${admin}`)

  // 3. 名称校验
  check('拦截非法变量名 =', registry.validateName('A=B').ok === false)
  check('拦截非法变量名 %', registry.validateName('A%B').ok === false)
  check('空名称拦截', registry.validateName('').ok === false)

  // 4. 写入 / 读取 / 删除（含中文）
  const testName = 'WEM_SELFTEST_VAR'
  const testValue = 'C:\\工具\\测试目录;%USERPROFILE%\\中文'
  await registry.writeValue('user', testName, testValue)
  let afterWrite = await registry.readScope('user')
  const got = afterWrite.find((v) => v.name === testName)
  check('写入并读回用户变量（中文往返）', got && got.value === testValue,
    got ? JSON.stringify(got.value) : '未找到')

  // 5. 未展开 %VAR% 原样保留
  check('%VAR% 原样保留', got && got.value.includes('%USERPROFILE%'))

  // 6. 覆盖写
  await registry.writeValue('user', testName, 'v2')
  afterWrite = await registry.readScope('user')
  check('覆盖写入', afterWrite.find((v) => v.name === testName)?.value === 'v2')

  // 7. 路径存在性校验
  const checkRes = await registry.checkPathsExist(['C:\\Windows', 'C:\\__not_exist_dir__', '%SystemRoot%'])
  const map = Object.fromEntries(checkRes.map((r) => [r.path, r.exists]))
  check('路径有效性校验', map['C:\\Windows'] === true && map['C:\\__not_exist_dir__'] === false && map['%SystemRoot%'] === true,
    JSON.stringify(map))

  // 8. 变量展开
  const expanded = await registry.expandString('%SystemRoot%\\system32')
  check('变量解析', /Windows\\system32$/i.test(expanded.trim()), expanded.trim())

  // 9. 批量 applyChanges
  const applyRes = await registry.applyChanges([
    { action: 'create', scope: 'user', name: 'WEM_SELFTEST_A', value: 'a' },
    { action: 'create', scope: 'user', name: 'WEM_SELFTEST_B', value: 'b' },
    { action: 'delete', scope: 'user', name: 'WEM_SELFTEST_B' }
  ])
  check('批量变更执行', applyRes.every((r) => r.ok), JSON.stringify(applyRes))
  const afterBatch = await registry.readScope('user')
  check('批量变更结果正确',
    !!afterBatch.find((v) => v.name === 'WEM_SELFTEST_A') && !afterBatch.find((v) => v.name === 'WEM_SELFTEST_B'))

  // 10. 快照
  const snap = await ops.createSnapshot({ name: '自测快照', note: '自动化测试' })
  check('创建快照', fs.existsSync(snap.file), snap.id)
  const list = ops.listSnapshots()
  check('快照列表', list.some((s) => s.id === snap.id), `共 ${list.length} 个`)

  // 11. 差异对比
  const cur = await ops.captureEnv()
  const diff = ops.compareEnv({ left: { user: snap.user, machine: snap.machine }, right: cur })
  check('差异对比计算', typeof diff.summary.total === 'number', JSON.stringify(diff.summary))

  // 12. 备份三种格式
  for (const format of ['json', 'txt', 'reg']) {
    const b = await ops.createBackup({ format, prefix: 'SelfTest' })
    const size = fs.statSync(b.file).size
    check(`导出 ${format.toUpperCase()} 备份`, size > 0, `${path.basename(b.file)} ${size}B`)
    const preview = await ops.importPreview({ file: b.file })
    check(`解析 ${format.toUpperCase()} 备份`, preview.total > 0, `解析出 ${preview.total} 条`)
    if (format === 'reg') {
      const os = preview.items.find((i) => i.name === 'OS' && i.scope === 'machine')
      const pathext = preview.items.find((i) => i.name.toUpperCase() === 'PATHEXT' && i.scope === 'machine')
      check('REG 还原用户变量归属', preview.items.some((i) => i.scope === 'user' && i.name === 'TEMP'))
      check('REG hex(2) 值正确解码',
        !!os && os.value === 'Windows_NT' && !!pathext && pathext.value.includes('.COM'),
        `OS=${os && os.value} / PATHEXT=${pathext && pathext.value.slice(0, 24)}`)
    }
    fs.rmSync(b.file, { force: true })
  }

  // 13. 清理测试变量
  await registry.deleteValue('user', testName)
  await registry.deleteValue('user', 'WEM_SELFTEST_A')
  const finalList = await registry.readScope('user')
  check('清理测试变量',
    !finalList.find((v) => v.name.startsWith('WEM_SELFTEST')),
    finalList.map((v) => v.name).join(','))

  // 14. 循环引用检测（纯函数，不触碰注册表）
  const { detectCycles } = require('../electron/ipc/analyze')
  const cycAB = detectCycles([{ name: 'A', value: '%B%\\x' }, { name: 'B', value: 'pre-%A%' }])
  check('循环引用 A↔B', cycAB.length === 1 && cycAB[0].length === 2, JSON.stringify(cycAB))
  const cycSelf = detectCycles([{ name: 'JAVA_HOME', value: '%JAVA_HOME%\\bin' }])
  check('自引用检测', cycSelf.length === 1 && cycSelf[0][0] === 'JAVA_HOME')
  const cycNone = detectCycles([{ name: 'A', value: '%B%' }, { name: 'B', value: '%C%' }, { name: 'C', value: 'ok' }])
  check('无环链不误报', cycNone.length === 0)
  const cycBroken = detectCycles([{ name: 'A', value: '%NOT_DEFINED%' }])
  check('断裂引用不算循环', cycBroken.length === 0)
  const cycDup = detectCycles([{ name: 'a', value: '%B%' }, { name: 'B', value: '%A%' }])
  check('环去重且大小写归一', cycDup.length === 1, JSON.stringify(cycDup))

  // 15. 快照删除
  ops.deleteSnapshot(snap.id)
  check('删除快照', !fs.existsSync(snap.file))

  console.log('\n=== SUMMARY ===')
  const failed = results.filter((r) => !r.pass)
  console.log(`total=${results.length} pass=${results.length - failed.length} fail=${failed.length}`)
  if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(' | '))
  app.exit(failed.length ? 1 : 0)
})

setTimeout(() => {
  console.log('TIMEOUT')
  app.exit(2)
}, 120000)
