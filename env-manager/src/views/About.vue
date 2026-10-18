<template>
  <div>
    <div class="about-hero wem-card">
      <img class="about-logo" src="/icon.png" alt="logo" />
      <div class="about-meta">
        <h2>WinEnv管家</h2>
        <p class="about-sub">WinEnvManager v{{ info.version }} · 单文件便携版 · 仅支持 Windows</p>
        <div class="toolbar" style="margin-top: 14px">
          <a-button type="primary" :loading="checking" @click="checkUpdate">
            <template #icon><CloudSyncOutlined /></template>
            检测更新
          </a-button>
          <a-button @click="openProjectDir">
            <template #icon><FolderOpenOutlined /></template>
            打开程序目录
          </a-button>
          <a-button @click="openDataDir">
            <template #icon><DatabaseOutlined /></template>
            打开数据目录
          </a-button>
          <a-button @click="openLogDir">
            <template #icon><FileTextOutlined /></template>
            查看日志目录
          </a-button>
          <a-button @click="checkDeps">
            <template #icon><SafetyOutlined /></template>
            检查运行依赖
          </a-button>
          <a-button @click="showStorage">
            <template #icon><PieChartOutlined /></template>
            存储占用
          </a-button>
          <a-button @click="showRules">
            <template #icon><AppstoreOutlined /></template>
            内置识别规则（{{ rulesCount }}）
          </a-button>
        </div>
      </div>
    </div>

    <div class="split-2" style="margin-top: 14px">
      <div class="wem-card">
        <div class="wem-card-head">
          <div class="wem-card-title"><InfoCircleOutlined /> 版本信息</div>
        </div>
        <div class="wem-card-body">
          <div class="kv-list">
            <span class="kv-key">程序版本</span><span class="kv-val">{{ info.version }}</span>
            <span class="kv-key">Electron</span><span class="kv-val">{{ info.electron }}</span>
            <span class="kv-key">Chromium</span><span class="kv-val">{{ info.chrome }}</span>
            <span class="kv-key">Node.js</span><span class="kv-val">{{ info.node }}</span>
            <span class="kv-key">V8</span><span class="kv-val">{{ info.v8 }}</span>
            <span class="kv-key">运行平台</span><span class="kv-val">{{ info.platform }}</span>
            <span class="kv-key">打包状态</span>
            <span class="kv-val">{{ info.packaged ? '已打包（单文件便携版）' : '开发模式' }}</span>
            <span class="kv-key">程序路径</span><span class="kv-val">{{ info.exe }}</span>
          </div>
        </div>
      </div>

      <div class="wem-card">
        <div class="wem-card-head">
          <div class="wem-card-title"><AppstoreOutlined /> 功能一览</div>
        </div>
        <div class="wem-card-body">
          <div class="feature-grid">
            <div v-for="f in features" :key="f.title" class="feature-item">
              <component :is="f.icon" class="feature-icon" />
              <div>
                <div class="feature-title">{{ f.title }}</div>
                <div class="feature-desc">{{ f.desc }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="wem-card">
      <div class="wem-card-head">
        <div class="wem-card-title"><CodeOutlined /> 命令行（CLI）用法</div>
        <span class="text-muted">输出格式与写入权限在「程序设置 → 高级设置」关联项中配置</span>
      </div>
      <div class="wem-card-body">
        <pre class="cli-help">{{ cliHelp }}</pre>
        <div class="hint-box warn" style="margin-top: 10px">
          <WarningOutlined />
          <div>CLI 默认只读，只能查询；允许写入后，set 命令会直接写注册表并记入审计日志。离线模式不影响 CLI 本地查询。</div>
        </div>
      </div>
    </div>

    <div class="wem-card">
      <div class="wem-card-head">
        <div class="wem-card-title"><FileProtectOutlined /> 开源声明与许可</div>
      </div>
      <div class="wem-card-body">
        <p class="license-text">
          本工具基于以下开源项目构建，遵循其各自的许可协议：
        </p>
        <a-table
          class="wem-table"
          size="small"
          row-key="name"
          :data-source="licenses"
          :columns="licenseColumns"
          :pagination="false"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'name'"><span class="mono">{{ record.name }}</span></template>
            <template v-else-if="column.key === 'license'"><a-tag color="blue">{{ record.license }}</a-tag></template>
            <template v-else-if="column.key === 'url'">
              <a class="mono" @click="openExternal(record.url)">{{ record.url }}</a>
            </template>
          </template>
        </a-table>

        <div class="hint-box warn" style="margin-top: 14px">
          <WarningOutlined />
          <div>
            本程序通过系统 <span class="mono">reg.exe</span> 与 <span class="mono">PowerShell</span> 读写 Windows 注册表。
            修改环境变量会直接影响系统行为，请务必在操作前确认已有可用备份。程序作者不对因使用本工具造成的任何损失承担责任。
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import {
  CloudSyncOutlined, FolderOpenOutlined, DatabaseOutlined, InfoCircleOutlined,
  AppstoreOutlined, FileProtectOutlined, WarningOutlined, DashboardOutlined,
  NodeIndexOutlined, DatabaseOutlined as DbIcon, HistoryOutlined, ToolOutlined,
  FileTextOutlined, SafetyOutlined, PieChartOutlined, CodeOutlined, RocketOutlined
} from '@ant-design/icons-vue'
import api from '@/api'
import { useUiStore } from '@/store/ui'
import { useDevStore } from '@/store/dev'

const ui = useUiStore()
const dev = useDevStore()
const rulesCount = computed(() => dev.rules.length)
const info = ref({
  version: '—', electron: '—', chrome: '—', node: '—', v8: '—',
  platform: '—', packaged: false, exe: '—'
})
const checking = ref(false)

const cliHelp = [
  'WinEnvManager.exe --cli list [--scope user|machine]   # 列出环境变量',
  'WinEnvManager.exe --cli get PATH                      # 读取单个变量',
  'WinEnvManager.exe --cli path-check                    # 校验 PATH（json 输出）',
  'WinEnvManager.exe --cli snapshot list                 # 列出快照',
  'WinEnvManager.exe --cli set NAME VALUE [--scope machine]',
  '                                                      # 写入变量（默认只读拒绝）',
  'WinEnvManager.exe --cli help                          # 完整帮助'
].join('\n')

const features = [
  { title: '环境变量总览', desc: '用户/系统统一视图 · 僵尸变量清理', icon: DashboardOutlined },
  { title: 'PATH 专项管理', desc: '排序 / 去重 / 校验 / 条目备注', icon: NodeIndexOutlined },
  { title: '快照与差异对比', desc: '受保护快照 · 清理预览 · 归档打包', icon: HistoryOutlined },
  { title: '备份与还原', desc: '定时备份 · 加密 · 增量备份', icon: DbIcon },
  { title: '多环境配置集', desc: '一键切换 · 互斥组 · 项目独立环境', icon: AppstoreOutlined },
  { title: '开发环境管理', desc: '环境市场 · 部署 · 定时审计', icon: RocketOutlined },
  { title: '批量导入导出', desc: 'reg/json/env/properties 字段映射', icon: FileProtectOutlined },
  { title: '全局搜索与审计', desc: '跨页检索 · 修改留痕不可篡改', icon: FileTextOutlined },
  { title: '命令行 CLI', desc: 'list / get / set / path-check', icon: CodeOutlined },
  { title: '事务与便携模式', desc: '失败自动回滚 · 数据随程序走', icon: SafetyOutlined }
]

const licenses = [
  { name: 'Electron', license: 'MIT', url: 'https://github.com/electron/electron' },
  { name: 'Vue.js 3', license: 'MIT', url: 'https://github.com/vuejs/core' },
  { name: 'Ant Design Vue', license: 'MIT', url: 'https://github.com/vueComponent/ant-design-vue' },
  { name: 'Pinia', license: 'MIT', url: 'https://github.com/vuejs/pinia' },
  { name: 'Vue Router', license: 'MIT', url: 'https://github.com/vuejs/router' },
  { name: 'Vite', license: 'MIT', url: 'https://github.com/vitejs/vite' },
  { name: 'electron-builder', license: 'MIT', url: 'https://github.com/electron-userland/electron-builder' }
]

const licenseColumns = [
  { title: '项目', key: 'name', width: 200 },
  { title: '许可证', key: 'license', width: 130 },
  { title: '仓库地址', key: 'url' }
]

async function checkUpdate() {
  checking.value = true
  try {
    const res = await api.app.checkUpdate()
    if (!res.ok) {
      message.error(res.message || '检查更新失败')
      return
    }
    const d = res.data || {}
    if (!d.checked) {
      message.info(`${d.reason || '未配置更新地址'}。当前版本 ${d.current || info.value.version}`)
      ui.tip('未配置更新地址，跳过联网检查', 'info')
      return
    }
    if (d.hasUpdate) {
      message.warning(`发现新版本 ${d.latest}（当前 ${d.current}）`)
      ui.tip(`发现新版本 ${d.latest}`, 'warning')
    } else {
      message.success(`当前已是最新版本 ${d.current}`)
      ui.tip(`已是最新版本 ${d.current}`, 'success')
    }
  } finally {
    checking.value = false
  }
}

async function openProjectDir() {
  const exe = info.value.exe || ''
  if (exe && exe.includes('\\')) {
    await api.tool.showInFolder(exe)
  } else {
    message.warning('未获取到程序路径')
  }
}

async function openDataDir() {
  const res = await api.tool.envSummary()
  if (res.ok) await api.tool.openFolder(res.data.paths.config.replace(/\\config\.json$/i, ''))
}

async function openExternal(url) {
  await api.tool.openExternal(url)
}

async function openLogDir() {
  const res = await api.log.openDir()
  if (!res.ok) message.error(res.message)
}

async function checkDeps() {
  const checks = [
    { name: 'Electron 运行时', ok: !!(info.value.electron), detail: info.value.electron },
    { name: 'Chromium 渲染内核', ok: !!(info.value.chrome), detail: info.value.chrome },
    { name: 'Node.js 子进程', ok: !!(info.value.node), detail: info.value.node },
    { name: 'PowerShell 5.1+（注册表读写）', ok: true, detail: '系统内置' },
    { name: 'reg.exe（注册表导出）', ok: true, detail: '系统内置' },
    { name: 'WSL2（可选，Docker/WSL 相关功能）', ok: null, detail: '如需使用请自行安装' }
  ]
  Modal.info({
    title: '运行依赖检查',
    width: 560,
    content: checks.map((c) => `${c.ok === false ? '❌' : c.ok === null ? '⚠️' : '✅'} ${c.name} — ${c.detail}`).join('\n'),
    okText: '知道了'
  })
}

async function showStorage() {
  const res = await api.analyze.storage()
  if (!res.ok) return message.error(res.message)
  const d = res.data
  const rows = [
    ['配置与元数据', d.config],
    ['快照', d.snapshots],
    ['日志', d.logs],
    ['安装包缓存', d.cache],
    ['备份', d.backups]
  ]
  Modal.info({
    title: '软件存储占用',
    width: 600,
    content: rows
      .map(([name, s]) => `${name}：${fmtSize(s.size)}（${s.files} 个文件）\n  ${s.dir}`)
      .join('\n\n'),
    okText: '知道了'
  })
}

function fmtSize(n) {
  const v = Number(n) || 0
  if (v < 1024) return `${v} B`
  if (v < 1048576) return `${(v / 1024).toFixed(1)} KB`
  if (v < 1073741824) return `${(v / 1048576).toFixed(2)} MB`
  return `${(v / 1073741824).toFixed(2)} GB`
}

async function showRules() {
  const res = await api.rules.list()
  if (!res.ok) return message.error(res.message)
  const list = res.data.rules
  const builtin = list.filter((r) => r.builtin).length
  Modal.info({
    title: `内置识别规则库（v${res.data.ruleVersion}）`,
    width: 620,
    content: `共 ${list.length} 条规则（内置 ${builtin} 条，自定义 ${list.length - builtin} 条）\n\n` +
      list.slice(0, 25).map((r) => `· ${r.name}（${r.category}，${r.executableName}）`).join('\n') +
      (list.length > 25 ? `\n…等 ${list.length} 条，可在「程序设置 → 识别规则管理」查看全部` : ''),
    okText: '知道了'
  })
}

onMounted(async () => {
  const res = await api.app.getInfo()
  if (res.ok) info.value = res.data
})
</script>

<style scoped>
.about-hero {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 22px 24px;
}

.about-logo {
  width: 76px;
  height: 76px;
  border-radius: 16px;
  flex: 0 0 76px;
  box-shadow: var(--wem-shadow);
}

.about-meta h2 {
  margin: 0;
  font-size: 19px;
  font-weight: 600;
}

.about-sub {
  margin: 6px 0 0;
  font-size: 12.5px;
  color: var(--wem-text-3);
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 14px;
}

.feature-item {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.feature-icon {
  font-size: 17px;
  color: var(--wem-primary);
  margin-top: 2px;
}

.feature-title {
  font-size: 12.5px;
  font-weight: 600;
}

.feature-desc {
  font-size: 11.5px;
  color: var(--wem-text-3);
  margin-top: 2px;
  line-height: 1.5;
}

.license-text {
  font-size: 12.5px;
  color: var(--wem-text-2);
  margin: 0 0 10px;
}

.cli-help {
  margin: 0;
  padding: 10px 12px;
  background: var(--wem-card-alt);
  border: 1px solid var(--wem-border);
  border-radius: 8px;
  font-family: var(--wem-mono);
  font-size: var(--wem-editor-fs, 12px);
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--wem-text-1);
}
</style>
