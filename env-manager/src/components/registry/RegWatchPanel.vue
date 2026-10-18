<template>
  <a-tabs v-model:activeKey="tab" size="small" class="reg-watch">
    <a-tab-pane key="watch" tab="监听列表">
      <div class="toolbar" style="margin-bottom: 10px">
        <a-input
          v-model:value="newPath"
          size="small"
          class="mono"
          style="width: 420px"
          placeholder="HKCU\Environment"
        />
        <a-input-number v-model:value="interval" size="small" :min="1" :max="600" style="width: 110px" />
        <span class="text-muted">秒</span>
        <a-button type="primary" size="small" :loading="adding" @click="addWatcher">
          <template #icon><PlusOutlined /></template>
          添加监听
        </a-button>
        <a-button size="small" :disabled="!selectedPath" @click="fillCurrent">填入当前分支</a-button>
        <a-button size="small" :loading="loading" @click="loadWatchers">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
      </div>

      <WemTable
        table-id="reg-watch-list"
        row-key="path"
        :rows="watcherRows"
        :columns="watcherColumns"
        :page-size="5"
        :capabilities="tableCaps"
        empty-text="还没有添加监听路径"
      >
        <template #cell="{ row, column }">
          <template v-if="column.key === 'path'">
            <span class="mono cell-path" :title="row.path">{{ row.path }}</span>
            <div v-if="row.lastError" class="err-text">{{ row.lastError }}</div>
          </template>
          <template v-else-if="column.key === 'running'">
            <a-tag :color="row.running ? 'green' : 'default'">{{ row.running ? '监听中' : '已暂停' }}</a-tag>
          </template>
          <template v-else-if="column.key === 'interval'">
            <span class="text-muted">{{ Math.round((row.interval || 3000) / 1000) }} 秒</span>
          </template>
          <template v-else-if="column.key === 'count'">
            <span class="mono">{{ row.eventCount || 0 }}</span>
          </template>
          <template v-else-if="column.key === 'actions'">
            <a-space size="small">
              <a v-if="row.running" @click="stopWatcher(row)">暂停</a>
              <a v-else @click="startWatcher(row)">启动</a>
              <a @click="filterByPath(row.path)">查看日志</a>
              <a class="danger-link" @click="removeWatcher(row)">移除</a>
            </a-space>
          </template>
        </template>
      </WemTable>
    </a-tab-pane>

    <a-tab-pane key="logs" tab="监控日志">
      <div class="toolbar" style="margin-bottom: 10px">
        <a-tag v-if="logFilter" closable color="blue" @close="logFilter = ''">路径：{{ logFilter }}</a-tag>
        <a-button size="small" :loading="loadingLogs" @click="loadLogs">
          <template #icon><ReloadOutlined /></template>
          刷新日志
        </a-button>
        <a-button size="small" @click="exportLogs('csv')">导出 CSV</a-button>
        <a-button size="small" @click="exportLogs('json')">导出 JSON</a-button>
        <a-button size="small" danger @click="clearLogs">清空日志</a-button>
        <span class="text-muted">最多展示最近 500 条，外部改动会实时追加</span>
      </div>

      <WemTable
        table-id="reg-watch-logs"
        row-key="__key"
        :rows="logRows"
        :columns="logColumns"
        :page-size="8"
        :capabilities="tableCaps"
        :row-class="logRowClass"
        empty-text="暂无监控记录（添加监听并产生变更后才会写入日志）"
      >
        <template #cell="{ row, column }">
          <template v-if="column.key === 'atText'"><span class="text-muted">{{ row.atText }}</span></template>
          <template v-else-if="column.key === 'path'">
            <span class="mono cell-path" :title="row.path">{{ row.path }}</span>
          </template>
          <template v-else-if="column.key === 'changeType'">
            <a-tag :color="changeColor(row.changeType)">{{ changeLabel(row.changeType) }}</a-tag>
          </template>
          <template v-else-if="column.key === 'name'">
            <span class="mono">{{ row.name || '(默认)' }}</span>
          </template>
          <template v-else-if="column.key === 'oldValue'">
            <span class="mono cell-path" :title="row.oldValue">{{ clip(row.oldValue) }}</span>
          </template>
          <template v-else-if="column.key === 'newValue'">
            <span class="mono cell-path" :title="row.newValue">{{ clip(row.newValue) }}</span>
          </template>
          <template v-else-if="column.key === 'origin'">
            <a-tag :color="row.origin === 'WinEnv管家' ? 'blue' : 'orange'">{{ row.origin }}</a-tag>
          </template>
        </template>
      </WemTable>
    </a-tab-pane>
  </a-tabs>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons-vue'
import api from '@/api'
import WemTable from '@/components/wem-table/WemTable.vue'
import { confirmDanger } from '@/components/registry/confirmDanger'

const props = defineProps({
  currentPath: { type: String, default: '' }
})

const emit = defineEmits(['external-change'])

const tab = ref('watch')
const loading = ref(false)
const loadingLogs = ref(false)
const adding = ref(false)
const watchers = ref([])
const logs = ref([])
const newPath = ref('')
const interval = ref(3)
const logFilter = ref('')
const selectedPath = computed(() => props.currentPath)

const tableCaps = {
  inline: false,
  drag: false,
  sort: false,
  summary: false,
  select: false,
  batchDelete: false,
  batchTag: false,
  batchEnable: false,
  contextMenu: false,
  export: false,
  filter: false
}

