// 验证收藏夹 CRUD 与配置包导入三模式
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

  // ---------- 收藏夹 ----------
  let favId = ''
  let groupId = ''
  await check('收藏夹含两条内置预设', async () => {
    const r = await call('regFav:list')
    const builtin = (r.items || []).filter((x) => x.builtin)
    return builtin.length === 2 && builtin.some((x) => x.path === 'HKCU\\Environment')
  })
  await check('内置收藏不可删除', async () => {
    const r = await call('regFav:list')
    const b = (r.items || []).find((x) => x.builtin)
    try { await call('regFav:remove', { id: b.id }); return false }
    catch (e) { return /不能删除|隐藏/.test(e.message) }
  })
  await check('新建自定义分组', async () => {
    const r = await call('regFav:groups', { action: 'create', name: '我的工具' })
    const g = await call('regFav:list')
    const found = (g.groups || []).find((x) => x.name === '我的工具')
    groupId = found && found.id
    return !!groupId
  })
  await check('新建收藏到自定义分组', async () => {
    const r = await call('regFav:create', { name: '测试收藏', path: 'HKCU\\Software', groupId, note: '备注' })
    favId = r && r.id
    const list = await call('regFav:list')
    const hit = (list.items || []).find((x) => x.id === favId)
    return hit && hit.name === '测试收藏' && hit.groupId === groupId
  })
  await check('收藏路径非法时拒绝', async () => {
    try { await call('regFav:create', { name: 'bad', path: 'NOTAROOT\\x' }); return false }
    catch { return true }
  })
  await check('重命名收藏', async () => {
    await call('regFav:update', { id: favId, name: '改名后' })
    const list = await call('regFav:list')
    return (list.items || []).some((x) => x.id === favId && x.name === '改名后')
  })
  await check('隐藏内置收藏', async () => {
    const list = await call('regFav:list')
    const b = (list.items || []).find((x) => x.builtin)
    await call('regFav:update', { id: b.id, hidden: true })
    const after = await call('regFav:list')
    const hit = (after.items || []).find((x) => x.id === b.id)
    await call('regFav:update', { id: b.id, hidden: false })
    return hit && hit.hidden === true
  })
  let favExportFile = ''
  await check('导出收藏夹 JSON', async () => {
    favExportFile = path.join(store.appDataDir(), 'configPack', '_fav_test.json')
    const r = await call('regFav:exportJson', { file: favExportFile })
    const f = r.file || favExportFile
    return fs.existsSync(f) && JSON.parse(fs.readFileSync(f, 'utf8')).items.length >= 2
  })
  await check('删除自定义收藏', async () => {
    await call('regFav:remove', { id: favId })
    const list = await call('regFav:list')
    return !(list.items || []).some((x) => x.id === favId)
  })
  await check('导入收藏夹 merge 模式', async () => {
    const r = await call('regFav:importJson', { file: favExportFile, mode: 'merge' })
    try { fs.unlinkSync(favExportFile) } catch {}
    return r && (r.added > 0 || r.updated > 0 || r.skipped > 0)
  })

  // ---------- 配置包导入 ----------
  let packFile = ''
  await check('导出配置包用于导入测试', async () => {
    packFile = path.join(store.appDataDir(), 'configPack', '_import_test.wemcfg')
    const r = await call('configPack:exportPack', { file: packFile, note: '导入测试' })
    return fs.existsSync(r.file || packFile)
  })
  await check('inspect 返回模块清单', async () => {
    const r = await call('configPack:inspectPack', { file: packFile })
    return r.manifest && Array.isArray(r.manifest.modules) && r.manifest.modules.length >= 6
  })
  await check('导入前自动创建预备份', async () => {
    const before = fs.readdirSync(path.join(store.appDataDir(), 'configPack'))
      .filter((f) => /^PreImport/.test(f)).length
    await call('configPack:importPack', { file: packFile, mode: 'merge' })
    const after = fs.readdirSync(path.join(store.appDataDir(), 'configPack'))
      .filter((f) => /^PreImport/.test(f)).length
    return after > before
  })
  await check('覆盖模式导入成功', async () => {
    const r = await call('configPack:importPack', { file: packFile, mode: 'overwrite' })
    return r && Array.isArray(r.imported)
  })
  await check('仅选中模块导入', async () => {
    const r = await call('configPack:importPack', { file: packFile, mode: 'selected', modules: ['config'] })
    return r && Array.isArray(r.imported) && r.imported.length <= 1
  })

  // 清理：必须把测试造的收藏与分组删干净，否则会污染用户真实收藏夹
  await check('清理测试产物', async () => {
    try { fs.unlinkSync(packFile) } catch {}
    const dir = path.join(store.appDataDir(), 'configPack')
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir).filter((f) => /PreImport/.test(f)).forEach((f) => {
        try { fs.unlinkSync(path.join(dir, f)) } catch {}
      })
    }
    // 删除所有非内置收藏与分组，并取消内置项的隐藏状态
    const favs = await call('regFav:list')
    for (const it of (favs.items || [])) {
      if (!it.builtin) {
        try { await call('regFav:remove', { id: it.id }) } catch { /* ignore */ }
      } else if (it.hidden) {
        try { await call('regFav:update', { id: it.id, hidden: false }) } catch { /* ignore */ }
      }
    }
    for (const g of (favs.groups || [])) {
      if (!g.builtin) {
        try { await call('regFav:groups', { action: 'remove', id: g.id }) } catch { /* ignore */ }
      }
    }
    const left = await call('regFav:list')
    const clean = (left.items || []).every((x) => x.builtin) && (left.groups || []).every((x) => x.builtin)
    return clean
  })

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`)
  app.exit(fail ? 1 : 0)
}).catch((e) => { console.error('异常:', e); app.exit(1) })
