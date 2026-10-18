<template>
  <a-config-provider :theme="themeConfig" :locale="antdLocale">
    <div class="app-shell">
      <div v-if="ui.demo" class="demo-banner">
        <WarningOutlined />
        当前处于演示数据模式（未检测到 Electron 主进程），界面展示为示例数据，实际写入操作不可用。
      </div>
      <div v-if="env.externalChanged" class="demo-banner external">
        <AlertOutlined />
        <span>检测到其他程序直接修改了注册表环境变量，草稿可能与真实系统状态不一致。</span>
        <a-button size="small" type="primary" ghost @click="reloadSystem">重新加载系统变量</a-button>
        <a-button size="small" @click="env.externalChanged = false">保留当前草稿</a-button>
      </div>
      <div v-if="env.config.portableShowHint !== false && portable" class="demo-banner portable">
        <RocketOutlined />
        <span>便携模式：数据随程序目录存储（UserData），不读取安装登记，系统级写入已禁用。</span>
      </div>

      <div class="app-body">
        <!-- 左侧导航 -->
        <aside class="app-sider" :class="{ collapsed: ui.sidebarCollapsed }">
          <div class="brand">
            <img class="brand-logo" src="/icon.png" alt="logo" />
            <div v-if="!ui.sidebarCollapsed" class="brand-text">
              <span class="brand-title">WinEnv管家</span>
              <span class="brand-sub">Windows 环境一体化管理</span>
            </div>
          </div>
          <div class="app-nav">
            <a-menu :selected-keys="selectedKeys" mode="inline" :inline-collapsed="ui.sidebarCollapsed" @click="onMenuClick">
              <a-menu-item v-for="r in menuRoutes" :key="r.path">
                <template #icon><component :is="iconMap[r.meta.icon]" /></template>
                <span>{{ r.meta.title }}</span>
              </a-menu-item>
            </a-menu>
          </div>
          <div class="sider-foot">
            <a-button type="text" size="small" block @click="ui.sidebarCollapsed = !ui.sidebarCollapsed">
              <template #icon>
                <MenuUnfoldOutlined v-if="ui.sidebarCollapsed" />
                <MenuFoldOutlined v-else />
              </template>
              <span v-if="!ui.sidebarCollapsed">收起导航</span>
            </a-button>
          </div>
        </aside>

        <!-- 主区域 -->
        <main class="app-main">
          <header class="app-header">
            <div class="app-header-title">
              <component :is="iconMap[currentMeta.icon]" />
              <span>{{ currentMeta.title }}</span>
              <span class="app-header-desc">{{ currentMeta.desc }}</span>
            </div>
            <div class="toolbar">
              <div style="width: min(360px, 100%)">
                <GlobalSearchBox :sources="searchSources" @pick="onSearchPick" />
              </div>
              <a-tooltip v-if="runningTasks" title="有后台任务正在执行">
                <a-badge :count="runningTasks" size="small" @click="$router.push('/devenv')">
                  <a-button size="small" @click="$router.push('/devenv')">
                    <template #icon><ThunderboltOutlined /></template>
                    任务
                  </a-button>
                </a-badge>
              </a-tooltip>
              <a-tooltip title="重新从注册表读取真实环境变量，未保存的修改会丢失">
                <a-button size="small" :loading="env.loading" @click="onRefresh">
                  <template #icon><ReloadOutlined /></template>
                  刷新
                </a-button>
              </a-tooltip>
              <a-tooltip title="点击直接切换：浅色 → 深色 → 跟随系统">
                <a-button size="small" class="theme-btn" @click="cycleTheme">
                  <BulbFilled v-if="ui.theme === 'dark'" />
                  <DesktopOutlined v-else-if="ui.theme === 'system'" />
                  <BulbOutlined v-else />
                  {{ themeLabel }}
                </a-button>
              </a-tooltip>
              <a-tooltip title="界面字号：点左右微调，点中间切换预设">
                <a-button-group size="small">
                  <a-button :disabled="fontSize <= FONT_MIN" @click="stepFont(-1)">A-</a-button>
                  <a-dropdown>
                    <a-button>{{ fontSize }}</a-button>
                    <template #overlay>
                      <a-menu :selected-keys="[String(fontSize)]" @click="({ key }) => setFontSize(Number(key))">
                        <a-menu-item v-for="p in FONT_PRESETS" :key="String(p.value)">{{ p.label }} · {{ p.value }}px</a-menu-item>
                      </a-menu>
                    </template>
                  </a-dropdown>
                  <a-button :disabled="fontSize >= FONT_MAX" @click="stepFont(1)">A+</a-button>
                </a-button-group>
              </a-tooltip>
              <a-button-group size="small">
                <a-tooltip title="撤销">
                  <a-button :disabled="!env.canUndo" @click="onUndo"><UndoOutlined /></a-button>
                </a-tooltip>
                <a-tooltip title="重做">
                  <a-button :disabled="!env.canRedo" @click="onRedo"><RedoOutlined /></a-button>
                </a-tooltip>
              </a-button-group>
              <a-button size="small" danger :disabled="!env.dirty" @click="onDiscard">
                <template #icon><RollbackOutlined /></template>
                放弃修改
              </a-button>
              <a-button type="primary" size="small" :disabled="!env.dirty" :loading="saving" @click="openSave">
                <template #icon><SaveOutlined /></template>
                保存写入系统<span v-if="env.pendingCount">（{{ env.pendingCount }}）</span>
              </a-button>
            </div>
          </header>

          <section class="app-content">
            <router-view v-slot="{ Component }">
              <transition name="wem-page" mode="out-in">
                <component :is="Component" :key="route.path" />
              </transition>
            </router-view>
          </section>

          <StatusBar />
        </main>
      </div>
    </div>

    <WemDialogHost />
    <StartupWizard v-model:open="wizardOpen" @finish="onWizardFinish" @skip="wizardOpen = false" />
    <GuideBubbles v-model:open="guideOpen" />

    <!-- 保存写入系统确认弹窗（含来源分组 / 前置校验 / 明细 / 附加选项） -->
    <SaveDialog :open="saveOpen" @close="saveOpen = false" @saved="onSaved" />

    <!-- 保存结果 -->
    <a-modal v-model:open="resultOpen" title="写入完成" :footer="null" width="560px">
      <a-result status="success" title="环境变量已写入系统">
        <template #subTitle>
          <div style="text-align: left">
            <p>共处理 {{ savedCount }} 项变更。</p>
            <p v-if="savedExplorer">涉及系统变量，建议重启资源管理器，让新变量立即对这些程序生效。</p>
            <p v-else>新开一个命令提示符窗口即可读取到最新变量。</p>
          </div>
        </template>
        <template #extra>
          <a-button v-if="savedExplorer || savedRestart" type="primary" :loading="reloading" @click="onReloadExplorer">
            重启资源管理器
          </a-button>
          <a-button @click="resultOpen = false">关闭</a-button>
        </template>
      </a-result>
    </a-modal>
  </a-config-provider>
