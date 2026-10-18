<template>
  <div>
    <div class="wem-card">
      <div class="wem-card-head">
        <div class="wem-card-title"><SearchOutlined /> 全局搜索</div>
        <span class="text-muted">跨环境变量、快照、配置集、PATH 与日志检索</span>
      </div>
      <div class="wem-card-body">
        <a-input-search
          v-model:value="keyword"
          size="large"
          placeholder="输入变量名、值、快照名、配置集名或 PATH 路径…"
          allow-clear
          @search="run"
        />
        <div class="stat-grid" style="margin-top: 12px">
          <div class="stat-card"><div class="stat-label">环境变量</div><div class="stat-value">{{ hits.vars.length }}</div></div>
          <div class="stat-card"><div class="stat-label">PATH 条目</div><div class="stat-value">{{ hits.path.length }}</div></div>
          <div class="stat-card"><div class="stat-label">快照</div><div class="stat-value">{{ hits.snaps.length }}</div></div>
          <div class="stat-card"><div class="stat-label">配置集</div><div class="stat-value">{{ hits.sets.length }}</div></div>
          <div class="stat-card"><div class="stat-label">操作日志</div><div class="stat-value">{{ hits.logs.length }}</div></div>
        </div>
      </div>
    </div>

    <div v-for="group in groups" :key="group.key" class="wem-card" style="margin-top: 14px">
      <div class="wem-card-head">
        <div class="wem-card-title"><component :is="group.icon" /> {{ group.title }}（{{ group.items.length }}）</div>
      </div>
      <div class="wem-card-body">
        <WemTable
          :table-id="`search-${group.key}`"
          row-key="__k"
          :rows="group.items"
          :columns="group.columns"
          :page-size="12"
          :capabilities="searchCaps"
          empty-text="这一类没有匹配"
        >
          <template #cell="{ row, column }">
            <template v-if="column.key === 'go'">
              <a @click.stop="$router.push(row.__go)">前往</a>
            </template>
            <template v-else-if="column.key === 'scope'">
              <a-tag :color="row.scope === 'machine' ? 'purple' : 'blue'">{{ row.scope === 'machine' ? '系统' : '用户' }}</a-tag>
            </template>
            <template v-else-if="column.key === 'name'"><span class="mono">{{ row.name }}</span></template>
            <template v-else-if="column.key === 'value'"><span class="cell-value">{{ row.value }}</span></template>
          </template>
        </WemTable>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { SearchOutlined, DatabaseOutlined, NodeIndexOutlined, HistoryOutlined, AppstoreOutlined, FileTextOutlined } from '@ant-design/icons-vue'
import { useEnvStore } from '@/store/env'
import api from '@/api'
import WemTable from '@/components/wem-table/WemTable.vue'

const env = useEnvStore()
const keyword = ref('')
const snaps = ref([])
const sets = ref([])
const logs = ref([])
const searchCaps = {
  select: false,
  inline: false,
  drag: false,
  batchDelete: false,
  batchTag: false,
  batchEnable: false,
  expand: false,
  summary: false,
  contextMenu: false,
  format: false,
  presets: false
}

const varColumns = [
  { title: '归属', key: 'scope', dataIndex: 'scopeLabel', width: 90 },
  { title: '变量名', key: 'name', dataIndex: 'name', width: 220, ellipsis: true },
  { title: '值', key: 'value', dataIndex: 'value', ellipsis: true },
  { title: '', key: 'go', width: 70, sortable: false, filterable: false }
]
const snapColumns = [
  { title: '快照名', dataIndex: 'name', key: 'name', ellipsis: true },
  { title: '时间', dataIndex: 'createdAtText', key: 'time', width: 180 },
  { title: '', key: 'go', width: 70, sortable: false, filterable: false }
]
const setColumns = [
  { title: '配置集名', dataIndex: 'name', key: 'name', ellipsis: true },
  { title: '变量数', dataIndex: 'count', key: 'count', width: 100 },
  { title: '', key: 'go', width: 70, sortable: false, filterable: false }
]
const logColumns = [
  { title: '时间', dataIndex: 'atText', key: 'time', width: 180 },
  { title: '动作', dataIndex: 'name', key: 'name', width: 160 },
  { title: '涉及变量', dataIndex: 'value', key: 'value', ellipsis: true },
  { title: '', key: 'go', width: 70, sortable: false, filterable: false }
]

