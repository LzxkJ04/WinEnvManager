<template>
  <div class="flex h-screen flex-col" :class="isDark ? 'dark' : ''">
    <div v-if="!isTauri" class="bg-amber-500 px-4 py-1 text-[12px] text-white">
      演示数据模式：未检测到 Tauri 运行环境，界面展示示例数据，写入操作不可用。
    </div>
    <div v-if="env.externalChanged" class="flex items-center gap-3 bg-red-500 px-4 py-1 text-[12px] text-white">
      <span class="flex-1">检测到其他程序直接修改了注册表环境变量，草稿可能与真实系统状态不一致。</span>
      <Button size="sm" variant="outline" class="!border-white/60 !bg-transparent !text-white" @click="reloadSystem">重新加载系统变量</Button>
      <Button size="sm" variant="outline" class="!border-white/60 !bg-transparent !text-white" @click="env.externalChanged = false">保留当前草稿</Button>
    </div>

    <div class="flex min-h-0 flex-1">
      <!-- 左侧导航 -->
      <aside class="flex w-52 flex-none flex-col border-r border-border bg-card" :class="{ 'w-16': collapsed }">
        <div class="flex items-center gap-2.5 border-b border-border px-4 py-3.5">
          <img src="/icon.png" class="h-7 w-7 flex-none rounded-lg" alt="logo" />
          <div v-if="!collapsed" class="leading-tight">
            <div class="text-[13.5px] font-semibold">WinEnv管家</div>
            <div class="text-[10.5px] text-muted-foreground">Tauri · Vue3 · shadcn</div>
          </div>
        </div>
        <nav class="flex-1 overflow-y-auto p-2">
          <router-link
            v-for="r in navRoutes"
            :key="r.path"
            :to="r.path"
            class="mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] transition-colors hover:bg-accent hover:text-accent-foreground"
            :class="route.path === r.path ? 'bg-accent font-medium text-accent-foreground' : 'text-foreground/80'"
            :title="r.meta.title"
          >
            <component :is="icons[r.meta.icon]" :size="15" class="flex-none" />
            <span v-if="!collapsed" class="truncate">{{ r.meta.title }}</span>
          </router-link>
        </nav>
        <button class="border-t border-border px-3 py-2 text-left text-[11.5px] text-muted-foreground hover:bg-accent" @click="collapsed = !collapsed">
          {{ collapsed ? '» 展开' : '« 收起导航' }}
        </button>
      </aside>

      <!-- 主区域 -->
      <main class="flex min-w-0 flex-1 flex-col">
        <header class="flex h-13 flex-none items-center justify-between gap-3 border-b border-border bg-card px-4 py-2.5">
          <div class="min-w-0">
            <div class="flex items-center gap-2 text-[14.5px] font-semibold">
              <span class="truncate">{{ route.meta.title }}</span>
              <span class="hidden truncate text-[11.5px] font-normal text-muted-foreground lg:inline">{{ route.meta.desc }}</span>
            </div>
          </div>
          <div class="flex flex-none items-center gap-1.5">
            <Badge v-if="runningTasks" tone="info">
              <button @click="$router.push('/devenv')">任务 {{ runningTasks }}</button>
            </Badge>
            <Button size="sm" variant="outline" :disabled="env.loading" @click="onRefresh"><RotateCw :size="13" /> 刷新</Button>
            <Button size="sm" variant="outline" :disabled="!env.canUndo" @click="env.undo()"><Undo2 :size="13" /></Button>
            <Button size="sm" variant="outline" :disabled="!env.canRedo" @click="env.redo()"><Redo2 :size="13" /></Button>
            <Button size="sm" variant="outline" :disabled="!env.dirty" @click="onDiscard"><UndoOutlined2 /> 放弃修改</Button>
            <Button size="sm" :disabled="!env.dirty" @click="saveOpen = true">
              <Save :size="13" /> 保存写入系统<span v-if="env.pendingCount">（{{ env.pendingCount }}）</span>
            </Button>
          </div>
        </header>

        <section class="min-h-0 flex-1 overflow-auto p-4">
          <router-view />
        </section>

        <!-- 状态栏 -->
        <footer class="flex h-8 flex-none items-center gap-4 border-t border-border bg-card px-3.5 text-[11.5px] text-muted-foreground">
          <span class="flex items-center gap-1.5">
            <i class="inline-block h-1.5 w-1.5 rounded-full" :style="{ background: env.admin ? 'var(--color-success)' : 'var(--color-warning)' }"></i>
            {{ env.admin ? '管理员权限' : '普通用户权限' }}
          </span>
          <span>变量总数 {{ env.counts.total }}（用户 {{ env.counts.user }} · 系统 {{ env.counts.machine }}）</span>
          <span :style="{ color: env.dirty ? 'var(--color-destructive)' : env.needExplorerRestart ? 'var(--color-warning)' : env.lastSavedAt ? 'var(--color-success)' : 'var(--muted-foreground)' }">
            {{ env.dirty ? `未保存修改 ${env.pendingCount} 项` : env.needExplorerRestart ? '已写入，待重启资源管理器' : env.lastSavedAt ? '已写入系统' : '尚未写入系统' }}
          </span>
          <span v-if="isDemo" class="text-amber-500">演示模式</span>
          <span class="ml-auto truncate">{{ statusTip }}</span>
        </footer>
      </main>
    </div>

    <SaveDialog v-model:open="saveOpen" @saved="onSaved" />
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  LayoutDashboard, User, Network, Route as RouteIcon, Rocket, LayoutGrid, Database,
  History, ArrowLeftRight, Wrench, Settings, Info, RotateCw, Undo2, Redo2, Save, AlertTriangle
} from 'lucide-vue-next'
import { routes } from '@/router'

