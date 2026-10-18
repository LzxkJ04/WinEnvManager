// 只读冒烟：验证 regsvc 能真实读取注册表、解析路径、导出 reg 文本
// 不写入任何注册表内容
const { app } = require('electron')
const path = require('node:path')

app.whenReady().then(async () => {
  const regsvc = require(path.resolve(__dirname, '..', 'electron', 'lib', 'regsvc'))
  let pass = 0
  let fail = 0
  const check = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ', name) } else { fail++; console.log('FAIL ', name, extra ?? '') }
  }

  // 1. 路径解析
  check('HKCU 短名', regsvc.parsePath('HKCU\\Environment').full === 'HKCU\\Environment')
  check('长名转短名', regsvc.parsePath('HKEY_CURRENT_USER\\Environment').full === 'HKCU\\Environment')
  check('PSDrive 前缀', regsvc.parsePath('Registry::HKEY_LOCAL_MACHINE\\SOFTWARE').full === 'HKLM\\SOFTWARE')
  check('尾部反斜杠', regsvc.parsePath('HKCU\\Environment\\').full === 'HKCU\\Environment')
  check('非法根项', regsvc.parsePath('FOO\\Bar').ok === false)
  check('空路径', regsvc.parsePath('').ok === false)

  // 2. 键名校验
  check('键名含反斜杠拒绝', regsvc.validateKeyName('a\\b').ok === false)
  check('键名为空拒绝', regsvc.validateKeyName('').ok === false)
  check('正常键名', regsvc.validateKeyName('MyKey').ok === true)

  // 3. 环境变量路径常量
  const env = regsvc.envPaths()
  check('用户环境路径', env.user === 'HKCU\\Environment', env.user)
  check('系统环境路径', env.machine.includes('Session Manager'), env.machine)
  check('isEnvPath 识别', regsvc.isEnvPath('HKCU\\Environment') === true)

  // 4. 真实读取子项与键值（只读）
  try {
    const subs = await regsvc.listSubKeys('HKLM\\SOFTWARE')
    check('读取 HKLM\\SOFTWARE 子项', Array.isArray(subs) && subs.length > 0, `count=${subs && subs.length}`)
    if (subs.length) console.log('       样例:', subs.slice(0, 3).map((s) => s.name).join(', '))
  } catch (e) { check('读取 HKLM\\SOFTWARE 子项', false, e.message) }

  try {
    const vals = await regsvc.listValues('HKCU\\Environment')
    check('读取 HKCU\\Environment 键值', Array.isArray(vals), `count=${vals && vals.length}`)
    const pathVar = (vals || []).find((v) => v.name.toUpperCase() === 'PATH')
    check('Path 类型为 REG_EXPAND_SZ', !pathVar || pathVar.type === 'REG_EXPAND_SZ', pathVar && pathVar.type)
    if (vals.length) console.log('       样例:', vals.slice(0, 4).map((v) => `${v.name}(${v.type})`).join(', '))
  } catch (e) { check('读取 HKCU\\Environment 键值', false, e.message) }

  // 5. 类型转换
  const d = regsvc.valueToPs('REG_DWORD', '255')
  check('DWORD 转换', d.psType === 'DWord' && d.literal === '255', JSON.stringify(d))
  const m = regsvc.valueToPs('REG_MULTI_SZ', 'a\nb')
  check('MULTI_SZ 转换', m.psType === 'MultiString' && m.literal.includes("'a'") && m.literal.includes("'b'"), m.literal)
  const e2 = regsvc.valueToPs('REG_EXPAND_SZ', '%JAVA_HOME%\\bin')
  check('EXPAND_SZ 必须是 ExpandString', e2.psType === 'ExpandString', e2.psType)
  let threw = false
  try { regsvc.valueToPs('REG_BINARY', 'zz') } catch { threw = true }
  check('BINARY 非法十六进制拒绝', threw)
  threw = false
  try { regsvc.valueToPs('REG_DWORD', 'abc') } catch { threw = true }
  check('DWORD 非数字拒绝', threw)

  // 6. 构建 reg 文本
  const txt = regsvc.buildRegText([{
    path: 'HKCU\\Environment',
    values: [
      { name: 'JAVA_HOME', type: 'REG_SZ', value: 'C:\\Java' },
      { name: 'Path', type: 'REG_EXPAND_SZ', value: '%JAVA_HOME%\\bin' },
      { name: 'Count', type: 'REG_DWORD', value: '42' },
      { name: 'List', type: 'REG_MULTI_SZ', value: 'a\nb' }
    ]
  }])
  check('reg 文件头', txt.startsWith('Windows Registry Editor Version 5.00'))
  check('reg 含项路径', txt.includes('[HKCU\\Environment]'))
  check('reg EXPAND_SZ 用 hex(2)', txt.includes('hex(2):'))
  check('reg DWORD 小写十六进制', /dword:0000002a/.test(txt), txt.match(/dword:[0-9a-f]+/)?.[0])
  check('reg 反斜杠转义', txt.includes('C:\\\\Java'))

  // 7. 管理员检测
  const admin = await regsvc.isAdmin()
  check('管理员检测返回布尔', typeof admin === 'boolean')
  console.log('       当前是否管理员:', admin)

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`)
  app.exit(fail ? 1 : 0)
}).catch((e) => {
  console.error('测试异常:', e)
  app.exit(1)
})
