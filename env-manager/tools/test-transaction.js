// 事务回滚实测：create 成功 + delete 不存在变量失败 → 系统应恢复原状
'use strict'
const registry = require('../electron/lib/registry')

async function main() {
  const T = 'WEM_TX_TEST'
  // 前置清理
  await registry.applyChanges([{ action: 'delete', scope: 'user', name: T }]).catch(() => [])

  const list = [
    { action: 'create', scope: 'user', name: T, value: 'v1', oldValue: '' },
    // 注入失败：删除不存在的变量 → Remove-ItemProperty 抛错
    { action: 'delete', scope: 'user', name: 'WEM_TX_NOT_EXISTS__', value: '', oldValue: '' }
  ]
  const results = await registry.applyChanges(list)
  const failed = results.filter((r) => !r.ok)
  console.log(`step1: ok=${results.filter((r) => r.ok).length} fail=${failed.length}`)

  const rollbacks = registry.buildRollbackList(list, results)
  console.log(`step2: rollback items=${rollbacks.length} -> ${JSON.stringify(rollbacks)}`)
  const rb = await registry.applyChanges(rollbacks)
  const rbFail = rb.filter((r) => !r.ok)
  console.log(`step3: rollback ok=${rb.filter((r) => r.ok).length} fail=${rbFail.length}`)

  // 验证系统已恢复原状：WEM_TX_TEST 应不存在
  const env = await registry.readScope('user')
  const gone = !env.some((v) => v.name.toUpperCase() === T)
  if (!gone) throw new Error(`${T} 仍存在，回滚失败`)
  console.log('PASS 事务回滚：系统环境已恢复原状')

  // 顺便验证 buildRollbackList 的分支映射
  const mk = registry.buildRollbackList(
    [
      { action: 'create', scope: 'user', name: 'A', value: '1' },
      { action: 'update', scope: 'user', name: 'B', value: '2', oldValue: 'old-b' },
      { action: 'rename', scope: 'user', name: 'C', newName: 'C2', value: '3', oldValue: 'old-c' },
      { action: 'delete', scope: 'user', name: 'D', oldValue: 'old-d' }
    ],
    [{ ok: true }, { ok: true }, { ok: true }, { ok: true }]
  )
  const expect = [
    { action: 'delete', scope: 'user', name: 'A' },
    { action: 'update', scope: 'user', name: 'B', value: 'old-b' },
    { action: 'rename', scope: 'user', name: 'C2', newName: 'C', value: 'old-c' },
    { action: 'update', scope: 'user', name: 'D', value: 'old-d' }
  ]
  const same = JSON.stringify(mk) === JSON.stringify(expect)
  if (!same) throw new Error('buildRollbackList 分支映射错误: ' + JSON.stringify(mk))
  console.log('PASS 回滚清单四类动作映射正确')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FAIL', err.message)
    process.exit(1)
  })
