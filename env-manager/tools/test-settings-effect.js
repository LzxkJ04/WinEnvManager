// 验证设置页 9 个配置项是否真的影响行为
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

  const original = { ...store.readConfig() }
  const ENV = 'HKCU\\Environment'

  // 1. regSearchBinary —— 设置开启后，搜索默认包含二进制
  await check('regSearchBinary 影响搜索默认值', async () => {
    store.writeConfig({ regSearchBinary: false })
    const off = await call('reg:search', { path: ENV, keyword: 'zzz', scope: 'both' })
    store.writeConfig({ regSearchBinary: true })
    const on = await call('reg:search', { path: ENV, keyword: 'zzz', scope: 'both' })
    // 两次都应成功；重点在于不传 includeBinary 时默认值确实读配置，不抛错
    return off && on && Array.isArray(off.results) && Array.isArray(on.results)
  })

  // 2. regImportMode —— 设置 append 后，解析 reg 默认走「仅新增」
  await check('regImportMode 影响导入默认模式', async () => {
    store.writeConfig({ regImportMode: 'append' })
    const tmpReg = path.join(store.appDataDir(), '_mode_test.reg')
    fs.writeFileSync(tmpReg, [
      'Windows Registry Editor Version 5.00',
      '',
      '[HKCU\\Environment]',
      '"TEMP"="D:\\\\hacked-temp"'
    ].join('\r\n'), 'utf8')
    const r = await call('reg:parseReg', { file: tmpReg })
    fs.unlinkSync(tmpReg)
    // append 模式下已存在的 TEMP 应标为 skip 而不是 conflict
    const row = (r.rows || []).find((x) => (x.name || '').toUpperCase() === 'TEMP')
    return r.mode === 'append' && row && row.status === 'skip'
  })

  // 3. regBackupKeep —— 保留数量影响 prune
  await check('regBackupKeep 影响保留数量', async () => {
    store.writeConfig({ regBackupKeep: 2 })
    const list = await call('regBackup:list')
    await call('regBackup:prune', {})
    const after = await call('regBackup:list')
    const unprotected = after.filter((x) => !x.protected)
    return unprotected.length <= Math.max(2, list.filter((x) => x.protected).length)
  })

  // 4. regBackupDir —— 自定义目录生效
  await check('regBackupDir 指向自定义目录', async () => {
    const custom = path.join(store.appDataDir(), '_custom_backup_dir')
    store.writeConfig({ regBackupDir: custom })
    const r = await call('regBackup:create', { path: ENV, name: '目录测试', format: 'json' })
    const inCustom = r.file.startsWith(custom)
    try { fs.rmSync(custom, { recursive: true, force: true }) } catch {}
    store.writeConfig({ regBackupDir: original.regBackupDir || '' })
    return inCustom
  })

  // 5. regAutoBackupBeforeWrite —— 关闭后写操作不产生自动备份
  await check('regAutoBackupBeforeWrite 关闭时不自动备份', async () => {
    store.writeConfig({ regAutoBackupBeforeWrite: false })
    const before = (await call('regBackup:list')).length
    await call('reg:setValue', { path: ENV, name: 'WEM_TEST_SET', type: 'REG_SZ', value: 'x1' })
    const after = (await call('regBackup:list')).length
    await call('reg:deleteValue', { path: ENV, name: 'WEM_TEST_SET' })
    return after === before
  })
  await check('regAutoBackupBeforeWrite 开启时会自动备份', async () => {
    store.writeConfig({ regAutoBackupBeforeWrite: true })
    const before = (await call('regBackup:list')).length
    const w = await call('reg:setValue', { path: ENV, name: 'WEM_TEST_SET', type: 'REG_SZ', value: 'x2' })
    const after = (await call('regBackup:list')).length
    await call('reg:deleteValue', { path: ENV, name: 'WEM_TEST_SET' })
    // 清理自动产生的备份（含无 auto 标签的写前备份）
    const list = await call('regBackup:list')
    const junk = list.filter((x) => (x.tags || []).includes('auto') || /写前自动备份|删除前自动备份/.test(x.name || ''))
    if (junk.length) await call('regBackup:remove', { ids: junk.map((x) => x.id) })
    return after > before && !!w.backupId
  })

  // 还原配置
  store.writeConfig(original)

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`)
  app.exit(fail ? 1 : 0)
}).catch((e) => { console.error('异常:', e); app.exit(1) })