const watcherColumns = [
  { title: '监听路径', key: 'path', dataIndex: 'path', ellipsis: true },
  { title: '状态', key: 'running', dataIndex: 'running', width: 90 },
  { title: '轮询间隔', key: 'interval', dataIndex: 'interval', width: 100 },
  { title: '捕获次数', key: 'count', dataIndex: 'eventCount', width: 96 },
  { title: '操作', key: 'actions', dataIndex: 'actions', width: 200 }
]

const logColumns = [
  { title: '时间', key: 'atText', dataIndex: 'atText', width: 170 },
  { title: '路径', key: 'path', dataIndex: 'path', ellipsis: true },
  { title: '变更类型', key: 'changeType', dataIndex: 'changeType', width: 100 },
  { title: '键名', key: 'name', dataIndex: 'name', width: 150, ellipsis: true },
  { title: '旧值', key: 'oldValue', dataIndex: 'oldValue', ellipsis: true },
  { title: '新值', key: 'newValue', dataIndex: 'newValue', ellipsis: true },
  { title: '来源', key: 'origin', dataIndex: 'origin', width: 110 }
]

const watcherRows = computed(() => watchers.value || [])
const logRows = computed(() => (logs.value || []).map((row, i) => ({ ...row, __key: `log-${i}` })))

function clip(text) {
  const s = String(text == null ? '' : text)
  return s.length > 60 ? `${s.slice(0, 60)}…` : (s || '—')
}

function changeLabel(type) {
  if (type === 'added') return '新增'
  if (type === 'modified') return '修改'
  if (type === 'deleted') return '删除'
  return type || '未知'
}

function changeColor(type) {
  if (type === 'added') return 'green'
  if (type === 'modified') return 'orange'
  if (type === 'deleted') return 'red'
  return 'default'
}

function logRowClass(row) {
  if (row.changeType === 'added') return 'row-added'
  if (row.changeType === 'deleted') return 'row-removed'
  if (row.changeType === 'modified') return 'row-modified'
  return ''
}

async function loadWatchers() {
  loading.value = true
  try {
    const res = await api.regWatch.list()
    if (!res.ok) {
      message.error(res.message)
      return
    }
    watchers.value = (res.data && res.data.watchers) || []
  } finally {
    loading.value = false
  }
}

async function loadLogs() {
  loadingLogs.value = true
  try {
    const res = await api.regWatch.logs({ limit: 500, path: logFilter.value || undefined })
    if (!res.ok) {
      message.error(res.message)
      return
    }
    logs.value = (res.data && res.data.rows) || []
  } finally {
    loadingLogs.value = false
  }
}

function fillCurrent() {
  if (!props.currentPath) {
    message.info('请先在左侧树中选择一个注册表分支')
    return
  }
  newPath.value = props.currentPath
}

async function addWatcher() {
  const path = (newPath.value || props.currentPath || '').trim()
  if (!path) {
    message.warning('请填写要监听的注册表路径')
    return
  }
  adding.value = true
  try {
    const res = await api.regWatch.add({
      path,
      interval: Math.max(1, Number(interval.value) || 3) * 1000,
      watchValues: true
    })
    if (!res.ok) {
      message.error(res.message)
      return
    }
    message.success(`已开始监听 ${res.data.path}`)
    newPath.value = ''
    await loadWatchers()
  } finally {
    adding.value = false
  }
}

async function startWatcher(row) {
  const res = await api.regWatch.start({ path: row.path })
  if (!res.ok) {
    message.error(res.message)
    return
  }
  message.success('监听已启动')
  await loadWatchers()
}

async function stopWatcher(row) {
  const res = await api.regWatch.stop({ path: row.path })
  if (!res.ok) {
    message.error(res.message)
    return
  }
  message.success('监听已暂停')
  await loadWatchers()
}

async function removeWatcher(row) {
  const ok = await confirmDanger({
    title: '⚠️ 移除注册表监听',
    warning: `将停止并移除对 ${row.path} 的监听，已产生的监控日志会保留。`,
    hint: '移除后如需继续观察该分支，需要重新添加监听。'
  })
  if (!ok) return
  const res = await api.regWatch.remove({ path: row.path })
  if (!res.ok) {
    message.error(res.message)
    return
  }
  message.success('监听已移除')
  await loadWatchers()
}

function filterByPath(path) {
  logFilter.value = path
  tab.value = 'logs'
  loadLogs()
}

async function clearLogs() {
  const ok = await confirmDanger({
    title: '⚠️ 清空监控日志',
    warning: '将删除全部监控日志文件，历史变更记录无法恢复。',
    hint: '监听配置不受影响。'
  })
  if (!ok) return
  const res = await api.regWatch.clearLogs()
  if (!res.ok) {
    message.error(res.message)
    return
  }
  message.success(`已清空 ${res.data.removed || 0} 个日志文件`)
  logs.value = []
}

async function exportLogs(format) {
  const res = await api.regWatch.exportLogs({ format })
  if (!res.ok) {
    message.error(res.message)
    return
  }
  if (!res.data || !res.data.file) return
  message.success(`已导出 ${res.data.count || 0} 条日志`)
}

let off = null

onMounted(async () => {
  await loadWatchers()
  await loadLogs()
  if (window.envAPI && typeof window.envAPI.on === 'function') {
    off = window.envAPI.on('reg:external-changed', (payload) => {
      emit('external-change', payload)
      if (tab.value === 'logs') loadLogs()
    })
  }
})

onBeforeUnmount(() => {
  if (typeof off === 'function') off()
})

defineExpose({ loadWatchers, loadLogs, reload: () => { loadWatchers(); loadLogs() } })
</script>

<style scoped>
.reg-watch {
  padding: 0 2px;
}

.err-text {
  font-size: 11px;
  color: var(--wem-danger);
  margin-top: 2px;
}

.danger-link {
  color: var(--wem-danger);
}
</style>