</template>

<script setup>
import { computed, h, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Modal, message, theme as antTheme } from 'ant-design-vue'
import zhCN from 'ant-design-vue/es/locale/zh_CN'
import enUS from 'ant-design-vue/es/locale/en_US'
import {
  DashboardOutlined, UserOutlined, ClusterOutlined, NodeIndexOutlined, DatabaseOutlined,
  HistoryOutlined, SwapOutlined, ToolOutlined, SettingOutlined, InfoCircleOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, ReloadOutlined, UndoOutlined, RedoOutlined,
  RollbackOutlined, SaveOutlined, WarningOutlined, RocketOutlined, AppstoreOutlined,
  ThunderboltOutlined, AlertOutlined, SearchOutlined, FileSearchOutlined, FolderOpenOutlined,
  BulbOutlined, BulbFilled, DesktopOutlined,
  ApartmentOutlined, SafetyCertificateOutlined, CalendarOutlined
} from '@ant-design/icons-vue'

import StatusBar from '@/components/StatusBar.vue'
import SaveDialog from '@/components/SaveDialog.vue'
import GlobalSearchBox from '@/components/search/GlobalSearchBox.vue'
import StartupWizard from '@/components/wizard/StartupWizard.vue'
import GuideBubbles from '@/components/wizard/GuideBubbles.vue'
import WemDialogHost from '@/components/dialogs/WemDialogHost.vue'
import { useEnvStore } from '@/store/env'
import { useUiStore } from '@/store/ui'
import { useDevStore, useSetStore } from '@/store/dev'
import api from '@/api'

