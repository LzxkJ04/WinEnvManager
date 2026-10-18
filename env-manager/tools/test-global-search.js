// 验证全局搜索：新数据源渲染 + 实际能检索到收藏夹与定时任务
const { app, BrowserWindow, dialog, shell } = require('electron')
const path = require('node:path')
const store = require('../electron/lib/store')
const { registerAll } = require('../electron/ipc')

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  store.ensureAll()
  const win = new BrowserWindow({
    width: 1280, height: 800, show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'electron', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  })
  registerAll({ dialog, shell, getWindow: () => win })

  let pass = 0, fail = 0
  const check = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ', name) }
    else { fail++; console.log('FAIL ', name, extra || '') }
  }

  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  await new Promise((r) => setTimeout(r, 3000))
  await win.webContents.executeJavaScript(`try{localStorage.setItem('wem-wizard-done','1')}catch(e){}`)

  const prep = await win.webContents.executeJavaScript(`(async () => {
    const out = {}
    const f = await window.envAPI.regFav.create({ name: 'ZZ搜索测试收藏', path: 'HKCU' + String.fromCharCode(92) + 'Software', groupId: 'sys' })
    out.fav = f.ok ? f.data.id : ''
    const s = await window.envAPI.schedule.create({
      name: 'ZZ搜索测试任务', type: 'snapshot', schedule: { frequency: 'daily', time: '05:00' }
    })
    out.sched = s.ok && s.data ? (s.data.id || (s.data.task && s.data.task.id)) : ''
    return out
  })()`)
  console.log('准备:', JSON.stringify(prep))

  // 1. 数据源勾选框渲染（需展开浮层）
  await win.webContents.executeJavaScript(`(() => {
    const btns = [...document.querySelectorAll('.gsb-bar button')]
    const hit = btns.find(b => (b.textContent || '').includes('搜索范围'))
    if (hit) hit.click()
  })()`)
  await new Promise((r) => setTimeout(r, 800))
  const labels = await win.webContents.executeJavaScript(`(() => {
    const host = document.querySelector('.gsb-sources')
    return host ? [...host.querySelectorAll('.ant-checkbox-wrapper')].map(e => (e.textContent || '').trim()) : []
  })()`)
  console.log('搜索源:', JSON.stringify(labels))
  check('搜索源含「注册表收藏」', labels.includes('注册表收藏'), JSON.stringify(labels))
  check('搜索源含「定时任务」', labels.includes('定时任务'), JSON.stringify(labels))

  // 2. 实际检索收藏夹
  const favHit = await win.webContents.executeJavaScript(`(async () => {
    const r = await window.envAPI.regFav.list()
    const items = (r.ok && r.data && r.data.items) || []
    return items.filter(i => i.name.includes('ZZ搜索测试')).map(i => i.name)
  })()`)
  check('收藏夹可被检索到', favHit.length > 0, JSON.stringify(favHit))

  // 3. 实际检索定时任务
  const schedHit = await win.webContents.executeJavaScript(`(async () => {
    const r = await window.envAPI.schedule.list()
    const items = (r.ok && r.data && r.data.tasks) || []
    return items.filter(i => i.name.includes('ZZ搜索测试')).map(i => i.name)
  })()`)
  check('定时任务可被检索到', schedHit.length > 0, JSON.stringify(schedHit))

  // 清理
  await win.webContents.executeJavaScript(`(async () => {
    try {
      const favs = await window.envAPI.regFav.list()
      const hits = (favs.data.items || []).filter(i => i.name.includes('ZZ搜索测试'))
      for (const h of hits) await window.envAPI.regFav.remove({ id: h.id })
    } catch (e) {}
    try {
      const s = await window.envAPI.schedule.list()
      const ids = (s.data.tasks || []).filter(t => t.name.includes('ZZ搜索测试')).map(t => t.id)
      if (ids.length) await window.envAPI.schedule.remove({ ids })
    } catch (e) {}
  })()`)

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`)
  app.exit(fail ? 1 : 0)
}).catch((e) => { console.error(e); app.exit(1) })
