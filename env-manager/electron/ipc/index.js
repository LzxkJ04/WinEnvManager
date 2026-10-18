'use strict'
const { ipcMain } = require('electron')

/**
 * 统一 IPC 注册：所有处理器返回 { ok, data } 或 { ok:false, message }
 * 渲染进程永远不会因为主进程异常而崩溃。
 */
const wrapped = new Set()

function handle(channel, fn) {
  if (wrapped.has(channel)) return
  wrapped.add(channel)
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      const data = await fn(event, ...args)
      return { ok: true, data }
    } catch (err) {
      return { ok: false, message: (err && err.message) || String(err) }
    }
  })
}

function registerAll(ctx) {
  require('./env').register(handle, ctx)
  require('./snapshot').register(handle, ctx)
  require('./backup').register(handle, ctx)
  require('./tool').register(handle, ctx)
  require('./system').register(handle, ctx)
  require('./devenv').register(handle, ctx)
  require('./envset').register(handle, ctx)
  require('./analyze').register(handle, ctx)
  require('./tableprefs').register(handle, ctx)
  require('./projectenv').register(handle, ctx)
}

module.exports = { registerAll, handle }