const env = useEnvStore()
const ui = useUiStore()
const dev = useDevStore()
const setStore = useSetStore()
const route = useRoute()
const router = useRouter()

const iconMap = {
  DashboardOutlined, UserOutlined, ClusterOutlined, NodeIndexOutlined, DatabaseOutlined,
  HistoryOutlined, SwapOutlined, ToolOutlined, SettingOutlined, InfoCircleOutlined,
  RocketOutlined, AppstoreOutlined, SearchOutlined, FileSearchOutlined, FolderOpenOutlined,
  ApartmentOutlined, SafetyCertificateOutlined, CalendarOutlined
}

const menuRoutes = router.getRoutes().filter((r) => r.meta && r.meta.title)

const META_DESC = {
  '/overview': '本机用户变量与系统变量统一视图',
  '/user': '仅影响当前用户的环境变量',
  '/system': '对所有用户生效，需管理员权限写入',
  '/path': '拆分、排序、去重与有效性校验',
  '/devenv': '环境市场 / 已安装管理 / 任务队列 / 环境审计',
  '/registry': '可视化浏览注册表，环境变量分支一键定位',
  '/registry-backup': '注册表分支备份、对比与事务化恢复',
  '/health': '扫描 PATH、引用、注册表与项目异常，预览式修复',
  '/schedules': '定时快照、注册表备份与诊断，仅备份类只读任务',
  '/envsets': '多套环境一键切换，支持互斥组与项目独立环境',
  '/projects': '项目变量只注入本次终端，不写注册表',
  '/backup': '导出 / 导入 / 自动备份管理',
  '/snapshot': '创建快照并对比环境差异',
  '/transfer': '批量导出与导入变量清单',
  '/search': '跨变量、配置集、快照、工具与日志检索',
  '/toolbox': '重启资源管理器、权限检测等实用功能',
  '/settings': '主题、草稿、开发环境、扫描、安全等选项',
  '/about': '版本信息与开源声明'
}

const themeConfig = computed(() => ({
  algorithm: ui.isDark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
  token: {
    colorPrimary: env.config.primaryColor || '#165DFF',
    colorSuccess: env.config.colorSuccess || '#00b42a',
    colorWarning: env.config.colorWarning || '#ff7d00',
    colorError: env.config.colorError || '#f53f3f',
    colorInfo: env.config.colorInfo || '#165DFF',
    borderRadius: 8,
    fontSize: Math.min(20, Math.max(12, Number(env.config.fontSize) || 13)),
    fontFamily: "'Segoe UI', 'Microsoft YaHei UI', 'PingFang SC', system-ui, sans-serif"
  }
}))

const selectedKeys = computed(() => [route.path])
const currentMeta = computed(() => ({
  ...(route.meta || {}),
  title: (route.meta && route.meta.title) || 'WinEnv管家',
  icon: (route.meta && route.meta.icon) || 'DashboardOutlined',
  desc: META_DESC[route.path] || ''
}))

const FONT_MIN = 12
const FONT_MAX = 20
const FONT_PRESETS = [
  { label: '小', value: 12 },
  { label: '标准', value: 13 },
  { label: '大', value: 15 },
  { label: '超大', value: 17 }
]
const fontSize = computed(() => {
  const n = Number(env.config.fontSize) || 13
  return Math.min(FONT_MAX, Math.max(FONT_MIN, n))
})
async function setFontSize(n) {
  const v = Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(n)))
  if (v === fontSize.value) return
  env.config.fontSize = v
  const res = await api.config.set({ fontSize: v })
  if (!res.ok) message.error(res.message || '字号保存失败')
}
function stepFont(delta) {
  setFontSize(fontSize.value + delta)
}

const runningTasks = computed(() => dev.runningTasks.length)
const portable = computed(() => !!(env.config && env.config.installPortable))

const saving = ref(false)
const reloading = ref(false)
const saveOpen = ref(false)
const resultOpen = ref(false)
const savedCount = ref(0)
const savedExplorer = ref(false)
const savedRestart = ref(false)

function actionText(a) {
  return { create: '新增', update: '修改', delete: '删除' }[a] || a
}
function actionColor(a) {
  return { create: 'green', update: 'orange', delete: 'red' }[a] || 'default'
}
function truncate(v) {
  const s = String(v ?? '')
  return s.length > 80 ? s.slice(0, 80) + '…' : s || '（空）'
}