// 导航菜单只显示有 meta 的路由（'/' 重定向路由无 meta）
const navRoutes = routes.filter((r) => r.meta && r.meta.title)
import Button from '@/components/ui/Button.vue'
import Badge from '@/components/ui/Badge.vue'
import SaveDialog from '@/components/SaveDialog.vue'
import { useEnvStore } from '@/store/env'
import { useDevStore } from '@/store/dev'
import api, { isDemo } from '@/api'
import { isTauri } from '@/lib/tauri'
import { buildMarkdownChangelog } from '@/lib/utils'

const icons = {
  DashboardOutlined: LayoutDashboard, UserOutlined: User, ClusterOutlined: Network,
  NodeIndexOutlined: RouteIcon, RocketOutlined: Rocket, AppstoreOutlined: LayoutGrid,
  DatabaseOutlined: Database, HistoryOutlined: History, SwapOutlined: ArrowLeftRight,
  ToolOutlined: Wrench, SettingOutlined: Settings, InfoCircleOutlined: Info
}

const env = useEnvStore()
const dev = useDevStore()
const route = useRoute()
const collapsed = ref(false)
const saveOpen = ref(false)
const statusTip = ref('就绪')

const isDark = computed(() => {
  const t = env.config.theme || 'light'
  return t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
})
watch(isDark, (v) => document.documentElement.classList.toggle('dark', v), { immediate: true })

const runningTasks = computed(() => dev.tasks.filter((t) => ['queued', 'running', 'paused'].includes(t.status)).length)

function onRefresh() {
  if (!confirm('重新加载系统环境变量？未保存的修改会全部丢失。')) return
  env.load().then(() => {
    statusTip.value = `已重新加载 ${env.counts.total} 个环境变量`
  })
}

function onDiscard() {
  if (!confirm('放弃全部未保存修改？')) return
  env.discard().then(() => (statusTip.value = '已放弃未保存修改'))
}

function onSaved(payload) {
  statusTip.value = `已写入系统，共 ${payload.count} 项变更`
  if (payload.needExplorerRestart && confirm('写入完成，是否立即重启资源管理器使环境变量生效？')) {
    env.reloadExplorer()
  }
}

onMounted(async () => {
  const cfg = await api.config.get()
  if (cfg.ok) Object.assign(env.config, cfg.data.config || {})
  try {
    await env.load()
    statusTip.value = `已读取 ${env.counts.total} 个环境变量（用户 ${env.counts.user} / 系统 ${env.counts.machine}）`
  } catch (err) {
    statusTip.value = `读取环境变量失败：${err.message}`
  }
  api.on('env:external-changed', () => (env.externalChanged = true))
  api.on('task:change', (task) => {
    dev.applyTaskUpdate(task)
    if (task.status === 'success' && task.result?.variables?.length) {
      const r = env.applyTemplateVars(task.result.variables, { source: 'env-market', originId: task.id, originName: task.name })
      if (r.added.length) statusTip.value = `「${task.name}」完成，${r.added.length} 条变量已进入草稿区`
    }
  })
  api.on('envset:project-activity', () => (statusTip.value = '检测到绑定的项目目录有变动，可加载对应项目配置集'))
  dev.loadCatalog()
  dev.loadTasks()
})
</script>
