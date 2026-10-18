// 验证备份 / 恢复 / 对比 / 依赖 / 监控的真实闭环
// 全部在专用测试键下进行，结束后清理
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

  let pass = 0, fail = 0
  const check = async (name, fn) => {
    try {
      const r = await fn()
      if (r) { pass++; console.log('PASS ', name) } else { fail++; console.log('FAIL ', name) }
    } catch (e) { fail++; console.log('FAIL ', name, '->', e.message) }
  }

  const BASE = 'HKCU\\Environment_WEM_BAK_TEST'

  // 造测试数据
  await check('搭建测试分支', async () => {
    await call('reg:createKey', { parentPath: 'HKCU', keyName: 'Environment_WEM_BAK_TEST' })
    await call('reg:setValue', { path: BASE, name: 'A', type: 'REG_SZ', value: 'v1' })
    await call('reg:setValue', { path: BASE, name: 'B', type: 'REG_EXPAND_SZ', value: '%TEMP%\\x' })
    await call('reg:createKey', { parentPath: BASE, keyName: 'Sub' })
    await call('reg:setValue', { path: BASE + '\\Sub', name: 'C', type: 'REG_DWORD', value: '7' })
    return true
  })

  let backupId = ''
  let backupFile = ''
  await check('创建 JSON 备份', async () => {
    const r = await call('regBackup:create', { path: BASE, name: 'BAK-测试', format: 'json', tags: ['测试'] })
    backupId = r.id
    backupFile = r.file
    return !!(r.id && r.file && fs.existsSync(r.file))
  })
  await check('备份列表能读到该备份', async () => {
    const list = await call('regBackup:list')
    return list.some((x) => x.id === backupId)
  })
  await check('备份预览可用', async () => {
    const r = await call('regBackup:preview', { id: backupId })
    return r && r.meta && r.summary.keyCount > 0
  })
  await check('备份文件被篡改时校验失败', async () => {
    const bak = fs.readFileSync(backupFile)
    const tampered = backupFile.replace('.json', '.tamper.json')
    const obj = JSON.parse(bak.toString('utf8'))
    obj.nodes[0].values[0].value = 'HACKED'
    fs.writeFileSync(tampered, JSON.stringify(obj), 'utf8')
    // 直接把文件塞进备份目录并用同一 id 覆盖预览会走哈希校验
    const orig = fs.readFileSync(backupFile)
    fs.writeFileSync(backupFile, JSON.stringify(obj), 'utf8')
    let rejected = false
    try { await call('regBackup:preview', { id: backupId }) } catch (e) { rejected = /校验失败|篡改|损坏/.test(e.message) }
    fs.writeFileSync(backupFile, orig)
    try { fs.unlinkSync(tampered) } catch {}
    return rejected
  })

  // 改动后恢复
  await check('改动数据后 dryRun 能给出差异', async () => {
    await call('reg:setValue', { path: BASE, name: 'A', type: 'REG_SZ', value: 'v2-modified' })
    await call('reg:deleteValue', { path: BASE, name: 'B' })
    const r = await call('regBackup:restore', { id: backupId, dryRun: true })
    const rows = r.changes || []
    const hasUpdate = rows.some((x) => x.name === 'A' && x.action === 'update')
    const hasCreate = rows.some((x) => x.name === 'B' && x.action === 'create')
    return hasUpdate && hasCreate
  })
  await check('正式恢复还原原始值', async () => {
    await call('regBackup:restore', { id: backupId })
    const v = await call('reg:values', BASE)
    const a = v.values.find((x) => x.name === 'A')
    const b = v.values.find((x) => x.name === 'B')
    return a && a.value === 'v1' && b && b.type === 'REG_EXPAND_SZ'
  })

  // 对比：同一备份 vs 改动后的当前
  await check('regDiff:compareWithCurrent 能发现差异', async () => {
    await call('reg:setValue', { path: BASE, name: 'A', type: 'REG_SZ', value: 'changed-again' })
    const r = await call('regDiff:compareWithCurrent', { id: backupId, path: BASE })
    return r && Array.isArray(r.rows) && r.rows.some((x) => x.name === 'A' && x.changeType === 'modified')
  })
  await check('regDiff:buildRollback 生成反向清单', async () => {
    const cmp = await call('regDiff:compareWithCurrent', { id: backupId, path: BASE })
    const rb = await call('regDiff:buildRollback', { rows: cmp.rows })
    return rb && Array.isArray(rb.rows)
  })
  await check('regDiff:exportReport 导出 HTML 含颜色', async () => {
    const cmp = await call('regDiff:compareWithCurrent', { id: backupId, path: BASE })
    const target = path.join(require('../electron/lib/store').appDataDir(), 'registryBackup', 'report-test.html')
    const r = await call('regDiff:exportReport', { rows: cmp.rows, format: 'html', file: target })
    const txt = fs.readFileSync(target, 'utf8')
    fs.unlinkSync(target)
    return !!r.file && /#00b42a|#ff7d00|#f53f3f/.test(txt)
  })

  // 依赖分析闭环
  await check('regDep:analyze 识别 %TEMP% 引用', async () => {
    const r = await call('regDep:analyze', { path: BASE })
    const item = (r.items || []).find((x) => x.name === 'B')
    return item && item.refs.some((ref) => ref.name.toUpperCase() === 'TEMP' && ref.exists)
  })
  await check('regDep:analyze 标记无效引用', async () => {
    await call('reg:setValue', { path: BASE, name: 'Bad', type: 'REG_EXPAND_SZ', value: '%NO_SUCH_VAR_XYZ%\\a' })
    const r = await call('regDep:analyze', { path: BASE })
    return (r.invalid || []).some((x) => x.ref === 'NO_SUCH_VAR_XYZ' || (x.name || '').toUpperCase() === 'NO_SUCH_VAR_XYZ')
  })

  // 监控
  await check('监控启动与停止', async () => {
    await call('regWatch:add', { path: BASE, interval: 1500 })
    const l1 = await call('regWatch:list')
    const running = l1.watchers.some((w) => w.running !== false)
    await call('regWatch:stop', { path: BASE })
    await call('regWatch:remove', { path: BASE })
    const l2 = await call('regWatch:list')
    return running && !l2.watchers.some((w) => w.path === BASE)
  })

  // 清理
  await check('清理测试分支与备份', async () => {
    await call('reg:deleteKey', { path: BASE, recursive: true })
    // 恢复流程会留下 RestoreBackup-* 保底备份，一并清掉
    const list = await call('regBackup:list')
    const junk = list.filter((x) => x.id === backupId || /^RestoreBackup|BAK-测试|report-test/.test(x.name || ''))
    if (junk.length) await call('regBackup:remove', { ids: junk.map((x) => x.id) })
    const e = await call('reg:keyExists', BASE)
    return e.exists === false
  })

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`)
  app.exit(fail ? 1 : 0)
}).catch((e) => { console.error('异常:', e); app.exit(1) })
