'use strict'
/**
 * 环境变量相关 IPC
 * env:getAllEnv / env:addEnv / env:editEnv / env:deleteEnv
 * env:getPathItems / env:savePathItems / env:validatePath / env:reloadExplorer
 */
const registry = require('../lib/registry')
const store = require('../lib/store')
const ops = require('../lib/ops')
const meta = require('../lib/meta')

/** 拆分 PATH 字符串为条目数组，保留原顺序、过滤空项 */
function splitPath(value) {
  return String(value || '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

function normalizePathEntry(p) {
  const t = String(p || '').trim()
  if (t.length > 3 && (t.endsWith('\\') || t.endsWith('/'))) return t.slice(0, -1)
  return t
}

function priorValue(maps, scope, name) {
  const bag = scope === 'machine' ? maps.machine : maps.user
  if (!bag || name == null || name === '') return undefined
  if (Object.prototype.hasOwnProperty.call(bag, name)) return bag[name]
  const key = Object.keys(bag).find((item) => item.toLowerCase() === String(name).toLowerCase())
  return key == null ? undefined : bag[key]
}

/** 写入前补上原值。已存在的变量如果被标成新建，改成更新，避免失败回滚时把原变量删掉。 */
function stampOldValues(list, maps) {
  for (const item of list) {
    const prev = priorValue(maps, item.scope, item.name)
    if (item.action === 'create' && prev !== undefined) item.action = 'update'
    if (item.oldValue == null && prev !== undefined && item.action !== 'create') {
      item.oldValue = prev == null ? '' : String(prev)
    }
  }
}

function register(handle) {
  /* 1. 读取全部环境变量 */
  handle('env:getAllEnv', async () => {
    const data = await registry.readAllEnv()
    const admin = await registry.isAdmin().catch(() => false)
    return { ...data, admin, readAt: Date.now() }
  })

  /* 2. 新增环境变量 */
  handle('env:addEnv', async (event, payload) => {
    const { name, value, scope } = payload || {}
    const check = registry.validateName(name)
    if (!check.ok) throw new Error(check.message)
    const exists =
      scope === 'machine'
        ? (await registry.readScope('machine')).some((v) => v.name.toUpperCase() === String(name).toUpperCase())
        : (await registry.readScope('user')).some((v) => v.name.toUpperCase() === String(name).toUpperCase())
    if (exists) throw new Error(`变量 ${name} 在当前作用域下已存在`)
    await registry.writeValue(scope, name, value ?? '')
    store.writeLog('info', `新增${scope === 'machine' ? '系统' : '用户'}变量`, { name, value })
    return true
  })

  /* 3. 修改已存在环境变量 */
  handle('env:editEnv', async (event, payload) => {
    const { name, value, scope, newName } = payload || {}
    if (newName && newName !== name) {
      const check = registry.validateName(newName)
      if (!check.ok) throw new Error(check.message)
      await registry.writeValue(scope, newName, value ?? '')
      await registry.deleteValue(scope, name)
      store.writeLog('info', `重命名变量 ${name} -> ${newName}`, { scope })
    } else {
      await registry.writeValue(scope, name, value ?? '')
      store.writeLog('info', `修改变量 ${name}`, { scope })
    }
    return true
  })

  /* 4. 删除环境变量 */
  handle('env:deleteEnv', async (event, payload) => {
    const items = Array.isArray(payload) ? payload : [payload]
    const results = []
    for (const item of items) {
      try {
        await registry.deleteValue(item.scope, item.name)
        results.push({ name: item.name, ok: true })
      } catch (err) {
        results.push({ name: item.name, ok: false, message: err.message })
      }
    }
    store.writeLog('warn', '删除环境变量', results)
    const failed = results.filter((r) => !r.ok)
    if (failed.length === results.length && failed.length > 0) {
      throw new Error(failed[0].message)
    }
    return results
  })

  /* 5. 批量写入系统（保存前端待修改内容） */
  handle('env:applyChanges', async (event, changes) => {
    const list = Array.isArray(changes) ? changes : []
    if (list.length === 0) return { results: [], needRestartExplorer: false }

    // 写入前校验名称合法性
    for (const item of list) {
      const target = item.action === 'rename' ? item.newName : item.name
      const check = registry.validateName(target)
      if (!check.ok) throw new Error(`${item.name}：${check.message}`)
    }

    // 写入前自动快照 / 自动备份（由设置页开关控制）
    const cfg = store.readConfig()
    const before = await ops.captureEnvDetailed()
    stampOldValues(list, ops.detailedToMaps(before))
    if (cfg.autoSnapshot) {
      try {
        await ops.createSnapshotV2({ name: '写入前自动快照', note: '系统写入前自动生成', auto: true }, before)
        ops.pruneSnapshots(cfg.snapshotMax)
      } catch (_) { /* 快照失败不阻断主流程 */ }
    }
    if (cfg.autoBackup) {
      try {
        await ops.createBackupV2({
          format: cfg.autoBackupFormat || 'json',
          prefix: 'AutoBackup',
          env: before,
          backupType: 'increment',
          password: cfg.backupPassword || ''
        })
        ops.pruneBackups(cfg.backupKeep)
      } catch (_) { /* 备份失败不阻断主流程 */ }
    }

    const results = await registry.applyChanges(list)
    // 广播环境变更，让新进程立即读取到最新值
    await registry.broadcastChange().catch(() => false)
    store.writeLog('info', '写入系统环境变量', results)

    // 事务模型（规格底层能力 3）：任一项写入失败，立即反向回滚已成功项，系统环境保持原状
    const failedIdx = results.findIndex((r) => !r.ok)
    if (failedIdx >= 0) {
      const failed = results[failedIdx]
      const okItems = list.filter((item, idx) => results[idx] && results[idx].ok)
      const rollbacks = registry.buildRollbackList(list, results)
      const rbResults = await registry.applyChanges(rollbacks).catch(() => [])
      const rbFailed = rbResults.filter((r) => !r.ok).length
      await registry.broadcastChange().catch(() => false)
      store.writeLog('error', '批量写入失败，已执行事务回滚', {
        failed: failed.name,
        rolledBack: okItems.length - rbFailed,
        rollbackFailed: rbFailed
      })
      store.appendAudit({
        origin: 'GUI',
        action: 'applyChangesRolledBack',
        count: okItems.length,
        items: okItems.map((i) => ({ name: i.name, scope: i.scope, ok: true, before: i.value ?? '', after: i.oldValue ?? '' }))
      })
      throw new Error(
        `「${failed.name}」写入失败：${failed.message}。` +
        `已回滚 ${okItems.length - rbFailed} 项变更，系统环境保持原状。` +
        (rbFailed ? `另有 ${rbFailed} 项回滚未成功，请用备份恢复。` : '')
      )
    }

    // 记录变更历史与元数据
    for (const item of list) {
      if (item.action === 'delete') {
        meta.removeVar(item.scope, item.name)
        meta.pushHistory(item.scope, item.name, 'delete', '', item.value)
      } else {
        const name = item.action === 'rename' ? item.newName : item.name
        meta.setVar(item.scope, name, { updatedAt: Date.now() })
        meta.pushHistory(item.scope, name, item.action, item.value, item.oldValue)
      }
    }

    const touchedSystemPath = list.some(
      (i) => i.scope === 'machine' && String(i.action === 'rename' ? i.newName : i.name).toUpperCase() === 'PATH'
    )
    // 审计日志：独立 JSONL，软件内只读；时间 / 来源 / 前后值
    store.appendAudit({
      origin: 'GUI',
      action: 'applyChanges',
      count: results.filter((r) => r.ok).length,
      items: results.map((r) => ({
        name: r.name, scope: r.scope, ok: r.ok,
        before: (list.find((i) => i.name === r.name) || {}).oldValue ?? '',
        after: (list.find((i) => i.name === r.name) || {}).value ?? ''
      }))
    })
    return { results, needRestartExplorer: list.some((i) => i.scope === 'machine') || touchedSystemPath }
  })

  /* 6. PATH 条目读取 */
  handle('env:getPathItems', async () => {
    const [user, machine] = await Promise.all([registry.readScope('user'), registry.readScope('machine')])
    const pick = (list) => {
      const hit = list.find((v) => v.name.toUpperCase() === 'PATH')
      return hit ? hit.value : ''
    }
    return {
      user: splitPath(pick(user)).map((p, i) => ({ id: `u-${i}`, path: p, scope: 'user' })),
      machine: splitPath(pick(machine)).map((p, i) => ({ id: `m-${i}`, path: p, scope: 'machine' }))
    }
  })

  /* 7. 保存 PATH 条目列表 */
  handle('env:savePathItems', async (event, payload) => {
    const { scope, items } = payload || {}
    const list = Array.isArray(items) ? items : []
    const value = list
      .map((i) => normalizePathEntry(typeof i === 'string' ? i : i.path))
      .filter((p) => p !== '')
      .join(';')
    if (value.length > 2047 && scope === 'machine') {
      // 系统 PATH 过长时给出提示（注册表 Path 建议不超过 2047 字符）
      store.writeLog('warn', '系统 PATH 长度接近或超过建议上限', value.length)
    }
    await registry.writeValue(scope, 'Path', value)
    await registry.broadcastChange().catch(() => false)
    store.writeLog('info', `保存${scope === 'machine' ? '系统' : '用户'} PATH`, { count: list.length, length: value.length })
    return { value, length: value.length }
  })

  /* 8. 批量校验路径是否存在（含网络盘 / 可移动磁盘 / 忽略列表选项） */
  handle('env:validatePath', async (event, payload) => {
    const list = Array.isArray(payload) ? payload : []
    const result = await registry.classifyPaths(list, { config: store.readConfig() })
    const invalid = result.filter((r) => !r.exists && r.type !== 'network-skipped' && r.type !== 'removable-skipped').map((r) => r.path)
    return { result, invalid }
  })

  /* 9. 重启资源管理器 */
  handle('env:reloadExplorer', async () => {
    const ok = await registry.reloadExplorer()
    store.writeLog('warn', '重启资源管理器以刷新环境变量')
    return ok
  })

  /* 额外：解析 %VAR% 字符串 */
  handle('env:expandString', async (event, text) => {
    return registry.expandString(String(text || ''))
  })

  /* 额外：单独落盘一个变量（编辑面板“立即应用”用） */
  handle('env:writeOne', async (event, payload) => {
    const { name, value, scope } = payload || {}
    const check = registry.validateName(name)
    if (!check.ok) throw new Error(check.message)
    await registry.writeValue(scope, name, value ?? '')
    return true
  })

  /* 额外：权限查询 */
  handle('env:isAdmin', async () => registry.isAdmin())

  /* 额外：读取含元数据的完整环境（总览页展示备注/锁定/来源用） */
  handle('env:getDetailed', async () => {
    const detailed = await ops.captureEnvDetailed()
    const admin = await registry.isAdmin().catch(() => false)
    return { ...detailed, admin, readAt: Date.now() }
  })

  /* 额外：PATHEXT 合法性校验 */
  handle('env:validatePathext', async (e, value) => {
    const entries = String(value || '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
    const validRe = /^\.[A-Za-z0-9]{1,8}$/
    const invalid = entries.filter((x) => !validRe.test(x))
    const dup = entries.filter((x, i) => entries.findIndex((y) => y.toLowerCase() === x.toLowerCase()) !== i)
    return {
      entries,
      invalid,
      duplicate: [...new Set(dup)],
      valid: invalid.length === 0 && dup.length === 0
    }
  })
}

module.exports = { register }