function savedShowDashboard() {
  try {
    const raw = localStorage.getItem('wem-startup-settings')
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data || !Object.prototype.hasOwnProperty.call(data, 'showDashboard')) return null
    return data.showDashboard !== false
  } catch {
    return null
  }
}

function onMenuClick({ key }) {
  router.push(key)
}

const themeLabel = computed(() => ({ light: '浅色', dark: '深色', system: '跟随系统' }[ui.theme] || '浅色'))

function onThemePick(theme) {
  ui.setTheme(theme)
  ui.tip(theme === 'dark' ? '已切换为深色' : theme === 'system' ? '主题跟随系统' : '已切换为浅色', 'success')
}

function cycleTheme() {
  const order = ['light', 'dark', 'system']
  const next = order[(order.indexOf(ui.theme) + 1) % order.length]
  onThemePick(next)
}

/* ------------------------------ 主题 ------------------------------ */

function applyPopupChrome() {
  let form = {}
  try {
    const raw = JSON.parse(localStorage.getItem('wem-popup-settings') || '{}')
    if (raw && typeof raw === 'object') form = raw
  } catch (_) { /* 坏数据按默认弹窗样式 */ }
  const opacity = Number(form.maskOpacity)
  const mask = Number.isFinite(opacity) ? Math.min(0.8, Math.max(0.2, opacity)) : 0.45
  document.documentElement.classList.toggle('wem-no-dialog-anim', form.dialogAnim === false)
  document.documentElement.style.setProperty('--wem-mask-opacity', String(mask))
}
applyPopupChrome()

function applyThemeDom() {
  applyPopupChrome()
  const root = document.documentElement
  root.setAttribute('data-theme', ui.isDark ? 'dark' : 'light')
  root.style.setProperty('--wem-primary', env.config.primaryColor || '#165DFF')
  // 状态提示色可独立自定义（设置页 → 界面与主题）
  root.style.setProperty('--wem-success', env.config.colorSuccess || '#00b42a')
  root.style.setProperty('--wem-warning', env.config.colorWarning || '#ff7d00')
  root.style.setProperty('--wem-danger', env.config.colorError || '#f53f3f')
  root.style.setProperty('--wem-info', env.config.colorInfo || '#165DFF')
  // 代码 / 日志面板独立字号
  root.style.setProperty('--wem-editor-fs', `${Number(env.config.editorFontSize) || 12}px`)
  root.style.setProperty('--wem-log-fs', `${Number(env.config.logFontSize) || 12}px`)
  const fs = Math.min(20, Math.max(12, Number(env.config.fontSize) || 13))
  root.style.setProperty('--wem-fs', `${fs}px`)
  root.style.fontSize = `${fs}px`
  root.classList.toggle('wem-compact', !!env.config.compactMode)
  root.classList.toggle('wem-no-page-anim', env.config.animPage === false)
  root.classList.toggle('wem-no-modal-anim', env.config.animModal === false)
  root.classList.toggle('wem-no-scrollbar', env.config.animScrollbar === false)
  root.lang = env.config.language === 'en-US' ? 'en' : 'zh-CN'
}
watch(() => ui.isDark, applyThemeDom)
watch(
  () => [
    env.config.primaryColor, env.config.fontSize, env.config.compactMode,
    env.config.colorSuccess, env.config.colorWarning, env.config.colorError, env.config.colorInfo,
    env.config.editorFontSize, env.config.logFontSize,
    env.config.animPage, env.config.animModal, env.config.animScrollbar,
    env.config.language
  ],
  applyThemeDom
)

const antdLocale = computed(() => (env.config.language === 'en-US' ? enUS : zhCN))

/* ------------------------------ 动作 ------------------------------ */

function onRefresh() {
  Modal.confirm({
    title: '重新加载系统环境变量？',
    content: '将从注册表读取真实值，当前未保存的修改会全部丢失。',
    okText: '重新加载',
    cancelText: '取消',
    onOk: async () => {
      await env.load()
      ui.tip(`已重新加载 ${env.counts.total} 个环境变量`, 'success')
      message.success(`已重新加载 ${env.counts.total} 个环境变量`)
    }
  })
}

