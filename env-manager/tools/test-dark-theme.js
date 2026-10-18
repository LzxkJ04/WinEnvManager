// 深色主题下四个新页面的配色与可读性检测
const { app, BrowserWindow, dialog, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const store = require('../electron/lib/store')
const { registerAll } = require('../electron/ipc')

const ROUTES = ['registry', 'registry-backup', 'health', 'schedules']
const OUT = path.resolve(__dirname, '..', '.shots')

app.disableHardwareAcceleration()

/** 采样页面内元素的背景与文字颜色，判断深色下是否可读 */
const PROBE = `(() => {
  const out = []
  const pick = (el) => {
    if (!el) return null
    const cs = getComputedStyle(el)
    return {
      bg: cs.backgroundColor,
      color: cs.color,
      text: (el.textContent || '').trim().slice(0, 24)
    }
  }
  const card = document.querySelector('.wem-card, .ant-card, .ant-table')
  out.push({ what: 'card', ...pick(card) })
  const title = document.querySelector('.wem-card-title, .ant-card-head-title, h1, h2')
  out.push({ what: 'title', ...pick(title) })
  const btn = document.querySelector('.ant-btn')
  out.push({ what: 'button', ...pick(btn) })
  const cell = document.querySelector('.ant-table-cell, .wem-table td')
  out.push({ what: 'cell', ...pick(cell) })
  const body = document.body
  out.push({ what: 'body', ...pick(body) })
  return out
})()`

function luminance(rgb) {
  const m = String(rgb).match(/(\d+),\s*(\d+),\s*(\d+)/)
  if (!m) return null
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

app.whenReady().then(async () => {
  store.ensureAll()
  fs.mkdirSync(OUT, { recursive: true })
  const win = new BrowserWindow({
    width: 1280, height: 800, show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'electron', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  })
  registerAll({ dialog, shell, getWindow: () => win })

  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  await new Promise((r) => setTimeout(r, 3000))
  await win.webContents.executeJavaScript(`try{localStorage.setItem('wem-wizard-done','1')}catch(e){}`)

  // 切深色并重载，让 antd 算法真正生效
  store.writeConfig({ theme: 'dark' })
  win.webContents.reload()
  await new Promise((r) => setTimeout(r, 3500))

  let problems = 0
  for (const name of ROUTES) {
    await win.webContents.executeJavaScript(`location.hash = '#/user';`)
    await new Promise((r) => setTimeout(r, 600))
    await win.webContents.executeJavaScript(`location.hash = '#/${name}';`)
    await new Promise((r) => setTimeout(r, 1600))

    const probe = await win.webContents.executeJavaScript(PROBE)
    const img = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT, `dark-${name}.png`), img.toPNG())

    console.log(`\n[${name}]`)
    for (const p of probe) {
      if (!p || !p.bg) continue
      const lb = luminance(p.bg)
      const lc = luminance(p.color)
      if (lb == null || lc == null) continue
      // 深色主题要求：背景暗、文字亮，对比不足则判为问题
      const lowContrast = Math.abs(lb - lc) < 60
      const lightBg = lb > 160
      const flag = lowContrast || lightBg
      if (flag) problems++
      console.log(`  ${flag ? '!!' : 'ok'} ${p.what.padEnd(7)} bg=${p.bg} color=${p.color} L=${lb.toFixed(0)}/${lc.toFixed(0)}`)
    }
  }

  console.log(`\n深色主题异常项: ${problems}`)
  store.writeConfig({ theme: 'light' })
  app.exit(0)
}).catch((e) => { console.error(e); app.exit(1) })
