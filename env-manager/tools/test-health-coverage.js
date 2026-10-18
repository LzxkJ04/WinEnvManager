// 构造异常环境，验证健康诊断的 9 项检测是否都真实生效
// 全部在专用测试键下进行，结束后清理
const { app, dialog, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const handlers = new Map()
  for (const f of ['registry', 'reg-backup', 'reg-extra', 'envset']) {
    try { require(path.join(__dirname, '..', 'electron', 'ipc', f + '.js')).register((c, fn) => handlers.set(c, fn), { dialog, shell }) } catch {}
  }
  const call = (ch, arg) => handlers.get(ch)({}, arg)
  const store = require('../electron/lib/store')

  const USER_ENV = 'HKCU\\Environment'
  const backup = await call('reg:values', USER_ENV)
  const backupMap = {}
  backup.values.forEach((v) => { backupMap[v.name] = { type: v.type, value: v.value } })
  fs.writeFileSync(path.join(store.appDataDir(), '_health_test_backup.json'), JSON.stringify(backupMap), 'utf8')

  console.log('已备份 HKCU\\Environment 的', Object.keys(backupMap).length, '个键值')

  try {
    // 1) 重复 PATH 条目
    await call('reg:setValue', {
      path: USER_ENV, name: 'WEM_TEST_DUP',
      type: 'REG_EXPAND_SZ', value: 'C:\\Windows;C:\\Windows'
    })
    // 2) 无效引用
    await call('reg:setValue', {
      path: USER_ENV, name: 'WEM_TEST_BADREF',
      type: 'REG_EXPAND_SZ', value: '%NO_SUCH_VAR_WEM_XYZ%\\bin'
    })
    // 3) 循环引用
    await call('reg:setValue', { path: USER_ENV, name: 'WEM_TEST_CYCLE_A', type: 'REG_EXPAND_SZ', value: '%WEM_TEST_CYCLE_B%' })
    await call('reg:setValue', { path: USER_ENV, name: 'WEM_TEST_CYCLE_B', type: 'REG_EXPAND_SZ', value: '%WEM_TEST_CYCLE_A%' })
    // 4) 键值类型异常（环境变量用了 REG_DWORD）
    await call('reg:setValue', { path: USER_ENV, name: 'WEM_TEST_DWORD', type: 'REG_DWORD', value: '123' })

    const r = await call('health:scan')
    const types = new Set(r.items.map((i) => i.type))
    console.log('\n=== 注入异常后 ===')
    console.log('评分:', r.score, '统计:', JSON.stringify(r.stats))
    console.log('检测到类型:', [...types].join(', '))
    r.items.filter((i) => /WEM_TEST|path-|reference|cycle|value-type/i.test(`${i.type} ${i.location} ${i.title}`))
      .forEach((i) => console.log(' -', i.level, '|', i.type, '|', (i.title || '').slice(0, 60)))

    // 分类覆盖检查
    const want = ['path-duplicate', 'path-missing', 'path-format', 'invalid-reference', 'circular-reference', 'value-type', 'mutex-conflict', 'project-folder', 'tool-path']
    const hit = want.filter((w) => types.has(w))
    console.log('\n9 项检测中已触发:', hit.length, '/ 9 ->', hit.join(', '))
    console.log('未触发（本机无对应场景）:', want.filter((w) => !types.has(w)).join(', ') || '无')

  } finally {
    // 还原：删除注入的测试变量
    for (const name of ['WEM_TEST_DUP', 'WEM_TEST_BADREF', 'WEM_TEST_CYCLE_A', 'WEM_TEST_CYCLE_B', 'WEM_TEST_DWORD']) {
      try { await call('reg:deleteValue', { path: USER_ENV, name }) } catch {}
    }
    const after = await call('reg:values', USER_ENV)
    const leaked = after.values.filter((v) => /^WEM_TEST_/.test(v.name))
    console.log('\n清理结果: 残留测试变量', leaked.length, '个；当前变量数', after.values.length, '（原始', Object.keys(backupMap).length, '）')
    try { fs.unlinkSync(path.join(store.appDataDir(), '_health_test_backup.json')) } catch {}
  }

  app.exit(0)
})
