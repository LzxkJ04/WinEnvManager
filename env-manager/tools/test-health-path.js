// 验证 path-duplicate / path-format 检测：临时改用户 PATH，测完立刻还原
const { app, dialog, shell } = require('electron')
const path = require('node:path')

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const handlers = new Map()
  for (const f of ['registry', 'reg-extra']) {
    require(path.join(__dirname, '..', 'electron', 'ipc', f + '.js')).register((c, fn) => handlers.set(c, fn), { dialog, shell })
  }
  const call = (ch, arg) => handlers.get(ch)({}, arg)
  const ENV = 'HKCU\\Environment'

  // 读取并备份原始 PATH（保留 REG_EXPAND_SZ 原文）
  const before = await call('reg:values', ENV)
  const origPath = before.values.find((v) => v.name.toUpperCase() === 'PATH')
  if (!origPath) { console.log('!! 未找到用户 Path 变量'); app.exit(1); return }
  const origValue = origPath.value
  const origType = origPath.type
  console.log('原始 Path 类型:', origType, '长度:', origValue.length)

  try {
    // 注入重复条目 + 末尾多余分号 + 空段
    const dirty = `${origValue};C:\\Windows;C:\\Windows;;`
    await call('reg:setValue', { path: ENV, name: 'Path', type: origType, value: dirty })
    console.log('已注入脏 PATH，长度:', dirty.length)

    const r = await call('health:scan')
    const types = new Set(r.items.map((i) => i.type))
    console.log('\n评分:', r.score, '统计:', JSON.stringify(r.stats))
    r.items.filter((i) => i.type.startsWith('path-')).forEach((i) =>
      console.log(' -', i.level, '|', i.type, '|', i.title)
    )
    console.log('\npath-duplicate 触发:', types.has('path-duplicate'))
    console.log('path-format 触发:', types.has('path-format'))
  } finally {
    // 严格还原：原类型 + 原值
    await call('reg:setValue', { path: ENV, name: 'Path', type: origType, value: origValue })
    const after = await call('reg:values', ENV)
    const cur = after.values.find((v) => v.name.toUpperCase() === 'PATH')
    const same = cur && cur.value === origValue && cur.type === origType
    console.log('\n还原校验:', same ? 'PASS（值与类型均一致）' : `FAIL 当前类型=${cur && cur.type} 长度=${cur && cur.value.length}`)
  }

  app.exit(0)
})
