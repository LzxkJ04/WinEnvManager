// 用 Electron 自身渲染页面并截图（开发期视觉校验用，不参与打包）
const { app, BrowserWindow, dialog, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const store = require('../electron/lib/store')
const { registerAll } = require('../electron/ipc')

const ROUTES = [
  ['overview', '环境变量总览'],
  ['user', '用户变量管理'],
  ['system', '系统变量管理'],
  ['path', 'PATH 路径专项管理'],
  ['devenv', '开发环境管理'],
  ['registry', '注册表管理'],
  ['registry-backup', '注册表备份'],
  ['health', '环境健康诊断'],
  ['schedules', '定时任务管理'],
  ['envsets', '环境配置集'],
  ['backup', '备份与还原'],
  ['snapshot', '变量快照 & 差异对比'],
  ['transfer', '批量导入导出'],
  ['search', '全局搜索'],
  ['audit', '变更审计面板'],
  ['toolbox', '快捷工具箱'],
  ['settings', '程序设置'],
  ['about', '关于本工具']
]

const OUT = process.env.WEM_SHOT_DIR || path.join(__dirname, '..', '.shots')

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  store.ensureAll()

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'electron', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  registerAll({ dialog, shell, getWindow: () => win })

  const indexPath = path.join(__dirname, '..', 'dist', 'index.html')
  await win.loadFile(indexPath)
  await sleep(3500)
  // 跳过首次启动向导，否则遮罩会挡住每个页面的截图
  await win.webContents.executeJavaScript(`try { localStorage.setItem('wem-wizard-done', '1') } catch (e) {}`)
  win.webContents.reload()
  await sleep(2500)
  await win.webContents.executeJavaScript(`try { localStorage.setItem('wem-wizard-done', '1') } catch (e) {}`)
  await sleep(500)
  win.showInactive()
  await sleep(600)

  const errors = []
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(message)
  })

  for (const [name] of ROUTES) {
    await win.webContents.executeJavaScript(`location.hash = '#/${name}';`)
    await sleep(1500)
    await win.webContents.capturePage() // 丢弃可能滞后的第一帧
    await sleep(350)
    const image = await win.webContents.capturePage()
    const buf = image.toPNG()
    fs.writeFileSync(path.join(OUT, `${name}.png`), buf)
    console.log(`shot: ${name} (${buf.length} bytes)`)
  }

  // 深色主题截图：改配置后重载，让主题算法真正生效
  // 注意：必须重新加载后再切换路由，否则页面不重绘、截到的是旧帧
  store.writeConfig({ theme: 'dark' })
  win.webContents.reload()
  await sleep(4000)
  for (const [name] of [['overview'], ['snapshot'], ['settings'], ['search'], ['audit']]) {
    await win.webContents.executeJavaScript(`location.hash = '#/user';`)
    await sleep(700)
    await win.webContents.executeJavaScript(`location.hash = '#/${name}';`)
    await sleep(1500)
    const img = await win.webContents.capturePage()
    const bmp = img.toBitmap()
    const i = (300 * img.getSize().width + 600) * 4
    console.log(`  dark-${name} card pixel = rgb(${bmp[i + 2]},${bmp[i + 1]},${bmp[i]})`)
    fs.writeFileSync(path.join(OUT, `dark-${name}.png`), img.toPNG())
  }
  store.writeConfig({ theme: 'light' })

  // 抓取运行时错误与关键状态
  const diag = await win.webContents.executeJavaScript(`
    (() => ({
      title: document.title,
      hasApp: !!document.querySelector('#app').children.length,
      bodyText: document.body.innerText.slice(0, 400),
      theme: document.documentElement.getAttribute('data-theme')
    }))()
  `)
  console.log('DIAG=' + JSON.stringify(diag))
  if (errors.length) console.log('CONSOLE_ERRORS=' + JSON.stringify(errors.slice(0, 20)))

  win.destroy()
  app.quit()
})

setTimeout(() => {
  console.log('TIMEOUT')
  app.exit(0)
}, 60000)
