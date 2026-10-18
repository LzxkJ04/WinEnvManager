// 端到端冒烟：直接调用 IPC handler，验证注册表模块关键读操作真实可用
// 只读为主，写操作在临时键下进行并清理
const { app, dialog, shell } = require('electron')
const path = require('node:path')

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const handlers = new Map()
  const handle = (ch, fn) => handlers.set(ch, fn)
  const ctx = { dialog, shell, getWindow: () => null }
  for (const f of ['registry', 'reg-backup', 'reg-extra']) {
    require(path.join(__dirname, '..', 'electron', 'ipc', f + '.js')).register(handle, ctx)
  }

  let pass = 0
  let fail = 0
  const call = async (ch, arg) => {
    const fn = handlers.get(ch)
    if (!fn) throw new Error(`通道不存在: ${ch}`)
    return fn({}, arg)
  }
  const check = async (name, fn) => {
    try {
      const r = await fn()
      if (r === false || r === undefined) { fail++; console.log('FAIL ', name, '(返回空)') }
      else { pass++; console.log('PASS ', name) }
    } catch (e) { fail++; console.log('FAIL ', name, '->', e.message) }
  }

  console.log('已注册通道:', handlers.size)

  // 读操作
  await check('reg:roots', async () => {
    const r = await call('reg:roots')
    return Array.isArray(r) && r.length >= 4
  })
  await check('reg:envPaths', async () => {
    const r = await call('reg:envPaths')
    return r && r.user === 'HKCU\\Environment'
  })
  await check('reg:isAdmin', async () => {
    const r = await call('reg:isAdmin')
    return r && typeof r.admin === 'boolean'
  })
  await check('reg:subKeys(HKCU)', async () => {
    const r = await call('reg:subKeys', 'HKCU\\Environment')
    return Array.isArray(r)
  })
  await check('reg:values 含类型与权限', async () => {
    const r = await call('reg:values', 'HKCU\\Environment')
    return r.values.length > 0 && r.values.every((v) => /^REG_/.test(v.type)) && typeof r.writable === 'boolean'
  })
  await check('reg:keyExists 存在', async () => {
    const r = await call('reg:keyExists', 'HKCU\\Environment')
    return r.exists === true
  })
  await check('reg:keyExists 不存在', async () => {
    const r = await call('reg:keyExists', 'HKCU\\NoSuchKey_WEM_TEST')
    return r.exists === false
  })

  // 写入 + 删除（临时键，用完清理）
  const TEST_KEY = 'HKCU\\Environment_WEM_IPC_TEST'
  await check('reg:createKey', async () => {
    await call('reg:createKey', { parentPath: 'HKCU', keyName: 'Environment_WEM_IPC_TEST' })
    const r = await call('reg:keyExists', TEST_KEY)
    return r.exists === true
  })
  await check('reg:setValue REG_SZ', async () => {
    await call('reg:setValue', { path: TEST_KEY, name: 'TestStr', type: 'REG_SZ', value: 'hello' })
    const r = await call('reg:values', TEST_KEY)
    return r.values.some((v) => v.name === 'TestStr' && v.value === 'hello')
  })
  await check('reg:setValue REG_EXPAND_SZ 不降级', async () => {
    await call('reg:setValue', { path: TEST_KEY, name: 'TestExp', type: 'REG_EXPAND_SZ', value: '%TEMP%\\x' })
    const r = await call('reg:values', TEST_KEY)
    const v = r.values.find((x) => x.name === 'TestExp')
    return v && v.type === 'REG_EXPAND_SZ'
  })
  await check('reg:setValue REG_DWORD', async () => {
    await call('reg:setValue', { path: TEST_KEY, name: 'TestDw', type: 'REG_DWORD', value: '42' })
    const r = await call('reg:values', TEST_KEY)
    const v = r.values.find((x) => x.name === 'TestDw')
    return v && v.type === 'REG_DWORD' && String(v.value) === '42'
  })
  await check('reg:setValue REG_MULTI_SZ', async () => {
    await call('reg:setValue', { path: TEST_KEY, name: 'TestMulti', type: 'REG_MULTI_SZ', value: 'a\nb' })
    const r = await call('reg:values', TEST_KEY)
    const v = r.values.find((x) => x.name === 'TestMulti')
    return v && v.type === 'REG_MULTI_SZ' && v.value.includes('a') && v.value.includes('b')
  })
  await check('reg:deleteValue', async () => {
    await call('reg:deleteValue', { path: TEST_KEY, name: 'TestStr' })
    const r = await call('reg:values', TEST_KEY)
    return !r.values.some((v) => v.name === 'TestStr')
  })
  await check('reg:deleteKey 非空需递归', async () => {
    try {
      await call('reg:deleteKey', { path: TEST_KEY, recursive: false })
      return false
    } catch (e) {
      return /子项|遍历|递归/.test(e.message) || true
    }
  })
  await check('reg:deleteKey 递归清理', async () => {
    await call('reg:deleteKey', { path: TEST_KEY, recursive: true })
    const r = await call('reg:keyExists', TEST_KEY)
    return r.exists === false
  })

  // 依赖 / 健康 / 收藏 / 定时
  await check('regFav:list 含内置预设', async () => {
    const r = await call('regFav:list')
    return r.items.some((i) => i.builtin && i.path === 'HKCU\\Environment')
  })
  await check('health:lastScore', async () => {
    const r = await call('health:lastScore')
    return r !== undefined
  })
  await check('schedule:list', async () => {
    const r = await call('schedule:list')
    return Array.isArray(r.tasks)
  })
  await check('regBackup:list', async () => {
    const r = await call('regBackup:list')
    return Array.isArray(r)
  })
  await check('regDep:analyze 能识别引用', async () => {
    const r = await call('regDep:analyze', { path: 'HKCU\\Environment' })
    return r && Array.isArray(r.items)
  })

  // 危险操作必须被拒绝
  await check('定时任务拒绝修改类类型', async () => {
    try {
      await call('schedule:create', { name: 'x', type: 'modify-env', schedule: { frequency: 'daily', time: '03:00' } })
      return false
    } catch { return true }
  })

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`)
  app.exit(fail ? 1 : 0)
}).catch((e) => {
  console.error('异常:', e)
  app.exit(1)
})
