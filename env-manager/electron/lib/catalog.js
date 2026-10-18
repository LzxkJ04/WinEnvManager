'use strict'
/**
 * 环境市场软件清单
 * 内置清单 + 用户自定义覆盖（%APPDATA%\win-env-manager\catalog.json）
 *
 * 说明：下载地址以 urlTemplate 形式提供，支持 {version} / {arch} 占位符；
 * 下载源支持官方源与镜像源切换，镜像地址可在「程序设置 → 开发环境配置」中单独配置。
 * 内置地址为社区常用稳定地址，若某版本链接失效，可在 appData 下放置 catalog.json 覆盖。
 */
const fs = require('node:fs')
const path = require('node:path')
const store = require('./store')

const MIRRORS = {
  nodejs: 'https://npmmirror.com/mirrors/node',
  python: 'https://npmmirror.com/mirrors/python',
  golang: 'https://mirrors.aliyun.com/golang',
  jdk: 'https://mirrors.tuna.tsinghua.edu.cn/Adoptium',
  maven: 'https://mirrors.tuna.tsinghua.edu.cn/apache/maven',
  gradle: 'https://mirrors.cloud.tencent.com/gradle',
  github: 'https://ghfast.top/https://github.com'
}

function item(o) {
  return {
    id: o.id,
    name: o.name,
    ruleId: o.ruleId || o.id,
    category: o.category,
    description: o.description || '',
    versions: o.versions || [],
    installMode: o.installMode || 'portable',   // portable = 绿色压缩包解压；silent = 安装包静默安装
    silentArgs: o.silentArgs || '',             // 支持 {dir} 占位符
    sizeHint: o.sizeHint || '',
    official: o.official,
    mirrorKey: o.mirrorKey || '',
    mirrorTemplate: o.mirrorTemplate || '',
    requires: o.requires || [],
    checksums: o.checksums || {},
    registerService: !!o.registerService,
    postInstallScript: o.postInstallScript || '',
    icon: o.icon || '',
    builtin: true
  }
}

