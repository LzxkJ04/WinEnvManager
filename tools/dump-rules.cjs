// 从 Electron 版导出内置识别规则库为 JSON（供 Tauri 版内嵌使用）
const Module = require('module')
const path = require('node:path')
const fs = require('node:fs')

const ROOT = path.resolve(__dirname, '..')
// stub 掉 electron 依赖的 store 模块
const stubPath = path.join(ROOT, 'env-manager', 'electron', 'lib', '__store_stub.js')
fs.writeFileSync(
  stubPath,
  "module.exports = { appDataDir: () => '', snapshotDir: () => '', logDir: () => '', ensureDir: () => {}, readConfig: () => ({}), writeLog: () => {}, configDir: () => '', resolvedBackupDir: () => '', resolvedCacheDir: () => '', resolvedDevRoot: () => '' }"
)

const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
  if (request === './store') return stubPath
  return origResolve.call(this, request, ...args)
}

// eslint-disable-next-line import/no-dynamic-require
const rules = require(path.join(ROOT, 'env-manager', 'electron', 'lib', 'rules.js'))
const data = { ruleVersion: rules.RULE_VERSION, ruleList: rules.builtinRules() }
const out = path.join(ROOT, 'winenv-tauri', 'src-tauri', 'resources', 'rules.json')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify(data, null, 2), 'utf8')
console.log('written', out, data.ruleList.length, 'rules')
fs.rmSync(stubPath, { force: true })
