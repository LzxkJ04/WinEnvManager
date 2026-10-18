'use strict'
/**
 * 表格布局偏好：整包读写 config/table_layout.json
 * table:load / table:save
 */
const fs = require('node:fs')
const path = require('node:path')
const store = require('../lib/store')

function layoutFile() {
  return path.join(store.appDataDir(), 'config', 'table_layout.json')
}

function emptyLayout() {
  return { tables: {}, formats: {}, presets: {}, settings: {} }
}

function asObject(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  return v
}

function readLayout() {
  const file = layoutFile()
  if (!fs.existsSync(file)) return emptyLayout()
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  return {
    tables: asObject(data && data.tables),
    formats: asObject(data && data.formats),
    presets: asObject(data && data.presets),
    settings: asObject(data && data.settings)
  }
}

function register(handle, ctx) {
  void ctx

  handle('table:load', async () => readLayout())

  handle('table:save', async (_e, payload) => {
    const p = payload || {}
    const dir = path.join(store.appDataDir(), 'config')
    store.ensureDir(dir)
    const body = {
      tables: asObject(p.tables),
      formats: asObject(p.formats),
      presets: asObject(p.presets),
      settings: asObject(p.settings)
    }
    fs.writeFileSync(layoutFile(), JSON.stringify(body, null, 2), 'utf8')
    return { saved: true }
  })
}

module.exports = { register }