const hits = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  const empty = { vars: [], path: [], snaps: [], sets: [], logs: [] }
  if (!k) return empty
  const vars = ['user', 'machine'].flatMap((scope) =>
    env.working[scope]
      .filter((i) => !i._deleted && (i.name.toLowerCase().includes(k) || String(i.value || '').toLowerCase().includes(k)))
      .map((i) => ({
        ...i,
        scopeLabel: scope === 'machine' ? '系统' : '用户',
        __k: `${scope}::${i.name}`,
        __go: scope === 'machine' ? '/system' : '/user'
      }))
  )
  const path = ['user', 'machine'].flatMap((scope) =>
    env.pathItems[scope]
      .filter((i) => String(i.path || '').toLowerCase().includes(k))
      .map((i) => ({
        name: i.path,
        scope,
        scopeLabel: scope === 'machine' ? '系统' : '用户',
        value: i.disabled ? '（已禁用）' : '（启用中）',
        __k: `p::${scope}::${i.id}`,
        __go: '/path'
      }))
  )
  const sn = snaps.value
    .filter((s) => String(s.name || '').toLowerCase().includes(k) || String(s.note || '').toLowerCase().includes(k))
    .map((s) => ({ ...s, __k: `s::${s.id}`, __go: '/snapshot' }))
  const st = sets.value
    .filter((s) => String(s.name || '').toLowerCase().includes(k))
    .map((s) => ({ ...s, __k: `c::${s.id}`, __go: '/envsets' }))
  const lg = logs.value
    .map((row, index) => {
      const names = (row.items || []).map((item) => item.name).filter(Boolean).join('、')
      return {
        ...row,
        name: row.action || '记录',
        value: names || '—',
        atText: row.atText || '',
        __k: `a::${row.at || index}::${row.action || ''}`,
        __go: '/audit',
        _blob: `${row.atText || ''} ${row.action || ''} ${row.origin || ''} ${names}`.toLowerCase()
      }
    })
    .filter((row) => row._blob.includes(k))
  return { vars, path, sn, st, snaps: sn, sets: st, logs: lg }
})

const groups = computed(() => {
  const h = hits.value
  const out = []
  if (h.vars.length) out.push({ key: 'vars', title: '环境变量', icon: DatabaseOutlined, items: h.vars, columns: varColumns })
  if (h.path.length) out.push({ key: 'path', title: 'PATH 条目', icon: NodeIndexOutlined, items: h.path, columns: varColumns })
  if (h.snaps.length) out.push({ key: 'snaps', title: '快照', icon: HistoryOutlined, items: h.snaps, columns: snapColumns })
  if (h.sets.length) out.push({ key: 'sets', title: '配置集', icon: AppstoreOutlined, items: h.sets, columns: setColumns })
  if (h.logs.length) out.push({ key: 'logs', title: '操作日志', icon: FileTextOutlined, items: h.logs, columns: logColumns })
  return out
})

async function loadSources() {
  try {
    const s = await api.snapshot.list()
    if (s.ok) snaps.value = s.data || []
  } catch { /* 快照列表失败时仍可搜当前环境 */ }
  try {
    const c = await api.envset.list()
    if (c.ok) sets.value = (c.data && (c.data.items || c.data)) || []
  } catch { /* 配置集列表失败时忽略 */ }
  try {
    const a = await api.audit.list(300)
    if (a.ok) logs.value = (a.data && (a.data.items || a.data)) || []
  } catch { /* 日志读取失败时忽略 */ }
}

async function run() {
  await loadSources()
}

onMounted(loadSources)
</script>
