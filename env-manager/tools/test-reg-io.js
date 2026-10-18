// 验证导入导出与批量查找替换闭环
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

  let pass = 0, fail = 0
  const check = async (name, fn) => {
    try {
      const r = await fn()
      if (r) { pass++; console.log('PASS ', name) } else { fail++; console.log('FAIL ', name) }
    } catch (e) { fail++; console.log('FAIL ', name, '->', e.message) }
  }

  const BASE = 'HKCU\\Environment_WEM_IO_TEST'
  const tmpDir = path.join(store.appDataDir(), '_io_test')
  fs.mkdirSync(tmpDir, { recursive: true })

  // 造数据：含不同值类型
  await check('搭建导出用测试分支', async () => {
    await call('reg:createKey', { parentPath: 'HKCU', keyName: 'Environment_WEM_IO_TEST' })
    await call('reg:setValue', { path: BASE, name: 'Str', type: 'REG_SZ', value: 'C:\\路径\\中文' })
    await call('reg:setValue', { path: BASE, name: 'Exp', type: 'REG_EXPAND_SZ', value: '%TEMP%\\子目录' })
    await call('reg:setValue', { path: BASE, name: 'Dw', type: 'REG_DWORD', value: '42' })
    await call('reg:setValue', { path: BASE, name: 'Qw', type: 'REG_QWORD', value: '9000000000' })
    await call('reg:setValue', { path: BASE, name: 'Multi', type: 'REG_MULTI_SZ', value: '第一行\n第二行' })
    await call('reg:setValue', { path: BASE, name: 'Bin', type: 'REG_BINARY', value: 'DEADBEEF' })
    return true
  })

  // 导出 reg
  const regFile = path.join(tmpDir, 'export.reg')
  await check('导出 reg 文件含全部类型', async () => {
    const r = await call('reg:exportReg', { path: BASE, file: regFile, encoding: 'utf8' })
    const txt = fs.readFileSync(regFile, 'utf8')
    return txt.includes('Windows Registry Editor') && txt.includes('dword:0000002a')
      && txt.includes('hex(2):') && txt.includes('hex(b):') && txt.includes(`[${BASE}]`)
  })
  await check('导出 reg 中文不乱码', async () => {
    const txt = fs.readFileSync(regFile, 'utf8')
    return txt.includes('路径') && txt.includes('中文')
  })

  // 解析回来
  await check('解析 reg 还原全部类型', async () => {
    const r = await call('reg:parseReg', { file: regFile, mode: 'merge' })
    const vals = (r.nodes[0] && r.nodes[0].values) || []
    const byName = {}
    vals.forEach((v) => { byName[v.name] = v })
    return byName.Exp && byName.Exp.type === 'REG_EXPAND_SZ'
      && byName.Exp.value.includes('%TEMP%')
      && byName.Dw && byName.Dw.value === '42'
      && byName.Multi && byName.Multi.value.includes('第一行')
      && byName.Bin && /DEADBEEF/i.test(byName.Bin.binary || byName.Bin.value)
  })

  // 导入到新分支
  await check('导入 reg 到新分支', async () => {
    const parsed = await call('reg:parseReg', { file: regFile, mode: 'merge' })
    const rows = (parsed.rows || []).map((r) => ({ ...r, path: 'HKCU\\Environment_WEM_IO_DEST' }))
    // 目标分支不存在，先建
    await call('reg:createKey', { parentPath: 'HKCU', keyName: 'Environment_WEM_IO_DEST' })
    const res = await call('reg:applyImport', { rows })
    const vals = await call('reg:values', 'HKCU\\Environment_WEM_IO_DEST')
    return res.applied > 0 && vals.values.length >= 6
  })
  await check('导入后 REG_EXPAND_SZ 未被降级', async () => {
    const vals = await call('reg:values', 'HKCU\\Environment_WEM_IO_DEST')
    const exp = vals.values.find((v) => v.name === 'Exp')
    return exp && exp.type === 'REG_EXPAND_SZ' && exp.value === '%TEMP%\\子目录'
  })

  // 批量查找替换
  await check('批量替换扫描能命中', async () => {
    const r = await call('regReplace:scan', { path: BASE, find: 'TEMP', replace: 'USERPROFILE', scope: 'value' })
    return r.matched > 0 && r.rows.some((x) => x.name === 'Exp' && x.after.includes('%USERPROFILE%'))
  })
  await check('批量替换只处理字符串类型', async () => {
    const r = await call('regReplace:scan', { path: BASE, find: '42', replace: '99', scope: 'value' })
    // REG_DWORD 的 42 不应被替换（非字符串类型）
    return !r.rows.some((x) => x.name === 'Dw')
  })
  await check('批量替换实际写入', async () => {
    const scan = await call('regReplace:scan', { path: BASE, find: 'TEMP', replace: 'USERPROFILE', scope: 'value' })
    const picked = scan.rows.filter((x) => x.willChange)
    const res = await call('regReplace:apply', { rows: picked })
    const vals = await call('reg:values', BASE)
    const exp = vals.values.find((v) => v.name === 'Exp')
    return res.applied > 0 && exp.value.startsWith('%USERPROFILE%')
  })
  await check('批量替换前自动备份存在', async () => {
    const list = await call('regBackup:list')
    return list.some((x) => /Replace/i.test(x.name) || (x.tags || []).includes('auto'))
  })
  await check('区分大小写选项生效', async () => {
    const ci = await call('regReplace:scan', { path: BASE, find: 'userprofile', replace: 'X', scope: 'value', caseSensitive: false })
    const cs = await call('regReplace:scan', { path: BASE, find: 'userprofile', replace: 'X', scope: 'value', caseSensitive: true })
    return ci.matched > 0 && cs.matched === 0
  })

  // 清理
  await check('清理测试数据', async () => {
    await call('reg:deleteKey', { path: BASE, recursive: true })
    await call('reg:deleteKey', { path: 'HKCU\\Environment_WEM_IO_DEST', recursive: true })
    fs.rmSync(tmpDir, { recursive: true, force: true })
    // 批量替换的自动备份没有 auto 标签，按名称前缀一并清理，避免残留污染
    const list = await call('regBackup:list')
    const junk = list.filter((x) => (x.tags || []).includes('auto') || /^ReplaceBackup|写前自动备份|删除前自动备份/.test(x.name || ''))
    if (junk.length) await call('regBackup:remove', { ids: junk.map((x) => x.id) })
    const a = await call('reg:keyExists', BASE)
    return a.exists === false
  })

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`)
  app.exit(fail ? 1 : 0)
}).catch((e) => { console.error('异常:', e); app.exit(1) })
