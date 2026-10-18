// 验证本次补充的功能：reg:search、reg:deleteKey、regDep:findReferences、regDep:graph
const { app, dialog, shell } = require('electron')
const path = require('node:path')

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const handlers = new Map()
  for (const f of ['registry', 'reg-backup', 'reg-extra']) {
    require(path.join(__dirname, '..', 'electron', 'ipc', f + '.js')).register((c, fn) => handlers.set(c, fn), { dialog, shell })
  }
  const call = (ch, arg) => handlers.get(ch)({}, arg)

  let pass = 0, fail = 0
  const check = async (name, fn) => {
    try {
      const r = await fn()
      if (r) { pass++; console.log('PASS ', name) } else { fail++; console.log('FAIL ', name) }
    } catch (e) { fail++; console.log('FAIL ', name, '->', e.message) }
  }

  // 1. reg:search —— 在 HKCU\Environment 里搜 PATH
  await check('reg:search 能命中键名', async () => {
    const r = await call('reg:search', { path: 'HKCU\\Environment', keyword: 'PATH', scope: 'name' })
    return r.results.some((x) => (x.name || '').toUpperCase().includes('PATH'))
  })
  await check('reg:search 能命中键值', async () => {
    // 用 "Temp" 而不是 "%"：本机 PATH 等变量已被改写成绝对路径，未必含 %
    const r = await call('reg:search', { path: 'HKCU\\Environment', keyword: 'Temp', scope: 'value' })
    return r.results.length > 0 && r.results.every((x) => x.matchIn === 'value')
  })
  await check('reg:search 无命中时返回空数组而非报错', async () => {
    const r = await call('reg:search', { path: 'HKCU\\Environment', keyword: 'zzz_no_such_text_zzz', scope: 'both' })
    return Array.isArray(r.results) && r.results.length === 0
  })
  await check('reg:search 空关键词被拒', async () => {
    try { await call('reg:search', { path: 'HKCU\\Environment', keyword: '' }); return false }
    catch { return true }
  })

  // 2. reg:deleteKey —— 建一个带子项的测试树，递归删除
  const ROOT = 'HKCU\\Environment_WEM_DEL_TEST'
  await check('搭建测试树', async () => {
    await call('reg:createKey', { parentPath: 'HKCU', keyName: 'Environment_WEM_DEL_TEST' })
    await call('reg:createKey', { parentPath: ROOT, keyName: 'ChildA' })
    await call('reg:setValue', { path: ROOT + '\\ChildA', name: 'X', type: 'REG_SZ', value: '1' })
    const r = await call('reg:subKeys', ROOT)
    return Array.isArray(r) && r.length === 1
  })
  await check('reg:deleteKey 非递归拒绝非空项', async () => {
    try { await call('reg:deleteKey', { path: ROOT, recursive: false }); return false }
    catch (e) { return /子项|递归/.test(e.message) }
  })
  await check('reg:deleteKey 递归删除整棵子树', async () => {
    await call('reg:deleteKey', { path: ROOT, recursive: true })
    const r = await call('reg:keyExists', ROOT)
    return r.exists === false
  })
  await check('reg:deleteKey 拒绝删除根项', async () => {
    try { await call('reg:deleteKey', { path: 'HKCU', recursive: true }); return false }
    catch { return true }
  })

  // 3. regDep:findReferences —— 用真实存在的变量查引用
  await check('regDep:findReferences 可执行', async () => {
    const r = await call('regDep:findReferences', { varName: 'JAVA_HOME', roots: ['HKCU\\Software'] })
    return r && Array.isArray(r.results) && typeof r.scanned === 'number'
  })

  // 4. regDep:graph —— 用 analyze 结果生成图
  await check('regDep:graph 生成节点与边', async () => {
    const a = await call('regDep:analyze', { path: 'HKCU\\Environment' })
    const g = await call('regDep:graph', { items: a.items || [] })
    return g && Array.isArray(g.nodes) && Array.isArray(g.edges)
  })

  // 5. 回归：确认核心读写仍正常
  await check('回归 reg:values', async () => {
    const r = await call('reg:values', 'HKCU\\Environment')
    return r.values.length > 0
  })

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`)
  app.exit(fail ? 1 : 0)
}).catch((e) => { console.error('异常:', e); app.exit(1) })
