'use strict'
/**
 * 快照与差异对比 IPC
 * snapshot:create / snapshot:list / snapshot:compare
 */
const ops = require('../lib/ops')
const store = require('../lib/store')
const registry = require('../lib/registry')
const fs = require('node:fs')
const path = require('node:path')

function archiveStampName(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function register(handle) {
  /* 1. 创建快照 */
  handle('snapshot:create', async (event, payload) => {
    const snap = await ops.createSnapshotV2(payload || {})
    const cfg = store.readConfig()
    ops.pruneSnapshots(cfg.snapshotMax)
    return snap
  })

  /* 2. 快照列表 */
  handle('snapshot:list', async () => ops.listSnapshots())

  /* 2.1 快照保护标记：受保护快照不参与自动清理 */
  handle('snapshot:setProtected', async (event, p) => ops.setSnapshotProtected(p.id, p.protected))

  /* 2.2 自动清理预览：列出将被清理的快照，不执行删除 */
  handle('snapshot:previewPrune', async () => ops.previewPruneSnapshots(store.readConfig().snapshotMax))

  /* 2.3 多选快照打包归档 */
  handle('snapshot:archive', async (event, ids) => {
    const list = (Array.isArray(ids) ? ids : []).map((id) => ops.readSnapshotAny(id)).filter(Boolean)
    if (!list.length) throw new Error('未选择快照')
    const stamp = ops.archiveStampName()
    const target = path.join(store.snapshotDir(), `archive-${stamp}.json`)
    const payload = {
      kind: 'win-env-manager-snapshot-archive',
      version: 1,
      createdAt: Date.now(),
      createdAtText: new Date().toLocaleString('zh-CN'),
      snapshots: list
    }
    fs.writeFileSync(target, JSON.stringify(payload, null, 2), 'utf8')
    store.writeLog('info', '快照打包归档', { file: target, count: list.length })
    return { file: target, count: list.length, size: fs.statSync(target).size }
  })

  /* 3. 读取单个快照详情 */
  handle('snapshot:get', async (event, id) => {
    if (id && typeof id === 'object') return ops.readSnapshotAny(id.id || id.snapshotId, { skipHash: id.skipHash === true })
    return ops.readSnapshotAny(id)
  })

  /* 3.1 基线快照标记 */
  handle('snapshot:setBaseline', async (event, id) => {
    const previous = store.readConfig().baselineSnapshotId || ''
    store.writeConfig({ baselineSnapshotId: id })
    return { baselineSnapshotId: id, previous }
  })

  handle('snapshot:getBaseline', async () => store.readConfig().baselineSnapshotId || '')

  /* 4. 删除快照 */
  handle('snapshot:delete', async (event, id) => ops.deleteSnapshot(id))

  /* 5. 差异对比
   *    payload = { mode:'current', snapshotId }       当前环境 VS 快照
   *    payload = { mode:'two', leftId, rightId }      快照A VS 快照B
   *    payload = { left, right }                      直接传入数据
   */
  handle('snapshot:compare', async (event, payload) => {
    const p = payload || {}
    let left
    let right

    if (p.left && p.right) {
      left = p.left
      right = p.right
    } else if (p.mode === 'two') {
      const a = ops.readSnapshot(p.leftId)
      const b = ops.readSnapshot(p.rightId)
      left = { user: a.user, machine: a.machine }
      right = { user: b.user, machine: b.machine }
    } else if (p.snapshotId) {
      const s = ops.readSnapshot(p.snapshotId)
      left = { user: s.user, machine: s.machine }
      right = await ops.captureEnv()
    } else {
      throw new Error('缺少对比参数')
    }

    return {
      ...ops.compareEnv({ left, right }),
      leftLabel: p.leftLabel || (p.mode === 'two' ? p.leftId : p.snapshotId) || '快照',
      rightLabel: p.rightLabel || (p.mode === 'two' ? p.rightId : '当前环境'),
      comparedAt: Date.now()
    }
  })

  /* 6. 选择性恢复：返回勾选项的写回清单 */
  handle('snapshot:prepareRestore', async (event, payload) => {
    const { snapshotId, items } = payload || {}
    const snap = ops.readSnapshotAny(snapshotId, { skipHash: payload && payload.skipHash === true })
    const current = await ops.captureEnv()
    return {
      plan: buildRestorePlan(snap, current, items),
      checksum: snap.checksum || { ok: true, legacy: true, reason: '旧快照没有校验和' }
    }
  })

  /* 7. 校验后恢复。先写一份受保护的临时快照；任一项失败则反向回滚，回滚不全时再按临时快照补写。 */
  handle('snapshot:restore', async (event, payload) => {
    const { snapshotId, items, skipHash } = payload || {}
    const snap = ops.readSnapshotAny(snapshotId, { skipHash: skipHash === true })
    const currentDetailed = await ops.captureEnvDetailed()
    const current = ops.detailedToMaps(currentDetailed)
    const plan = buildRestorePlan(snap, current, items)
    if (!plan.length) throw new Error('没有可恢复的变量')
    for (const item of plan) {
      const check = registry.validateName(item.name)
      if (!check.ok) throw new Error(`${item.name}：${check.message}`)
    }

    const rollback = await ops.createSnapshotV2({
      name: '恢复前临时快照',
      note: `恢复「${snap.name || snapshotId}」前自动生成，失败时用于回滚`,
      auto: true,
      protected: true
    }, currentDetailed)
    ops.pruneSnapshots(store.readConfig().snapshotMax)

    const results = await registry.applyChanges(plan)
    const failedIdx = results.findIndex((item) => !item.ok)
    if (failedIdx >= 0) {
      const failed = results[failedIdx]
      const rollbacks = registry.buildRollbackList(plan, results)
      const rbResults = await registry.applyChanges(rollbacks).catch(() => [])
      const rbFailed = rollbacks.filter((item, index) => rbResults[index] && !rbResults[index].ok)
      if (rbFailed.length) {
        const rescue = rbFailed.map((item) => rescueFromSnapshot(rollback, item))
        await registry.applyChanges(rescue).catch(() => [])
      }
      await registry.broadcastChange().catch(() => false)
      store.appendAudit({
        origin: 'GUI',
        action: 'snapshotRestoreRolledBack',
        count: plan.length,
        items: plan.map((item) => ({ name: item.name, scope: item.scope, ok: false, before: item.oldValue ?? '', after: item.value ?? '' }))
      })
      store.writeLog('error', '快照恢复失败，已按临时快照回滚', { snapshotId, rollbackId: rollback.id, failed: failed.name })
      throw new Error(
        `「${failed.name}」恢复失败：${failed.message || '写入失败'}。` +
        `已用恢复前临时快照回滚，临时快照仍保留：${rollback.name}。`
      )
    }

    await registry.broadcastChange().catch(() => false)
    try { ops.deleteSnapshot(rollback.id) } catch (_) { /* 成功后临时快照删不掉也不影响结果 */ }
    store.appendAudit({
      origin: 'GUI',
      action: 'snapshotRestore',
      count: results.length,
      items: results.map((item, index) => ({
        name: item.name,
        scope: plan[index] && plan[index].scope,
        ok: item.ok,
        before: plan[index] && plan[index].oldValue != null ? plan[index].oldValue : '',
        after: plan[index] && plan[index].value != null ? plan[index].value : ''
      }))
    })
    store.writeLog('info', '快照恢复完成', { snapshotId, count: plan.length, verified: !(snap.checksum && snap.checksum.legacy) })
    return {
      count: plan.length,
      rollbackId: '',
      verified: !(snap.checksum && snap.checksum.legacy),
      legacy: !!(snap.checksum && snap.checksum.legacy),
      reason: snap.checksum ? snap.checksum.reason : '校验通过'
    }
  })
}

function buildRestorePlan(snap, current, items) {
  const plan = []
  for (const it of items || []) {
    const scope = it.scope === 'machine' ? 'machine' : 'user'
    const name = it.name == null ? '' : String(it.name)
    if (!name) continue
    const snapMap = snap[scope] || {}
    const curMap = (current && current[scope]) || {}
    const inSnap = Object.prototype.hasOwnProperty.call(snapMap, name)
    const inCur = Object.prototype.hasOwnProperty.call(curMap, name)
    if (inSnap) {
      plan.push({
        action: inCur ? 'update' : 'create',
        scope,
        name,
        value: snapMap[name] == null ? '' : String(snapMap[name]),
        oldValue: inCur ? String(curMap[name] ?? '') : ''
      })
    } else if (inCur) {
      plan.push({ action: 'delete', scope, name, value: '', oldValue: String(curMap[name] ?? '') })
    }
  }
  return plan
}

function rescueFromSnapshot(rollback, failed) {
  const scope = failed.scope === 'machine' ? 'machine' : 'user'
  const map = scope === 'machine' ? rollback.machine : rollback.user
  if (map && Object.prototype.hasOwnProperty.call(map, failed.name)) {
    return { action: 'update', scope, name: failed.name, value: map[failed.name] == null ? '' : String(map[failed.name]) }
  }
  return { action: 'delete', scope, name: failed.name }
}

module.exports = { register }
