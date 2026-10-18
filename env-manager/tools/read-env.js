// 快速读取当前用户/系统环境变量（诊断用）
const { app } = require('electron')
const path = require('node:path')
const registry = require('../electron/lib/registry')

app.whenReady().then(async () => {
  const user = await registry.readScope('user')
  const machine = await registry.readScope('machine')
  console.log('=== USER ===')
  for (const v of user) console.log(`${v.name} = ${v.value}`)
  console.log('=== MACHINE (仅 C:\\tools 与系统关键项) ===')
  for (const v of machine) {
    if (/^(Path|ComSpec|OS|PATHEXT|windir|NUMBER_OF_PROCESSORS)$/i.test(v.name)) {
      console.log(`${v.name} = ${v.value}`)
    }
  }
  app.exit(0)
})

setTimeout(() => app.exit(0), 30000)