async function reloadSystem() {
  await env.load()
  env.externalChanged = false
  message.success('已重新加载系统真实环境变量')
  ui.tip('已与系统真实状态同步', 'success')
}

function onUndo() {
  if (env.undo()) ui.tip('已撤销上一步操作', 'info')
}

function onRedo() {
  if (env.redo()) ui.tip('已重做', 'info')
}

function onDiscard() {
  Modal.confirm({
    title: '放弃全部未保存修改？',
    content: '内存草稿中的改动将被丢弃，界面恢复为系统真实值。',
    okText: '放弃修改',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      await env.discard()
      ui.tip('已放弃未保存修改', 'info')
      message.info('已放弃未保存修改')
    }
  })
}

async function openSave() {
  if (!env.dirty) return
  if (env.config.confirmBeforeSave === false) {
    saving.value = true
    try {
      const sources = Object.keys(env.changeGroups)
      const res = await env.save(sources)
      if (res.ok && !res.empty) onSaved({ count: res.count, needExplorerRestart: res.needExplorerRestart, restart: env.config.autoRestartExplorerAfterSave })
      else if (!res.ok) message.error(res.message || '写入失败')
    } catch (err) {
      message.error(err.message || '写入失败')
    } finally {
      saving.value = false
    }
    return
  }
  saveOpen.value = true
}

function onSaved(payload) {
  savedCount.value = payload.count || 0
  savedExplorer.value = !!payload.needExplorerRestart
  savedRestart.value = !!payload.restart
  resultOpen.value = true
  ui.tip(`已写入系统，共 ${savedCount.value} 项变更`, 'success')
  if (payload.restart) onReloadExplorer()
}

async function onReloadExplorer() {
  reloading.value = true
  try {
    const res = await env.reloadExplorer()
    if (res.ok) {
      message.success('资源管理器已重启，环境变量已生效')
      resultOpen.value = false
    } else {
      message.error('重启资源管理器失败')
    }
  } finally {
    reloading.value = false
  }
}

/* ------------------------------ 全局搜索 / 向导 ------------------------------ */

const wizardOpen = ref(false)
const guideOpen = ref(false)
const searchSets = ref([])
const searchSnaps = ref([])
const searchTools = ref([])
const searchAudits = ref([])
const searchFavs = ref([])
const searchScheds = ref([])

const searchSources = computed(() => {
  const vars = []
  for (const scope of ['user', 'machine']) {
    const list = env.working && env.working[scope]
    if (!Array.isArray(list)) continue
    for (const item of list) {
      if (!item || item._deleted) continue
      if (!(item.name || item.title || item.key)) continue
      vars.push({
        name: item.name,
        value: item.value,
        scope: item.scope || scope,
        key: item.name
      })
    }
  }
  const scanned = dev.scanResult && Array.isArray(dev.scanResult.items) ? dev.scanResult.items : []
  return {
    vars,
    sets: searchSets.value,
    snaps: searchSnaps.value,
    tools: searchTools.value.length ? searchTools.value : scanned,
    rules: Array.isArray(dev.rules) ? dev.rules : [],
    audits: searchAudits.value,
    favs: searchFavs.value,
    scheds: searchScheds.value
  }
})

function takeApiList(res, keys) {
  if (!res || res.ok === false) return []
  const data = res.data
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object') {
    for (const k of keys) {
      if (Array.isArray(data[k])) return data[k]
    }
  }
  return []
}

function labelAudits(list) {
  return list.filter((item) => item != null).map((item) => {
    if (typeof item !== 'object') return { name: String(item) }
    if (item.name || item.title || item.key) return item
    const name = item.action || item.atText || item.id || ''
    return name ? { ...item, name: String(name), key: item.at || item.atText || String(name) } : item
  })
}