const BUILTIN_CATALOG = [
  item({
    id: 'node', name: 'Node.js', category: '语言运行时',
    description: 'Node.js JavaScript 运行时，含 npm；绿色版解压即用',
    versions: ['22.11.0', '20.18.0', '18.20.4'],
    official: 'https://nodejs.org/dist/v{version}/node-v{version}-win-x64.zip',
    mirrorKey: 'nodejs', mirrorTemplate: '{mirror}/v{version}/node-v{version}-win-x64.zip',
    sizeHint: '约 30 MB', requires: []
  }),
  item({
    id: 'python', name: 'Python', category: '语言运行时',
    description: 'Python 官方安装包，静默安装到指定目录',
    versions: ['3.13.0', '3.12.7', '3.11.9'],
    installMode: 'silent',
    silentArgs: '/quiet InstallAllUsers=0 PrependPath=0 Include_test=0 TargetDir={dir}',
    official: 'https://www.python.org/ftp/python/{version}/python-{version}-amd64.exe',
    mirrorKey: 'python', mirrorTemplate: '{mirror}/{version}/python-{version}-amd64.exe',
    sizeHint: '约 25 MB', requires: []
  }),
  item({
    id: 'go', name: 'Go', category: '语言运行时',
    description: 'Go 工具链，绿色版解压即用',
    versions: ['1.23.2', '1.22.8'],
    official: 'https://go.dev/dl/go{version}.windows-amd64.zip',
    mirrorKey: 'golang', mirrorTemplate: '{mirror}/go{version}.windows-amd64.zip',
    sizeHint: '约 80 MB', requires: []
  }),
  item({
    id: 'jdk', name: 'JDK (Temurin 17)', ruleId: 'jdk', category: '语言运行时',
    description: 'Eclipse Temurin OpenJDK 17，绿色版解压即用',
    versions: ['jdk-17.0.12+7'],
    official:
      'https://github.com/adoptium/temurin17-binaries/releases/download/' +
      'jdk-17.0.12%2B7/OpenJDK17U-jdk_x64_windows_hotspot_17.0.12_7.zip',
    mirrorKey: 'jdk', mirrorTemplate: '{mirror}/17/jdk/openjdk/OpenJDK17U-jdk_x64_windows_hotspot_17.0.12_7.zip',
    sizeHint: '约 190 MB', requires: []
  }),
  item({
    id: 'git', name: 'Git for Windows', ruleId: 'git', category: '构建&包管理',
    description: 'Git 版本控制，静默安装',
    versions: ['2.47.0'],
    installMode: 'silent',
    silentArgs: '/VERYSILENT /NORESTART /SUPPRESSMSGBOXES /DIR={dir}',
    official: 'https://github.com/git-for-windows/git/releases/download/v{version}.windows.1/Git-{version}-64-bit.exe',
    mirrorKey: 'github', mirrorTemplate: '{mirror}/git-for-windows/git/releases/download/v{version}.windows.1/Git-{version}-64-bit.exe',
    sizeHint: '约 65 MB', requires: []
  }),
  item({
    id: 'maven', name: 'Maven', category: '构建&包管理',
    description: 'Apache Maven 构建工具，绿色版解压即用',
    versions: ['3.9.9', '3.8.8'],
    official: 'https://dlcdn.apache.org/maven/maven-3/{version}/binaries/apache-maven-{version}-bin.zip',
    mirrorKey: 'maven', mirrorTemplate: '{mirror}/maven-3/{version}/binaries/apache-maven-{version}-bin.zip',
    sizeHint: '约 9 MB', requires: ['jdk']
  }),
  item({
    id: 'gradle', name: 'Gradle', category: '构建&包管理',
    description: 'Gradle 构建工具，绿色版解压即用',
    versions: ['8.10.2', '7.6.4'],
    official: 'https://services.gradle.org/distributions/gradle-{version}-bin.zip',
    mirrorKey: 'gradle', mirrorTemplate: '{mirror}/gradle-{version}-bin.zip',
    sizeHint: '约 130 MB', requires: ['jdk']
  }),
  item({
    id: '7zip', name: '7-Zip', category: 'IDE与工具',
    description: '高压缩比文件压缩工具',
    versions: ['24.08'],
    installMode: 'silent', silentArgs: '/S /D={dir}',
    official: 'https://www.7-zip.org/a/7z2408-x64.exe',
    sizeHint: '约 1.6 MB', requires: []
  }),
  item({
    id: 'vscode', name: 'VS Code', category: 'IDE与工具',
    description: 'Visual Studio Code 编辑器（用户版静默安装）',
    versions: ['1.95.0'],
    installMode: 'silent',
    silentArgs: '/VERYSILENT /NORESTART /MERGETASKS=!runcode /DIR={dir}',
    official: 'https://update.code.visualstudio.com/{version}/win32-x64-user/stable',
    sizeHint: '约 100 MB', requires: []
  }),
  item({
    id: 'kubectl', name: 'kubectl', category: '容器虚拟化',
    description: 'Kubernetes 命令行工具',
    versions: ['1.31.2'],
    official: 'https://dl.k8s.io/release/v{version}/bin/windows/amd64/kubectl.exe',
    sizeHint: '约 55 MB', requires: []
  }),
  item({
    id: 'terraform', name: 'Terraform', category: '容器虚拟化',
    description: 'HashiCorp 基础设施即代码工具',
    versions: ['1.9.8'],
    official: 'https://releases.hashicorp.com/terraform/{version}/terraform_{version}_windows_amd64.zip',
    sizeHint: '约 30 MB', requires: []
  }),
  item({
    id: 'ffmpeg', name: 'FFmpeg', category: '多媒体编译',
    description: '音视频处理工具（gyan.dev 精简版）',
    versions: ['7.1'],
    official: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
    sizeHint: '约 90 MB', requires: []
  }),
  item({
    id: 'nginx', name: 'Nginx', category: '运维网络',
    description: '高性能 Web 服务器 / 反向代理',
    versions: ['1.27.2'],
    official: 'https://nginx.org/download/nginx-{version}.zip',
    sizeHint: '约 2 MB', requires: []
  }),
  item({
    id: 'cmake', name: 'CMake', category: '构建&包管理',
    description: '跨平台构建系统生成器',
    versions: ['3.30.5'],
    installMode: 'silent',
    silentArgs: '/S /D={dir}',
    official: 'https://github.com/Kitware/CMake/releases/download/v{version}/cmake-{version}-windows-x86_64.zip',
    mirrorKey: 'github', mirrorTemplate: '{mirror}/Kitware/CMake/releases/download/v{version}/cmake-{version}-windows-x86_64.zip',
    sizeHint: '约 30 MB', requires: []
  }),
  item({
    id: 'redis', name: 'Redis (Windows)', category: '数据库中间件',
    description: 'Redis Windows 移植版（tporadowski），支持注册服务',
    versions: ['5.0.14.1'],
    installMode: 'portable', registerService: true,
    official: 'https://github.com/tporadowski/redis/releases/download/v{version}/Redis-x64-{version}.zip',
    mirrorKey: 'github', mirrorTemplate: '{mirror}/tporadowski/redis/releases/download/v{version}/Redis-x64-{version}.zip',
    sizeHint: '约 8 MB', requires: [], registerService: true,
    postInstallScript: 'redis-server.exe --service-install redis.windows.conf'
  }),
  item({
    id: 'sqlite', name: 'SQLite', category: '数据库中间件',
    description: 'SQLite 命令行工具',
    versions: ['3.46.1'],
    official: 'https://www.sqlite.org/2024/sqlite-tools-win-x64-3460100.zip',
    sizeHint: '约 5 MB', requires: []
  }),
  item({
    id: 'nssm', name: 'NSSM', category: '运维网络',
    description: '把任意 exe 注册为 Windows 服务的工具',
    versions: ['2.24'],
    official: 'https://nssm.cc/release/nssm-2.24.zip',
    sizeHint: '约 300 KB', requires: []
  })
]

