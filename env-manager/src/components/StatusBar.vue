<template>
  <footer class="status-bar">
    <!-- 权限状态 -->
    <span class="status-item">
      <i class="status-dot" :style="{ background: env.admin ? 'var(--wem-success)' : 'var(--wem-warning)' }"></i>
      <span>{{ env.admin ? '管理员权限' : '普通用户权限' }}</span>
    </span>

    <!-- 变量总数 -->
    <span class="status-item">
      <DatabaseOutlined />
      <span>变量总数 {{ env.counts.total }}</span>
      <span class="text-muted">（用户 {{ env.counts.user }} · 系统 {{ env.counts.machine }}）</span>
    </span>

    <!-- 未保存修改 / 写入状态：红色=未保存，绿色=已写入，黄色=需重启资源管理器 -->
    <span class="status-item" :style="{ color: saveColor }">
      <i class="status-dot" :style="{ background: saveColor }"></i>
      <span>{{ saveLabel }}</span>
    </span>

    <span v-if="env.config.showPathCount !== false" class="status-item">
      <span>PATH {{ pathCount }} 条</span>
      <span class="text-muted">（用户 {{ pathUser }} · 系统 {{ pathMachine }}）</span>
    </span>

    <span v-if="!env.admin" class="status-item text-muted">
      <LockOutlined />
      <span>系统变量只读</span>
    </span>

    <span v-if="ui.demo" class="status-item" style="color: var(--wem-warning)">
      <ExperimentOutlined />
      <span>演示模式</span>
    </span>

    <!-- 操作提示 -->
    <span class="status-tip" :title="ui.statusTip">
      <span :style="{ color: tipColor }">{{ tipIcon }} {{ ui.statusTip }}</span>
    </span>
  </footer>
</template>

<script setup>
import { computed } from 'vue'
import { DatabaseOutlined, LockOutlined, ExperimentOutlined } from '@ant-design/icons-vue'
import { useEnvStore } from '@/store/env'
import { useUiStore } from '@/store/ui'

const env = useEnvStore()
const ui = useUiStore()

const pathUser = computed(() => (env.pathItems.user || []).filter((i) => !i.disabled).length)
const pathMachine = computed(() => (env.pathItems.machine || []).filter((i) => !i.disabled).length)
const pathCount = computed(() => pathUser.value + pathMachine.value)

const saveColor = computed(() => {
  if (env.dirty) return 'var(--wem-danger)'             // 红色：存在未保存修改
  if (env.needExplorerRestart) return 'var(--wem-warning)' // 黄色：需重启资源管理器生效
  if (env.lastSavedAt) return 'var(--wem-success)'      // 绿色：已写入系统
  return 'var(--wem-text-3)'
})

const saveLabel = computed(() => {
  if (env.dirty) return `未保存修改 ${env.pendingCount} 项`
  if (env.needExplorerRestart) return '已写入，待重启资源管理器'
  if (env.lastSavedAt) return `已写入系统 ${fmt(env.lastSavedAt)}`
  return '尚未写入系统'
})

const tipColor = computed(
  () => ({ info: 'var(--wem-text-2)', success: 'var(--wem-success)', warning: 'var(--wem-warning)', error: 'var(--wem-danger)' }[ui.statusTipType] || 'var(--wem-text-2)')
)

const tipIcon = computed(
  () => ({ info: '·', success: '✓', warning: '!', error: '×' }[ui.statusTipType] || '·')
)

function fmt(ts) {
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
</script>