async function loadSearchExtras() {
  try {
    if (api.snapshot && typeof api.snapshot.list === 'function') {
      searchSnaps.value = takeApiList(await api.snapshot.list(), ['snapshots', 'items', 'list'])
    }
  } catch (_) { /* 失败保持空数组 */ }
  try {
    if (api.envset && typeof api.envset.list === 'function') {
      searchSets.value = takeApiList(await api.envset.list(), ['sets', 'items', 'list'])
    }
  } catch (_) { /* 失败保持空数组 */ }
  try {
    if (api.audit && typeof api.audit.list === 'function') {
      searchAudits.value = labelAudits(takeApiList(await api.audit.list(), ['items', 'list', 'audits']))
    }
  } catch (_) { /* 失败保持空数组 */ }
  try {
    const existing = dev.scanResult && Array.isArray(dev.scanResult.items) ? dev.scanResult.items : null
    if (existing) {
      searchTools.value = existing
    } else if (!dev.scanning && typeof dev.scan === 'function') {
      searchTools.value = takeApiList(await dev.scan({}), ['items', 'tools', 'list'])
    }
  } catch (_) { /* 失败保持空数组 */ }

  // 注册表收藏夹与定时任务：都是轻量列表，直接接入全局搜索。
  // 不在全局搜索里扫描整棵注册表，代价过高，账号级检索留在注册表页内做。
  try {
    if (api.regFav && typeof api.regFav.list === 'function') {
      const res = await api.regFav.list()
      const items = res && res.ok && res.data && Array.isArray(res.data.items) ? res.data.items : []
      searchFavs.value = items.map((it) => ({ name: it.name, value: it.path, key: it.id }))
    }
  } catch (_) { /* 失败保持空数组 */ }
  try {
    if (api.schedule && typeof api.schedule.list === 'function') {
      const res = await api.schedule.list()
      const list = res && res.ok && res.data && Array.isArray(res.data.tasks) ? res.data.tasks : []
      searchScheds.value = list.map((it) => ({ name: it.name, value: it.type, key: it.id }))
    }
  } catch (_) { /* 失败保持空数组 */ }
}

function onSearchPick(payload) {
  const type = payload && payload.type
  const item = payload && payload.item
  let path = '/search'
  if (type === 'vars') path = item && item.scope === 'machine' ? '/system' : '/user'
  else if (type === 'sets') path = '/envsets'
  else if (type === 'snaps') path = '/snapshot'
  else if (type === 'tools' || type === 'rules') path = '/devenv'
  else if (type === 'audits') path = '/audit'
  else if (type === 'favs') path = '/registry'
  else if (type === 'scheds') path = '/schedules'
  router.push(path)
}

function wizardClosesGuide(payload) {
  if (!payload || typeof payload !== 'object') return false
  if (payload.guide === false || payload.showGuide === false || payload.openGuide === false || payload.guideEnabled === false) return true
  if (payload.skipGuide === true || payload.closeGuide === true) return true
  return false
}

function onWizardFinish(payload) {
  const data = payload || {}
  if (data.theme) ui.setTheme(data.theme)
  try { localStorage.setItem('wem-wizard-done', '1') } catch (_) { /* 忽略写入失败 */ }
  wizardOpen.value = false
  if (wizardClosesGuide(data)) return
  let guideDone = false
  try { guideDone = !!localStorage.getItem('wem-guide-done') } catch (_) { guideDone = false }
  if (!guideDone) guideOpen.value = true
}

/* ------------------------------ 启动 ------------------------------ */

let offSystemTheme = null
let offTray = null
let offTask = null
let offExternal = null
let offProject = null
let offQuit = null
let offScheduled = null
let externalCheckTimer = null
let quitAsking = false

