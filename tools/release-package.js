// 制品标准化与校验：node tools/release-package.js
// 把 release-all 的产出整理成发布规范要求的命名，生成便携 zip 与 SHA256SUMS.txt
// 输出：<项目根>/release-out/vX.Y.Z/
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')

const PROJECT = path.resolve(__dirname, '..')
const EM = (p) => path.join(PROJECT, 'env-manager', p)
const PJ = (p) => path.join(PROJECT, p)

const version = JSON.parse(fs.readFileSync(EM('package.json'), 'utf8')).version
const tag = `v${version}`
const outDir = PJ(path.join('release-out', tag))

function log(msg) {
  console.log(msg)
}

function fail(msg) {
  console.error(`!! ${msg}`)
  process.exit(1)
}

function mustExist(file, label) {
  if (!fs.existsSync(file)) fail(`缺少${label}: ${path.relative(PROJECT, file)}`)
  const size = fs.statSync(file).size
  log(`  ok: ${path.relative(PROJECT, file)} (${(size / 1024 / 1024).toFixed(1)} MB)`)
  return file
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

/* ---------- 版本号一致性 ---------- */
log(`WinEnv管家 ${tag} 制品整理`)
log('\n[1/5] 校验四处版本号')
const iss = fs.readFileSync(PJ('installer-web/setup.iss'), 'utf8')
const issVer = (iss.match(/#define MyAppVersion "([^"]+)"/) || [])[1]
const tauriConf = JSON.parse(fs.readFileSync(PJ('bootstrapper/src-tauri/tauri.conf.json'), 'utf8')).version
const cargoToml = fs.readFileSync(PJ('bootstrapper/src-tauri/Cargo.toml'), 'utf8')
const cargoVer = (cargoToml.match(/^version\s*=\s*"([^"]+)"/m) || [])[1]
const checks = [
  ['package.json', version],
  ['setup.iss', issVer],
  ['tauri.conf.json', tauriConf],
  ['Cargo.toml', cargoVer],
]
let verOk = true
for (const [where, v] of checks) {
  const ok = v === version
  if (!ok) verOk = false
  log(`  ${ok ? 'ok  ' : 'FAIL'} ${where}: ${v || '(未找到)'}`)
}
if (!verOk) fail(`版本号不一致，四处必须都是 ${version}`)

/* ---------- 收集制品 ---------- */
log('\n[2/5] 收集打包产物')
const portableExe = mustExist(EM(`out-release/WinEnvManager-${version}-portable.exe`), '便携版 exe')
const setupExe = mustExist(PJ(`installer-web/output/WinEnvManager-v${version}-setup.exe`), '安装包')
const wizardExe = mustExist(PJ(`WinEnvManager-v${version}-安装向导.exe`), '安装向导')

/* ---------- 输出目录 ---------- */
log('\n[3/5] 准备输出目录')
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })
log(`  ${path.relative(PROJECT, outDir)}`)

const setupOut = path.join(outDir, `WinEnvManager-Setup-${version}.exe`)
const portableZip = path.join(outDir, `WinEnvManager-Portable-${version}.zip`)
const wizardOut = path.join(outDir, `WinEnvManager-Wizard-${version}.exe`)

fs.copyFileSync(setupExe, setupOut)
log(`  -> ${path.basename(setupOut)}`)
fs.copyFileSync(wizardExe, wizardOut)
log(`  -> ${path.basename(wizardOut)}`)

/* ---------- 便携 zip ---------- */
log('\n[4/5] 生成便携 zip（程序本体 + 默认配置）')
const stage = path.join(outDir, '_stage')
const stageApp = path.join(stage, 'WinEnvManager')
fs.mkdirSync(stageApp, { recursive: true })
fs.copyFileSync(portableExe, path.join(stageApp, `WinEnvManager-${version}-portable.exe`))
fs.writeFileSync(
  path.join(stageApp, 'README-portable.txt'),
  [
    'WinEnv管家 便携版',
    '',
    `版本：${version}`,
    '',
    '直接双击 WinEnvManager-*-portable.exe 运行，无需安装。',
    '',
    '便携模式说明：',
    '1. 用户数据保存在本目录下的 UserData\\ 子目录（配置、快照、日志、审计）。',
    '2. 不读取注册表安装信息，不写入系统级安装登记。',
    '3. 移动整个 WinEnvManager 文件夹即可迁移全部数据。',
    '4. 写入系统环境变量仍需管理员权限，右键「以管理员身份运行」即可。',
    '',
    '风险提示：修改系统环境变量会影响整台机器，操作前建议先创建快照。',
  ].join('\r\n'),
  'utf8'
)
// 便携模式标记：数据跟随程序目录
fs.writeFileSync(path.join(stageApp, '.wem-portable'), `portable ${version}\r\n`, 'utf8')
log('  已写入使用说明与便携标记')

// Compress-Archive 在 Windows PowerShell 5.1 下用系统代码页存文件名，中文会乱码。
// 改用 .NET ZipArchive，条目名显式指定 UTF-8。
const psScript = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path -LiteralPath '${portableZip}') { Remove-Item -LiteralPath '${portableZip}' -Force }
$zip = [System.IO.Compression.ZipFile]::Open('${portableZip}', [System.IO.Compression.ZipArchiveMode]::Create)
try {
  $root = '${stageApp}'
  $baseName = Split-Path -Leaf $root
  Get-ChildItem -LiteralPath $root -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($root.Length).TrimStart('\\')
    $entryName = $baseName + '/' + ($rel -replace '\\\\', '/')
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal)
  }
} finally {
  $zip.Dispose()
}
`
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], { stdio: 'inherit' })
fs.rmSync(stage, { recursive: true, force: true })
log(`  -> ${path.basename(portableZip)} (${(fs.statSync(portableZip).size / 1024 / 1024).toFixed(1)} MB)`)

/* ---------- 校验文件 ---------- */
log('\n[5/5] 生成 SHA256SUMS.txt')
const artifacts = [setupOut, portableZip, wizardOut].sort()
const lines = artifacts.map((f) => `${sha256(f)}  ${path.basename(f)}`)
fs.writeFileSync(path.join(outDir, 'SHA256SUMS.txt'), lines.join('\n') + '\n', 'utf8')
lines.forEach((l) => log('  ' + l))

log('\n完成。上传以下文件到 GitHub Release：')
fs.readdirSync(outDir).sort().forEach((f) => log(`  ${f}`))
log('\n不要上传源码压缩包，GitHub 会自动生成。')
