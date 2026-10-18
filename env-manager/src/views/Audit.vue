<template>
  <div>
    <div class="wem-card">
      <div class="wem-card-head">
        <div class="wem-card-title"><FileSearchOutlined /> 变更审计面板</div>
        <div class="toolbar">
          <a-button size="small" @click="openDir">打开审计目录</a-button>
          <a-button size="small" :disabled="!filtered.length" @click="exportCsv">导出 CSV</a-button>
          <a-button size="small" @click="load">刷新</a-button>
        </div>
      </div>
      <div class="wem-card-body">
        <div class="hint-box" style="margin-bottom: 12px">
          <InfoCircleOutlined />
          <div>
            审计日志按月记录在数据目录 <span class="mono">audit\</span> 下，只记录「写入系统」的操作：
            时间、来源、变更前后值。软件内不提供删除入口，防止篡改记录。
          </div>
        </div>
        <div class="toolbar" style="margin-bottom: 10px">
          <span class="text-muted">来源：</span>
          <a-radio-group v-model:value="fOrigin" size="small" button-style="solid">
            <a-radio-button value="all">全部</a-radio-button>
            <a-radio-button value="GUI">GUI</a-radio-button>
            <a-radio-button value="CLI">CLI</a-radio-button>
          </a-radio-group>
          <span class="text-muted" style="margin-left: 10px">动作：</span>
          <a-select v-model:value="fAction" size="small" style="width: 160px">
            <a-select-option value="all">全部动作</a-select-option>
            <a-select-option value="applyChanges">批量写入</a-select-option>
            <a-select-option value="registryCreateKey">注册表：新建项</a-select-option>
            <a-select-option value="registryEditValue">注册表：编辑键值</a-select-option>
            <a-select-option value="registryDeleteValue">注册表：删除键值</a-select-option>
            <a-select-option value="registryDeleteKey">注册表：删除项</a-select-option>
            <a-select-option value="registryBackup">注册表：分支备份</a-select-option>
            <a-select-option value="registryRestore">注册表：备份恢复</a-select-option>
            <a-select-option value="registryImportReg">注册表：导入 REG</a-select-option>
            <a-select-option value="registryExportReg">注册表：导出 REG</a-select-option>
            <a-select-option value="registryCompare">注册表：执行对比</a-select-option>
            <a-select-option value="registryBatchReplace">注册表：批量替换</a-select-option>
            <a-select-option value="registryDependency">注册表：依赖分析</a-select-option>
            <a-select-option value="configPackExport">配置：导出配置包</a-select-option>
            <a-select-option value="configPackImport">配置：导入配置包</a-select-option>
            <a-select-option value="healthScan">诊断：执行扫描</a-select-option>
            <a-select-option value="healthFix">诊断：执行修复</a-select-option>
            <a-select-option value="scheduleRun">定时任务：触发执行</a-select-option>
          </a-select>
          <a-input-search v-model:value="fText" size="small" style="width: 220px" placeholder="按变量名过滤" allow-clear />
        </div>
        <WemTable
          table-id="audit-log"
          row-key="__key"
          :rows="auditRows"
          :columns="columns"
          :page-size="15"
          :capabilities="auditCaps"
          empty-text="还没有审计记录"
          @row-dblclick="openDetail"
          @retry="load"
        >
          <template #cell="{ row, column }">
            <template v-if="column.key === 'origin'">
              <a-tag :color="row.origin === 'CLI' ? 'purple' : 'blue'">{{ row.origin || 'GUI' }}</a-tag>
            </template>
            <template v-else-if="column.key === 'count'">{{ row.count }} 项</template>
            <template v-else-if="column.key === 'vars'">
              <span class="mono" style="font-size:12px">{{ row.varsText }}</span>
            </template>
          </template>
          <template #expand="{ row }">
            <div v-for="(item, index) in row.items || []" :key="`${item.name}-${index}`" class="mono" style="padding:2px 0">
              [{{ item.scope === 'machine' ? '系统' : '用户' }}] {{ item.name }}：{{ item.before || '（空）' }} → {{ item.after || '（空）' }}
            </div>
            <div v-if="!(row.items || []).length" class="text-muted">这条记录没有变量明细</div>
          </template>
        </WemTable>
      </div>
    </div>

    <a-modal v-model:open="detailOpen" title="变更明细" width="720px" :footer="null">
      <a-table
        size="small"
        :data-source="detailItems"
        :columns="detailColumns"
        :pagination="{ pageSize: 10, size: 'small' }"
        row-key="name"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'scope'">
            <a-tag :color="record.scope === 'machine' ? 'purple' : 'blue'">{{ record.scope === 'machine' ? '系统' : '用户' }}</a-tag>
          </template>
          <template v-else-if="column.key === 'ok'">
            <a-tag :color="record.ok ? 'green' : 'red'">{{ record.ok ? '成功' : '失败' }}</a-tag>
          </template>
        </template>
      </a-table>
    </a-modal>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import { FileSearchOutlined, InfoCircleOutlined } from '@ant-design/icons-vue'