onMounted(async () => {
  try {
    if (!localStorage.getItem('wem-wizard-done')) wizardOpen.value = true
  } catch (_) { /* 读不到则不强制弹出 */ }
  loadSearchExtras()

  for (const r of menuRoutes) r.meta.desc = META_DESC[r.path] || ''

  const cfg = await ui.loadTheme()
  ui.toggleSystem(window.matchMedia('(prefers-color-scheme: dark)').matches)
  applyThemeDom()

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    ui.toggleSystem(e.matches)
  })

  if (api.on) {
    offSystemTheme = api.on('theme:system-changed', (mode) => ui.toggleSystem(mode === 'dark'))
    offTray = api.on('tray:action', (payload) => {
      if (payload?.type === 'backup-done') message.success(`已生成备份：${payload.file}`)
      else if (payload?.type === 'explorer-restarted') message.success('资源管理器已重启')
    })
    offTask = api.on('task:change', (task) => {
      dev.applyTaskUpdate(task)
      if (task.status === 'success' && task.result && task.result.variables && task.result.variables.length) {
        const r = env.applyTemplateVars(task.result.variables, {
          source: 'env-market',
          originId: task.id,
          originName: task.name
        })
        if (r.added.length) {
          message.success(`「${task.name}」完成，${r.added.length} 条环境变量已进入草稿区，请检查后点击「保存写入系统」`)
          ui.tip(`部署完成：${task.name}，变量已进入草稿`, 'warning')
        }
        dev.loadTasks()
      } else if (task.status === 'failed') {
        message.error(`任务失败：${task.name} — ${task.error}`)
      }
    })
    offExternal = api.on('env:external-changed', () => {
      env.externalChanged = true
      message.warning('检测到外部程序修改了注册表环境变量', 4)
    })
    offProject = api.on('envset:project-activity', (payload) => onProjectActivity(payload))
    offQuit = api.on('app:quit-query', () => askQuit())
    offScheduled = api.on('app:scheduled', (payload) => {
      if (payload?.type === 'backup') message.success(`定时备份已完成：${payload.file || ''}`)
      else if (payload?.type === 'audit') {
        Modal.warning({
          title: '定时审计发现异常',
          content: `${payload.issues} 项软件状态异常：${(payload.names || []).join('、') || '详见开发环境页'}`,
          okText: '去查看',
          onOk: () => router.push('/devenv')
        })
      } else if (payload?.type === 'update') {
        notifyUpdate(payload)
      }
    })
  }

  // 外部变更轮询兜底
  externalCheckTimer = setInterval(async () => {
    if (env.config.detectExternal === false) return
    const res = await api.analyze.externalCheck()
    if (res.ok && res.data.changed) env.externalChanged = true
  }, 30000)

  if (!cfg || cfg.config.loadOnStart !== false) {
    try {
      await env.load()
      ui.tip(`已读取 ${env.counts.total} 个环境变量（用户 ${env.counts.user} / 系统 ${env.counts.machine}）`, 'success')
      if (env.draftRestored && env.dirty) {
        message.warning(`已恢复上次未保存草稿 ${env.pendingCount} 项，确认后再写入系统`, 5)
      }
    } catch (err) {
      ui.tip(`读取环境变量失败：${err.message}`, 'error')
      message.error(`读取环境变量失败：${err.message}`)
    }
  }

  if (updateCheckDue(env.config)) checkUpdateQuiet()

  // 「启动打开总览」只有保存过才覆盖启动页。没保存时仍按程序设置里的启动页。
  const openOverview = savedShowDashboard()
  if (openOverview === true) {
    if (route.path !== '/overview') router.push('/overview').catch(() => {})
  } else {
    const startPage = env.config.startPage
    if (startPage && startPage !== '/' && startPage !== route.path && route.path === '/overview') {
      router.push(startPage).catch(() => {})
    }
  }

  // 启动时自动扫描（可关）。只加载清单不算扫描。
  if (env.config.scanOnStart !== false) {
    dev.loadCatalog().then(() => dev.scan({})).catch(() => {})
    dev.loadTasks()
  }
  if (api.envset && api.envset.syncWatch) api.envset.syncWatch().catch(() => {})
})

let projectPrompting = false

