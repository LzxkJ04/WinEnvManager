// 审计日志闭环实测：appendAudit 写入 → listAudit 读回断言（软件内只读、按月 JSONL）
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const store = require('../electron/lib/store')

async function main() {
  const before = store.listAudit(1000).length

  const items = [
    { origin: 'GUI', action: 'applyChanges', count: 2, items: [{ name: 'WEM_AUDIT_A', scope: 'user', ok: true, before: 'x', after: 'y' }] },
    { origin: 'CLI', action: 'set', count: 1, items: [{ name: 'WEM_AUDIT_B', scope: 'user', ok: true, before: '', after: 'v' }] },
    { origin: 'GUI', action: 'applyChangesRolledBack', count: 1, items: [{ name: 'WEM_AUDIT_A', scope: 'user', ok: true, before: 'y', after: 'x' }] }
  ]
  for (const it of items) store.appendAudit(it)

  const list = store.listAudit(1000)
  const added = list.slice(0, items.length)
  const okOrigin = added.some((r) => r.origin === 'CLI' && r.action === 'set')
  const okRollback = added.some((r) => r.action === 'applyChangesRolledBack')
  const okText = added.every((r) => r.atText && r.at)
  if (!(added.length === items.length && okOrigin && okRollback && okText)) {
    throw new Error(`审计读回不符: added=${added.length} cli=${okOrigin} rb=${okRollback} ts=${okText}`)
  }
  console.log(`PASS 审计写入/读回闭环（新增 ${items.length} 条，当前共 ${before + items.length} 条）`)

  // 按月分文件存在
  const dir = store.auditDir()
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
  if (!files.length) throw new Error('audit 目录没有 jsonl 文件')
  console.log(`PASS 审计目录 ${dir}（${files.length} 个月度文件，软件内无删除入口）`)

  // 清理本次测试数据（直接删测试行所在的最新文件行？审计不可在软件内删除——测试里只删除本测试写入的行以保持环境干净）
  const newest = files.sort().pop()
  const full = path.join(dir, newest)
  const lines = fs.readFileSync(full, 'utf8').split('\n').filter(Boolean)
  const kept = lines.filter((l) => !l.includes('WEM_AUDIT_'))
  fs.writeFileSync(full, kept.length ? kept.join('\n') + '\n' : '', 'utf8')
  console.log(`PASS 测试数据已从 ${newest} 移除（非软件内入口，仅为保持测试机干净）`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FAIL', err.message)
    process.exit(1)
  })