import api from '@/api'
import WemTable from '@/components/wem-table/WemTable.vue'

const items = ref([])
const dir = ref('')
const fOrigin = ref('all')
const fAction = ref('all')
const fText = ref('')
const detailOpen = ref(false)
const detailItems = ref([])

const auditCaps = {
  inline: false,
  drag: false,
  batchDelete: false,
  batchTag: false,
  batchEnable: false,
  expand: true,
  summary: false
}

const columns = [
  { title: '时间', dataIndex: 'atText', key: 'atText', width: 180 },
  { title: '来源', dataIndex: 'origin', key: 'origin', width: 90 },
  { title: '动作', dataIndex: 'action', key: 'action', width: 140 },
  { title: '变更数', dataIndex: 'count', key: 'count', width: 90, type: 'number' },
  { title: '涉及变量', dataIndex: 'varsText', key: 'vars', ellipsis: true, sortable: false }
]

const detailColumns = [
  { title: '归属', key: 'scope', width: 80 },
  { title: '变量名', dataIndex: 'name', key: 'name' },
  { title: '原值', dataIndex: 'before', key: 'before', ellipsis: true },
  { title: '新值', dataIndex: 'after', key: 'after', ellipsis: true },
  { title: '结果', key: 'ok', width: 80 }
]

/**
 * 统一把审计记录的 items 规整成数组。
 * 环境变量类记录是 [{name,scope,before,after,ok}]；
 * 注册表 / 配置包 / 诊断类记录写的是对象（如 { path, name, keyCount }），
 * 直接 map 会抛「xxx is not a function」。
 */
function normItems(raw) {
  if (Array.isArray(raw)) return raw.filter((i) => i && typeof i === 'object')
  if (raw && typeof raw === 'object') {
    // 对象形态：转成单条明细，键值对拍平成 name/value 便于表格展示
    if (raw.name || raw.path || raw.file) return [raw]
    const pairs = Object.entries(raw)
      .filter(([, v]) => v !== undefined && v !== null && typeof v !== 'object')
      .map(([k, v]) => ({ name: k, before: '', after: String(v) }))
    return pairs
  }
  if (typeof raw === 'string' && raw.trim()) return [{ name: raw }]
  return []
}

const filtered = computed(() =>
  items.value.filter((r) => {
    if (fOrigin.value !== 'all' && (r.origin || 'GUI') !== fOrigin.value) return false
    if (fAction.value !== 'all' && r.action !== fAction.value) return false
    if (fText.value.trim()) {
      const k = fText.value.trim().toLowerCase()
      const names = normItems(r.items).map((i) => String(i.name || '')).join(' ')
      if (!names.toLowerCase().includes(k)) return false
    }
    return true
  })
)

const auditRows = computed(() =>
  filtered.value.map((row, index) => {
    const names = normItems(row.items).map((item) => item.name).filter(Boolean)
    return {
      ...row,
      __key: `${row.at || 'audit'}-${index}`,
      origin: row.origin || 'GUI',
      varsText: names.slice(0, 8).join('、') + (names.length > 8 ? ' …' : '')
    }
  })
)

function openDetail(row) {
  detailItems.value = normItems(row && row.items)
  detailOpen.value = true
}

async function load() {
  const res = await api.audit.list(800)
  if (res.ok) {
    items.value = res.data.items || []
    dir.value = res.data.dir || ''
  } else {
    message.error(res.message)
  }
}

async function openDir() {
  const res = await api.audit.openDir()
  if (!res.ok) message.error(res.message)
}

function exportCsv() {
  const rows = [['时间', '来源', '动作', '变量名', '归属', '原值', '新值', '结果']]
  for (const r of filtered.value) {
    const list = normItems(r.items)
    if (!list.length) {
      // 注册表 / 配置包类记录没有变量明细，仍导出该行，避免丢失审计记录
      rows.push([r.atText, r.origin || 'GUI', r.action, '', '', '', r.message || '', r.ok === false ? '失败' : '成功'])
      continue
    }
    for (const i of list) {
      rows.push([r.atText, r.origin || 'GUI', r.action, i.name, i.scope, i.before, i.after, i.ok ? '成功' : '失败'])
    }
  }
  const csv = '\uFEFF' + rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `audit-${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
  message.success('审计记录已导出 CSV')
}

onMounted(load)
</script>
