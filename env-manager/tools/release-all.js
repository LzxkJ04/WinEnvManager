// 一键发布脚本：node tools/release-all.js
// 链路：vite 构建 → 主程序 portable 打包 → 同步 pkg → Inno setup → 引导壳 cargo → 根目录安装向导
// 全部相对项目根执行；任一步失败立即退出并保留现场。
'use strict'
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')                      // env-manager/
const PROJECT = path.resolve(ROOT, '..')                        // WinEnv管家/
const EM = (p) => path.join(ROOT, p)
const PJ = (p) => path.join(PROJECT, p)

const version = JSON.parse(fs.readFileSync(EM('package.json'), 'utf8')).version
const t0 = Date.now()
const stepNames = []

function run(name, cmd, args, opts = {}) {
  const t = Date.now()
  console.log(`\n==== [${stepNames.length + 1}] ${name} ====`)
  try {
    execFileSync(cmd, args, { stdio: 'inherit', cwd: opts.cwd || ROOT, env: { ...process.env, ...(opts.env || {}) } })
  } catch (err) {
    console.error(`\n!! 步骤失败：${name}（exit ${err.status}）`)
    process.exit(err.status || 1)
  }
  stepNames.push(name)
  console.log(`---- 完成 ${name}，耗时 ${((Date.now() - t) / 1000).toFixed(1)}s`)
}

function mustExist(file, label) {
  if (!fs.existsSync(file)) {
    console.error(`!! 缺少${label}: ${file}`)
    process.exit(1)
  }
  console.log(`  ok: ${path.relative(PROJECT, file)} (${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} MB)`)
}

console.log(`WinEnv管家 v${version} 一键发布`)

/* 0. 图标一致性：所有消费方必须和 build/icon.ico 同一份，否则打出来的图标会不一致 */
const iconConsumers = [
  EM('build/icon.ico'),
  EM('public/icon.ico'),
  PJ('installer-web/pkg/WinEnvManager.ico'),
  PJ('bootstrapper/src-tauri/icons/icon.ico')
]
const crypto = require('node:crypto')
const hashOf = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
const baseIconHash = hashOf(iconConsumers[0])
const iconMismatch = iconConsumers.filter((f) => !fs.existsSync(f) || hashOf(f) !== baseIconHash)
if (iconMismatch.length) {
  console.error('!! 图标不一致，先执行 python build/make_icon.py：')
  iconMismatch.forEach((f) => console.error('   ' + path.relative(PROJECT, f)))
  process.exit(1)
}
console.log('  图标一致性 ok: ' + iconConsumers.map((f) => path.relative(PROJECT, f)).join(' / '))

/* 1. 渲染端构建 */
run('构建渲染端 (vite)', process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { cwd: ROOT })

/* 2. 主程序 portable 打包（electron-builder） */
const ebCfg = EM('eb-release.json')
fs.writeFileSync(ebCfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(EM('package.json'), 'utf8')).build, directories: { ...(JSON.parse(fs.readFileSync(EM('package.json'), 'utf8')).build.directories || {}), output: 'out-release' } }, null, 2))
try {
  run('打包主程序 (electron-builder portable)', process.execPath, ['node_modules/electron-builder/cli.js', '--win', 'portable', '--x64', '--config', 'eb-release.json'], { cwd: ROOT })
} finally {
  fs.rmSync(ebCfg, { force: true })
}

/* 3. 同步主程序到安装器载荷 */
const mainExe = EM('out-release/win-unpacked/WinEnvManager.exe')
mustExist(mainExe, '主程序 exe')
fs.copyFileSync(mainExe, PJ('installer-web/pkg/WinEnvManager.exe'))
console.log('  已同步 -> installer-web/pkg/WinEnvManager.exe')

/* 4. Inno 静默安装引擎 */
const ISCC = 'C:\\tools\\inno\\ISCC.exe'
if (!fs.existsSync(ISCC)) {
  console.error(`!! 找不到 Inno 编译器: ${ISCC}`)
  process.exit(1)
}
run('编译静默安装引擎 (ISCC)', ISCC, ['setup.iss'], { cwd: PJ('installer-web') })
const setupExe = PJ(`installer-web/output/WinEnvManager-v${version}-setup.exe`)
mustExist(setupExe, 'setup.exe')

/* 5. 嵌入引导壳并编译（Rust） */
fs.copyFileSync(setupExe, PJ('bootstrapper/src-tauri/payload/setup.exe'))
console.log('  已嵌入 -> bootstrapper/src-tauri/payload/setup.exe')
run('构建图形引导壳 (cargo)', 'C:\\tools\\cargo\\bin\\cargo.exe', ['build', '--release'], {
  cwd: PJ('bootstrapper/src-tauri'),
  env: { RUSTUP_HOME: 'C:\\tools\\rustup', CARGO_HOME: 'C:\\tools\\cargo', RUSTUP_TOOLCHAIN: 'stable-x86_64-pc-windows-msvc' }
})

/* 6. 复制最终交付物到项目根 */
const bootstrapper = PJ('bootstrapper/src-tauri/target/release/winenv-bootstrapper.exe')
mustExist(bootstrapper, '引导壳 exe')
const finalName = PJ(`WinEnvManager-v${version}-安装向导.exe`)
fs.copyFileSync(bootstrapper, finalName)

console.log(`\n==== 发布完成，总耗时 ${((Date.now() - t0) / 1000 / 60).toFixed(1)} 分钟 ====`)
// electron-builder 的 artifactName 是 WinEnvManager-${version}-portable.exe，便携版文件名没有多余的 v
console.log(`  便携版     : ${path.relative(PROJECT, EM(`out-release/WinEnvManager-${version}-portable.exe`))}`)
console.log(`  静默引擎   : ${path.relative(PROJECT, setupExe)}`)
console.log(`  安装向导   : ${path.relative(PROJECT, finalName)}`)