/* ------------------------------ 读写 ------------------------------ */

function userCatalog() {
  try {
    const f = path.join(store.appDataDir(), 'catalog.json')
    if (fs.existsSync(f)) {
      const obj = JSON.parse(fs.readFileSync(f, 'utf8'))
      return Array.isArray(obj.items) ? obj.items : []
    }
  } catch (_) { /* ignore */ }
  return []
}

function loadCatalog() {
  const map = new Map()
  for (const i of BUILTIN_CATALOG) map.set(i.id, i)
  for (const i of userCatalog()) map.set(i.id, { ...i, builtin: false, custom: true })
  return [...map.values()]
}

function getItem(id) {
  return loadCatalog().find((i) => i.id === id) || null
}

function saveUserCatalog(items) {
  store.ensureDir(store.appDataDir())
  fs.writeFileSync(path.join(store.appDataDir(), 'catalog.json'), JSON.stringify({ items }, null, 2), 'utf8')
  return true
}

const MIRROR_CONFIG_KEYS = {
  nodejs: 'mirrorNode',
  python: 'mirrorPython',
  golang: 'mirrorGo',
  jdk: 'mirrorJdk',
  maven: 'mirrorMaven',
  gradle: 'mirrorGradle',
  github: 'mirrorGithub'
}

function configuredMirror(item) {
  const key = item && item.mirrorKey && MIRROR_CONFIG_KEYS[item.mirrorKey]
  if (!key) return ''
  try { return String(store.readConfig()[key] || '').trim() } catch { return '' }
}

/** 解析下载地址：source = 'official' | 'mirror'。显式镜像优先，否则用设置里的对应镜像，再回落内置镜像。 */
function resolveUrl(item, version, source, customMirror) {
  let tpl = item.official
  if (source === 'mirror') {
    const passed = String(customMirror || '').trim()
    const base = passed || configuredMirror(item) || (item.mirrorKey && MIRRORS[item.mirrorKey]) || ''
    if (item.mirrorTemplate && base) tpl = item.mirrorTemplate.replace('{mirror}', base.replace(/\/$/, ''))
    else if (base) tpl = item.official.replace(/^https?:\/\/[^/]+/i, base)
  }
  const arch = 'win-x64'
  return tpl
    .replace(/\{version\}/g, encodeURIComponent(version))
    .replace(/\{arch\}/g, arch)
}

function listMirrors() {
  return MIRRORS
}

module.exports = { loadCatalog, getItem, saveUserCatalog, resolveUrl, listMirrors, MIRRORS }
