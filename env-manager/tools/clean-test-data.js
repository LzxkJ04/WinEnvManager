// 清理所有测试产生的临时数据，可反复执行，幂等。
// 用法：node node_modules/electron/cli.js tools/clean-test-data.js
const { app, dialog, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const store = require('../electron/lib/store')
  const handlers = new Map()
  for (const f of ['registry', 'reg-backup', 'reg-extra']) {
    try { require(path.join(__dirname, '..', 'electron', 'ipc', f + '.js')).register((c, fn) => handlers.set(c, fn), { dialog, shell }) } catch { /* ignore */ }
  }
  const call = (ch, arg) => handlers.get(ch)({}, arg)
  const removed = []

  // 1. 注册表里以 WEM_TEST / Environment_WEM 开头的测试键
  try {
    const roots = ['HKCU']
    for (const r of roots) {
      const subs = await call('reg:subKeys', r).catch(() => [])
      for (const s of (subs || [])) {
        if (/WEM/i.test(s.name)) {
          try {
            await call('reg:deleteKey', { path: s.fullPath, recursive: true })
            removed.push(`注册表键 ${s.fullPath}`)
          } catch { /* ignore */ }
        }
      }
    }
  } catch { /* ignore */ }

  // 2. 环境变量里的 WEM_TEST_ 前缀变量
  try {
    const ENV = 'HKCU' + String.fromCharCode(92) + 'Environment'
    const vals = await call('reg:values', ENV).catch(() => ({ values: [] }))
    for (const v of (vals.values || [])) {
      if (/^WEM_TEST_/.test(v.name)) {
        try {
          await call('reg:deleteValue', { path: ENV, name: v.name })
          removed.push(`环境变量 ${v.name}`)
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }

  // 3. 测试产生的快照
  try {
    const ops = require('../electron/lib/ops')
    for (const s of ops.listSnapshots()) {
      if (/^定时快照|^adapt-|^测试/.test(s.name || '')) {
        try { ops.deleteSnapshot(s.id); removed.push(`快照 ${s.name}`) } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }

  // 4. 收藏夹：删除非内置项与自定义分组，取消内置项隐藏
  try {
    const favs = await call('regFav:list')
    for (const it of (favs.items || [])) {
      if (!it.builtin) {
        try { await call('regFav:remove', { id: it.id }); removed.push(`收藏 ${it.name}`) } catch { /* ignore */ }
      } else if (it.hidden) {
        try { await call('regFav:update', { id: it.id, hidden: false }) } catch { /* ignore */ }
      }
    }
    for (const g of (favs.groups || [])) {
      if (!g.builtin) {
        try { await call('regFav:groups', { action: 'remove', id: g.id }); removed.push(`分组 ${g.name}`) } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }

  // 5. 定时任务
  try {
    const s = await call('schedule:list')
    const ids = (s.tasks || []).map((t) => t.id)
    if (ids.length) {
      await call('schedule:remove', { ids })
      removed.push(`定时任务 ${ids.length} 个`)
    }
  } catch { /* ignore */ }

  // 6. 测试产生的注册表备份文件 + 监控日志
  try {
    const dir = path.join(store.appDataDir(), 'registryBackup')
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f)
        // watch 是监控日志目录，测试监听会写入 watch-YYYYMMDD.jsonl
        if (f === 'watch') {
          const wd = path.join(dir, 'watch')
          if (fs.existsSync(wd)) {
            for (const wf of fs.readdirSync(wd)) {
              if (!/^watch-\d+\.jsonl$/.test(wf)) continue
              try { fs.rmSync(path.join(wd, wf), { force: true }); removed.push(`监控日志 ${wf}`) } catch { /* ignore */ }
            }
          }
          continue
        }
        if (/^(ScheduleBackup|ReplaceBackup|RestoreBackup|HealthFixBackup|BAK-|测试)/.test(f)) {
          try { fs.rmSync(full, { force: true }); removed.push(`备份文件 ${f}`) } catch { /* ignore */ }
        }
      }
    }
    // 备份索引里也没有残留
    const list = await call('regBackup:list').catch(() => [])
    const junk = (list || []).filter((x) => /^(ScheduleBackup|ReplaceBackup|RestoreBackup|HealthFixBackup|BAK-|测试)|自动备份/.test(x.name || ''))
    if (junk.length) {
      await call('regBackup:remove', { ids: junk.map((x) => x.id) })
      removed.push(`备份索引 ${junk.length} 条`)
    }
  } catch { /* ignore */ }

  // 7. 配置包与健康报告临时文件
  try {
    for (const sub of ['configPack', 'health', '_io_test']) {
      const dir = path.join(store.appDataDir(), sub)
      if (!fs.existsSync(dir)) continue
      for (const f of fs.readdirSync(dir)) {
        if (/^_|^PreImport|^test-|Test\./i.test(f)) {
          try { fs.rmSync(path.join(dir, f), { recursive: true, force: true }); removed.push(`${sub}/${f}`) } catch { /* ignore */ }
        }
      }
    }
  } catch { /* ignore */ }

  console.log(removed.length ? '已清理:' : '没有需要清理的测试数据')
  removed.forEach((x) => console.log('  -', x))
  app.exit(0)
})
