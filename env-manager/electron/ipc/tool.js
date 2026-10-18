'use strict'
/**
 * 快捷工具箱 IPC
 * tool:elevate / tool:openRegEnv / tool:openNativeEnvPanel
 */
const { app } = require('electron')
const registry = require('../lib/registry')
const store = require('../lib/store')
const { runPowerShell, psQuote } = require('../lib/ps')

/** 获取“真正的”程序 exe 路径
 *  electron-builder portable 目标运行时会解压到临时目录，
 *  此时 app.getPath('exe') 指向临时副本，需要用 PORTABLE_EXECUTABLE_FILE 还原原始路径。
 */
function realExePath() {
  return process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe')
}

function register(handle, ctx) {
  const adminCached = registry.isAdmin().catch(() => false)
  /* 1. 管理员提权，以管理员权限重新启动当前 exe */
  handle('tool:elevate', async () => {
    const exe = realExePath()
    // 路径带空格必须用引号包裹
    const script = `Start-Process -FilePath '${psQuote(exe)}' -Verb RunAs`
    await runPowerShell(script, { timeout: 60000 })
    store.writeLog('warn', '管理员提权启动', exe)
    return { exe }
  })

  /* 2. 打开注册表并跳转到环境变量位置 */
  handle('tool:openRegEnv', async (event, scope) => {
    const target =
      scope === 'user'
        ? 'HKEY_CURRENT_USER\\Environment'
        : 'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'
    const script = `
$rk = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Applets\\Regedit'
if (-not (Test-Path -LiteralPath $rk)) { New-Item -Path $rk -Force | Out-Null }
Set-ItemProperty -LiteralPath $rk -Name 'LastKey' -Value '${psQuote('计算机\\' + target)}' -Type String
Start-Process regedit.exe
'ok'
`
    await runPowerShell(script, { timeout: 30000 })
    store.writeLog('warn', '打开注册表编辑器', target)
    return target
  })

  /* 3. 唤起 Windows 原生环境变量面板 */
  handle('tool:openNativeEnvPanel', async (event, mode) => {
    if (mode === 'advanced') {
      await runPowerShell(`Start-Process -FilePath 'SystemPropertiesAdvanced.exe'`, { timeout: 30000 })
    } else {
      await runPowerShell(
        `Start-Process -FilePath 'rundll32.exe' -ArgumentList 'sysdm.cpl,EditEnvironmentVariables'`,
        { timeout: 30000 }
      )
    }
    return true
  })

  /* 4. 重启资源管理器 */
  handle('tool:restartExplorer', async () => {
    const ok = await registry.reloadExplorer()
    store.writeLog('warn', '重启资源管理器')
    return ok
  })

  /* 5. 广播环境变量变更 */
  handle('tool:broadcastChange', async () => registry.broadcastChange())

  /* 6. 打开文件夹 / 文件 / 外部链接 */
  handle('tool:openFolder', async (event, target) => {
    if (!target) throw new Error('路径为空')
    const res = await ctx.shell.openPath(target)
    if (res) throw new Error(res)
    return true
  })

  handle('tool:openExternal', async (event, url) => {
    await ctx.shell.openExternal(String(url))
    return true
  })

  /* 7. 在资源管理器中定位文件 */
  handle('tool:showInFolder', async (event, file) => {
    if (!file) throw new Error('路径为空')
    ctx.shell.showItemInFolder(file)
    return true
  })

  /* 8. 打开注册表编辑器前，展示风险提示所需的信息 */
  handle('tool:envSummary', async () => {
    const { user, machine } = await registry.readAllEnv()
    const cfg = store.readConfig()
    return {
      counts: { user: user.length, machine: machine.length, total: user.length + machine.length },
      config: cfg,
      paths: {
        config: store.configFile(),
        snapshots: store.snapshotDir(),
        logs: store.logDir(),
        backups: store.resolvedBackupDir()
      }
    }
  })

  /* 11. 列出目录下可执行文件（PATH 校验器用） */
  handle('tool:listExecutables', async (event, payload) => {
    const { dir, exts } = payload || {}
    const list = Array.isArray(exts) && exts.length ? exts : ['.exe', '.cmd', '.bat', '.com']
    const script = `
$d = '${psQuote(String(dir || ''))}'
$exts = @(${list.map((e) => `'${psQuote(e.toLowerCase())}'`).join(',')})
if (-not (Test-Path -LiteralPath $d -PathType Container)) { @() | ConvertTo-Json -Compress; return }
@(
  Get-ChildItem -LiteralPath $d -File -ErrorAction SilentlyContinue |
    Where-Object { $exts -contains $_.Extension.ToLower() } |
    Select-Object -First 200 |
    ForEach-Object { [pscustomobject]@{ file = $_.FullName; size = $_.Length } }
) | ConvertTo-Json -Depth 3 -Compress
`
    const raw = await runPowerShell(script, { timeout: 30000 })
    let out = []
    try {
      const parsed = JSON.parse((raw || '[]').trim() || '[]')
      out = Array.isArray(parsed) ? parsed : parsed ? [parsed] : []
    } catch (_) { out = [] }
    return out.map((x) => ({ file: String(x.file), size: Number(x.size) }))
  })

  /* 10. 系统环境重置（高危）：恢复用户/系统变量到 Windows 默认值 */  handle('tool:resetEnvDefaults', async (event, p) => {
    const scope = (p && p.scope) || 'user'
    const admin = await adminCached
    if (scope === 'machine' && !admin) throw new Error('重置系统变量需要管理员权限')

    const defaults = {
      user: {
        TEMP: '%USERPROFILE%\\AppData\\Local\\Temp',
        TMP: '%USERPROFILE%\\AppData\\Local\\Temp',
        Path: '%USERPROFILE%\\AppData\\Local\\Microsoft\\WindowsApps'
      },
      machine: {
        ComSpec: '%SystemRoot%\\system32\\cmd.exe',
        OS: 'Windows_NT',
        Path:
          '%SystemRoot%\\system32;%SystemRoot%;%SystemRoot%\\System32\\Wbem;' +
          '%SYSTEMROOT%\\System32\\WindowsPowerShell\\v1.0\\;%SYSTEMROOT%\\System32\\OpenSSH\\',
        PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC',
        PROCESSOR_ARCHITECTURE: process.env.PROCESSOR_ARCHITECTURE || 'AMD64',
        NUMBER_OF_PROCESSORS: process.env.NUMBER_OF_PROCESSORS || '4',
        windir: '%SystemRoot%',
        PSModulePath: '%ProgramFiles%\\WindowsPowerShell\\Modules;%SystemRoot%\\system32\\WindowsPowerShell\\v1.0\\Modules',
        PUBLIC: '%SystemDrive%\\Users\\Public',
        ProgramData: '%SystemDrive%\\ProgramData',
        ProgramFiles: '%SystemDrive%\\Program Files',
        'ProgramFiles(x86)': '%SystemDrive%\\Program Files (x86)',
        SystemDrive: 'C:',
        SystemRoot: '%SystemRoot%',
        'CommonProgramFiles': '%ProgramFiles%\\Common Files',
        'CommonProgramFiles(x86)': '%ProgramFiles(x86)%\\Common Files'
      }
    }[scope]

    const keyPath = scope === 'machine' ? store.MACHINE_PS_KEY : store.USER_PS_KEY
    const before = await registry.readScope(scope)

    // 重置前强制生成快照与备份
    const detailed = await ops.captureEnvDetailed()
    await ops.createSnapshotV2({ name: '重置环境前快照', auto: true }, detailed)
    await ops.createBackupV2({ prefix: 'BeforeReset', env: detailed, backupType: 'full' })

    // 删除全部现有变量
    for (const item of before) {
      // eslint-disable-next-line no-await-in-loop
      await registry.deleteValue(scope, item.name).catch(() => {})
    }
    // 写入默认值
    for (const [name, value] of Object.entries(defaults)) {
      // eslint-disable-next-line no-await-in-loop
      await registry.writeValue(scope, name, value)
    }
    await registry.broadcastChange().catch(() => false)
    store.writeLog('error', `重置${scope === 'machine' ? '系统' : '用户'}变量为系统默认值`, {
      removed: before.length,
      restored: Object.keys(defaults).length
    })
    return { removed: before.length, restored: Object.keys(defaults).length }
  })

  /* 9. 命令查找模拟：在给定目录列表中查找可执行文件（用于 CMD / PowerShell 预览） */  handle('tool:whichCommand', async (event, payload) => {
    const { name, dirs } = payload || {}
    const cmd = String(name || '').trim()
    if (!cmd) throw new Error('请输入要查找的命令名')
    const list = (Array.isArray(dirs) ? dirs : []).filter((d) => typeof d === 'string' && d.trim() !== '')
    if (!list.length) return { name: cmd, matches: [] }

    const lines = list
      .map((p) => `  '${psQuote(String(p).trim())}'`)
      .join(',' + String.fromCharCode(10))

    const script = `
$dirs = @(
${lines}
)
$name = '${psQuote(cmd)}'
$exts = @('.exe','.cmd','.bat','.com','.ps1','.vbs','.js')
$result = New-Object System.Collections.ArrayList
$i = 0
foreach ($raw in $dirs) {
  $i++
  if ([string]::IsNullOrWhiteSpace($raw)) { continue }
  try { $exp = [Environment]::ExpandEnvironmentVariables($raw) } catch { $exp = $raw }
  $exists = Test-Path -LiteralPath $exp -PathType Container
  foreach ($ext in $exts) {
    $candidate = Join-Path $exp ($name + $ext)
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      [void]$result.Add([pscustomobject]@{ order = $i; dir = $raw; expanded = $exp; file = $candidate; dirExists = $exists })
    }
  }
}
@($result) | ConvertTo-Json -Depth 4 -Compress
`
    const raw = await runPowerShell(script, { timeout: 45000 })
    const text = (raw || '').trim()
    let matches = []
    if (text) {
      try {
        const parsed = JSON.parse(text)
        matches = Array.isArray(parsed) ? parsed : [parsed]
      } catch (_) {
        matches = []
      }
    }
    return { name: cmd, matches }
  })
}

module.exports = { register, realExePath }
