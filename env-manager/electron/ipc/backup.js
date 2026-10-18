'use strict'
/**
 * 备份与还原 IPC
 * backup:export / backup:import
 */
const fs = require('node:fs')
const path = require('node:path')
const ops = require('../lib/ops')
const store = require('../lib/store')

const FORMAT_FILTERS = {
  reg: [{ name: '注册表文件', extensions: ['reg'] }],
  json: [{ name: 'JSON 备份', extensions: ['json'] }],
  txt: [{ name: '文本文件', extensions: ['txt'] }],
  all: [{ name: '所有支持的备份', extensions: ['reg', 'json', 'txt'] }]
}

const TAGS_FILE_NAME = '.tags.json'

function tagsFile() {
  return require('node:path').join(store.resolvedBackupDir(), TAGS_FILE_NAME)
}

function readTags() {
  try {
    const f = tagsFile()
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch (_) { /* ignore */ }
  return {}
}

function writeTags(obj) {
  fs.writeFileSync(tagsFile(), JSON.stringify(obj, null, 2), 'utf8')
  return obj
}

function register(handle, ctx) {
  /* 1. 导出备份 */
  handle('backup:export', async (event, payload) => {
    const p = payload || {}
    const format = ['reg', 'json', 'txt'].includes(p.format) ? p.format : 'json'

    if (p.targetPath) {
      return ops.createBackup({ format, targetPath: p.targetPath })
    }
    // 静默模式（自动备份）不弹框
    if (p.silent) {
      return ops.createBackup({ format, silent: true, prefix: p.prefix || 'AutoBackup' })
    }
    const dir = store.resolvedBackupDir()
    const suggested = path.join(dir, ops.backupFileName(format))
    const res = await ctx.dialog.showSaveDialog(ctx.getWindow(), {
      title: '导出环境变量备份',
      defaultPath: suggested,
      filters: FORMAT_FILTERS[format] || FORMAT_FILTERS.all
    })
    if (res.canceled || !res.filePath) return { canceled: true }
    return ops.createBackup({ format, targetPath: res.filePath })
  })

  /* 2. 导入备份 —— 解析并预览所有变更项 */
  handle('backup:import', async (event, payload) => {
    const p = payload || {}
    let file = p.file
    if (!file) {
      const res = await ctx.dialog.showOpenDialog(ctx.getWindow(), {
        title: '选择备份文件',
        properties: ['openFile'],
        filters: FORMAT_FILTERS.all
      })
      if (res.canceled || !res.filePaths.length) return { canceled: true }
      file = res.filePaths[0]
    }
    const preview = await ops.importPreview({ file, defaultScope: p.defaultScope })
    store.writeLog('info', '导入备份预览', { file, total: preview.total })
    return preview
  })

  /* 3. 备份文件管理 */
  handle('backup:list', async () => {
    const cfg = store.readConfig()
    const tags = readTags()
    const files = ops.listBackups().map((f) => ({
      ...f,
      tag: tags[f.name] || '',
      meta: tags[f.name] ? tags[f.name].meta || {} : {},
      note: tags[f.name] ? tags[f.name].note || '' : ''
    }))
    return { dir: store.resolvedBackupDir(), files, config: cfg }
  })

  handle('backup:delete', async (e, file) => ops.deleteBackup(file))

  handle('backup:setTag', async (e, p) => {
    const tags = readTags()
    const key = require('node:path').basename(p.file)
    tags[key] = { ...(tags[key] || {}), tag: p.tag || '', note: p.note || '' }
    writeTags(tags)
    return tags[key]
  })

  handle('backup:prune', async (e, max) => ops.pruneBackups(max))

  handle('backup:openDir', async (event, dir) => {
    const target = dir && dir.trim() ? dir : store.resolvedBackupDir()
    if (!fs.existsSync(target)) store.ensureDir(target)
    await ctx.shell.openPath(target)
    return target
  })

  /** 导出备份到远端目录（本地网络共享路径） */
  handle('backup:copyToRemote', async (e, p) => {
    const { file, remoteDir } = p || {}
    if (!file || !fs.existsSync(file)) throw new Error('源备份文件不存在')
    if (!remoteDir) throw new Error('未配置远端目录')
    if (!fs.existsSync(remoteDir)) throw new Error(`远端目录不可访问：${remoteDir}`)
    const dest = require('node:path').join(remoteDir, require('node:path').basename(file))
    fs.copyFileSync(file, dest)
    store.writeLog('info', '备份已同步到远端目录', dest)
    return { dest }
  })

  /* 4. 读取备份文件的可读文本（预览用） */
  handle('backup:readText', async (event, file) => {
    if (!file || !fs.existsSync(file)) throw new Error('备份文件不存在')
    const buf = fs.readFileSync(file)
    if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le').replace(/^\uFEFF/, '')
    return buf.toString('utf8').replace(/^\uFEFF/, '')
  })

  /* 5. 解析任意变量文本（自动识别 JSON / REG / TXT），供批量导入使用 */
  handle('backup:parseText', async (event, text) => {
    const entries = ops.parseTextContent(String(text == null ? '' : text))
    return { total: entries.length, entries }
  })

  /* 6. v2 备份：加密 / 增量 / 备注 / 校验值 */
  handle('backup:exportV2', async (e, p) => {
    const payload = p || {}
    if (payload.targetPath) {
      return ops.createBackupV2(payload)
    }
    if (payload.silent) {
      return ops.createBackupV2({ ...payload, prefix: payload.prefix || 'Backup' })
    }
    const dir = store.resolvedBackupDir()
    const format = payload.format || 'json'
    const res = await ctx.dialog.showSaveDialog(ctx.getWindow(), {
      title: '导出环境变量备份',
      defaultPath: path.join(dir, ops.backupFileName(format, payload.prefix || 'Backup')),
      filters: FORMAT_FILTERS[format] || FORMAT_FILTERS.all
    })
    if (res.canceled || !res.filePath) return { canceled: true }
    return ops.createBackupV2({ ...payload, targetPath: res.filePath })
  })

  /** 读取 v2 备份（自动解密 + 校验和校验） */
  handle('backup:readV2', async (e, p) => {
    const { file, password } = p || {}
    const info = ops.readBackupAny(file, password)
    return {
      meta: info.meta,
      entries: info.entries,
      checksumOk: info.checksumOk,
      encrypted: ops.isEncrypted(fs.readFileSync(file, 'utf8')),
      total: info.entries.length
    }
  })
}

module.exports = { register }