function onProjectActivity(payload) {
  if (!payload || !payload.setId || projectPrompting) return
  projectPrompting = true
  const name = payload.name || '项目配置集'
  const dir = payload.dir || '该目录'
  const modal = Modal.confirm({
    title: '进入了绑定的项目目录',
    content: h('div', [
      h('p', { style: 'margin: 0 0 8px' }, `资源管理器打开了 ${dir}。`),
      h('p', { style: 'margin: 0 0 8px' }, `可以把配置集「${name}」加载到草稿。只改草稿，不会直接写入注册表。`),
      h('button', {
        type: 'button',
        style: 'border:0;background:transparent;color:#165DFF;padding:0;cursor:pointer',
        onClick: async () => {
          const res = await api.envset.ignorePrompt(payload.setId)
          if (!res || res.ok === false) message.error((res && res.message) || '关闭提醒失败')
          else message.info(`已不再提醒「${name}」`)
          modal.destroy()
        }
      }, '不再提醒这个配置集')
    ]),
    okText: '加载到草稿',
    cancelText: '稍后',
    async onOk() {
      try {
        await setStore.load()
        const res = await setStore.loadSet(payload.setId)
        if (res.blocked) {
          message.error(res.message)
          return
        }
        if (res.pendingMutex) {
          const info = res.pendingMutex
          Modal.confirm({
            title: '检测到互斥组冲突',
            content: `互斥组「${(info.group && info.group.name) || ''}」里已有【${(info.loadedNames || []).join('、')}】在草稿中。加载「${name}」会清掉这些草稿，仍不会直接写入注册表。`,
            okText: '确认切换',
            cancelText: '取消',
            onOk: async () => {
              const r = await setStore.confirmMutexSwitch(info)
              message.success(`已切换到「${name}」：清理 ${r.removed} 条同组旧草稿，新增 ${r.added} 条`)
              ui.tip(`已加载配置集 ${name}，等待保存写入系统`, 'warning')
            }
          })
          return
        } else {
          message.success(`已加载「${name}」，${(res.added || []).length} 条变量进入草稿`)
        }
        ui.tip(`已加载配置集 ${name}，等待保存写入系统`, 'warning')
      } catch (err) {
        message.error(err.message || '加载配置集失败')
      }
    },
    afterClose() {
      projectPrompting = false
    }
  })
}

function askQuit() {
  if (quitAsking) return
  quitAsking = true
  const dirty = env.dirty
  const keep = env.config.keepDraftOnExit !== false
  Modal.confirm({
    title: dirty ? '还有未保存草稿' : '退出 WinEnv管家？',
    content: dirty
      ? (keep
        ? `当前有 ${env.pendingCount} 项修改还没写入系统。退出后会保留在本地草稿，下次启动可恢复，但不会自动写入注册表。`
        : `当前有 ${env.pendingCount} 项修改还没写入系统。按当前设置，退出后草稿不会保留。`)
      : '当前没有未保存修改。',
    okText: '继续退出',
    cancelText: '留在程序',
    okType: dirty ? 'danger' : 'primary',
    onOk: async () => {
      if (!keep) env.clearDraftCache()
      else env.persistDraft()
      await api.app.quitDecision(true)
    },
    onCancel: () => {
      quitAsking = false
      api.app.quitDecision(false)
    }
  })
}

function updateCheckDue(cfg) {
  if (!cfg || cfg.offlineMode) return false
  if (cfg.checkUpdateOnStart) return true
  const mode = cfg.updateSchedule || 'start'
  if (mode !== 'daily' && mode !== 'weekly') return false
  const last = Number(cfg.lastUpdateCheckAt) || 0
  if (!last) return true
  const span = mode === 'weekly' ? 7 * 86400000 : 86400000
  return Date.now() - last >= span
}

function notifyUpdate(data) {
  if (!data || env.config.updateNotifyPopup === false) return
  const channel = data.channel === 'pre' ? '预发布通道 ' : ''
  Modal.info({
    title: '发现新版本',
    content: `${channel}当前 ${data.current || ''}，最新 ${data.latest || ''}。${data.notes || '可在关于页再次检查。'}`,
    okText: '知道了'
  })
}

async function checkUpdateQuiet() {
  const res = await api.app.checkUpdate()
  if (!res.ok || !res.data) return
  if (!res.data.checked || !res.data.hasUpdate) return
  notifyUpdate(res.data)
}

onUnmounted(() => {
  offSystemTheme && offSystemTheme()
  offTray && offTray()
  offTask && offTask()
  offExternal && offExternal()
  offProject && offProject()
  offQuit && offQuit()
  offScheduled && offScheduled()
  if (externalCheckTimer) clearInterval(externalCheckTimer)
})

watch(
  () => route.path,
  (p) => {
    // 进入开发环境管理页自动轻量扫描
    if (p === '/devenv' && env.config.scanOnEnterPage !== false && !dev.scanResult && !dev.scanning) {
      dev.loadCatalog().then(() => dev.scan({}))
    }
  }
)
</script>

<style scoped>
.sider-foot {
  padding: 8px;
  border-top: 1px solid var(--wem-border);
}

.demo-banner.external {
  background: linear-gradient(90deg, #f53f3f, #ff7875);
}

.demo-banner.portable {
  background: linear-gradient(90deg, #722ed1, #9254de);
}

.demo-banner .ant-btn {
  margin-left: 8px;
}
</style>
