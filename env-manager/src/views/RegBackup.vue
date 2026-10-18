<template>
  <div>
    <div class="wem-card">
      <div class="wem-card-head">
        <div class="wem-card-title">
          <DatabaseOutlined />
          <span>注册表备份管理</span>
          <a-tag color="blue">{{ backups.length }} 个备份</a-tag>
          <a-tag v-if="protectedCount" color="green">{{ protectedCount }} 个受保护</a-tag>
        </div>
        <div class="toolbar">
          <a-button size="small" :loading="loading" @click="loadList">
            <template #icon><ReloadOutlined /></template>
            刷新
          </a-button>
          <a-button size="small" @click="openBackupDir">
            <template #icon><FolderOpenOutlined /></template>
            打开备份目录
          </a-button>
          <a-button type="primary" size="small" :disabled="selectedKeys.length !== 2" @click="compareTwo">
            <template #icon><DiffOutlined /></template>
            对比选中备份
          </a-button>
          <a-button size="small" :disabled="selectedKeys.length !== 1" @click="openCompareCurrent">
            <template #icon><SwapOutlined /></template>
            与当前状态对比
          </a-button>
          <a-button size="small" danger :disabled="!selectedKeys.length" @click="batchDelete">
            <template #icon><DeleteOutlined /></template>
            批量删除{{ selectedKeys.length ? `（${selectedKeys.length}）` : '' }}
          </a-button>
        </div>
      </div>

      <div class="wem-card-body tight">
        <div class="toolbar" style="margin-bottom: 8px; flex-wrap: wrap">
          <a-tag color="green">JSON 格式带 SHA256 完整性校验</a-tag>
          <a-tag color="orange">.reg 格式可被系统注册表编辑器直接导入</a-tag>
          <span class="text-muted">受保护备份不会被批量删除与自动清理</span>
        </div>

        <WemTable
          ref="backupTable"
          table-id="reg-backup-list"
          row-key="id"
          :rows="backupRows"
          :columns="columns"
          :loading="loading"
          :error="error"
          :page-size="10"
          :capabilities="caps"
          empty-text="还没有注册表备份，可在注册表页面点击「备份当前分支」创建"
          @selection-change="(keys) => (selectedKeys = keys)"
          @retry="loadList"
        >
          <template #cell="{ row, column }">
            <template v-if="column.key === 'name'">
              <span class="cell-name">{{ row.name }}</span>
              <a-tag v-if="row.protected" color="green" style="margin-left: 6px">受保护</a-tag>
              <a-tag v-if="row.truncated" color="orange" style="margin-left: 6px">已截断</a-tag>
              <div v-if="row.note" class="note-text" :title="row.note">{{ row.note }}</div>
            </template>
            <template v-else-if="column.key === 'path'">
              <span class="mono cell-path" :title="row.path">{{ row.path || '（未知分支）' }}</span>
              <div class="text-muted sub-text">{{ row.keyCount || 0 }} 个注册表项</div>
            </template>
            <template v-else-if="column.key === 'format'">
              <a-tag :color="row.format === 'json' ? 'blue' : 'orange'">
                {{ row.format === 'json' ? 'JSON' : '.reg' }}
              </a-tag>
            </template>
            <template v-else-if="column.key === 'createdAtText'">
              <span class="text-muted">{{ row.createdAtText }}</span>
            </template>
            <template v-else-if="column.key === 'size'">
              <span class="mono">{{ formatBytes(row.size) }}</span>
            </template>
            <template v-else-if="column.key === 'sha256'">
              <a-tooltip :title="row.sha256 || '无校验值'">
                <span class="mono sha-text">{{ shortSha(row.sha256) }}</span>
              </a-tooltip>
              <a v-if="row.sha256" style="margin-left: 6px" @click.stop="copyText(row.sha256)">复制</a>
            </template>
            <template v-else-if="column.key === 'tags'">
              <div class="cell-tags">
                <a-tag v-for="t in row.tags || []" :key="t" color="geekblue">{{ t }}</a-tag>
                <span v-if="!(row.tags || []).length" class="text-muted">—</span>
              </div>
            </template>
            <template v-else-if="column.key === 'protected'">
              <a-tag :color="row.protected ? 'green' : 'default'">{{ row.protected ? '已保护' : '未保护' }}</a-tag>
            </template>
            <template v-else-if="column.key === 'actions'">
              <a-space size="small">
                <a @click.stop="previewBackup(row)">预览</a>
                <a @click.stop="exportBackup(row)">导出</a>
                <a @click.stop="startRestore(row)">恢复</a>
                <a @click.stop="toggleProtect(row)">{{ row.protected ? '取消保护' : '标记保护' }}</a>
                <a class="danger-link" @click.stop="removeBackup(row)">删除</a>
              </a-space>
            </template>
          </template>
        </WemTable>
      </div>
    </div>

    <!-- ===================== 预览备份内容 ===================== -->
    <a-modal
      v-model:open="previewOpen"
      :title="`备份预览 · ${previewMeta?.name || ''}`"
      width="960px"
      :footer="null"
      :force-render="true"
    >
      <a-spin :spinning="previewLoading">
        <div v-if="previewMeta" class="kv-list" style="margin-bottom: 12px">
          <span class="kv-key">注册表路径</span><span class="kv-val mono">{{ previewMeta.path || '（未知）' }}</span>
          <span class="kv-key">备份格式</span><span class="kv-val">{{ previewMeta.format === 'reg' ? '.reg 原生' : 'JSON（带校验）' }}</span>
          <span class="kv-key">创建时间</span><span class="kv-val">{{ previewMeta.createdAtText }}</span>
          <span class="kv-key">SHA256</span><span class="kv-val mono sha-full">{{ previewMeta.sha256 || '—' }}</span>
          <span class="kv-key">规模</span>
          <span class="kv-val">
            {{ previewSummary.keyCount }} 个项 · {{ previewSummary.valueCount }} 个键值
          </span>
        </div>

        <div v-if="previewTotal > previewNodes.length" class="hint-box warn" style="margin-bottom: 10px">
          <WarningOutlined />
          <div>备份共 {{ previewTotal }} 个注册表项，预览仅展示前 {{ previewNodes.length }} 个。</div>
        </div>

        <WemTable
          table-id="reg-backup-preview"
          row-key="__key"
          :rows="previewRows"
          :columns="previewColumns"
          :page-size="8"
          :capabilities="previewCaps"
          empty-text="该备份没有键值数据"
        >
          <template #cell="{ row, column }">
            <template v-if="column.key === 'path'">
              <span class="mono cell-path" :title="row.path">{{ row.path }}</span>
            </template>
            <template v-else-if="column.key === 'name'">
              <span class="mono">{{ row.name || '(默认)' }}</span>
            </template>
            <template v-else-if="column.key === 'value'">
              <span class="mono cell-path" :title="row.value">{{ clip(row.value) }}</span>
            </template>
          </template>
        </WemTable>
      </a-spin>
    </a-modal>

    <!-- ===================== 恢复：两阶段 ===================== -->
    <a-modal
      v-model:open="restoreOpen"
      title="恢复注册表备份"
      width="900px"
      :footer="null"
      :mask-closable="false"
      :force-render="true"
    >
      <div class="hint-box warn" style="margin-bottom: 10px">
        <WarningOutlined />
        <div>
          恢复前会读取当前分支并与备份逐项比对，只写入有差异的键值。
          执行时会自动生成一份恢复前临时备份，写入失败自动回滚。
        </div>
      </div>

      <div v-if="restoreMeta" class="kv-list" style="margin-bottom: 12px">
        <span class="kv-key">备份名称</span><span class="kv-val">{{ restoreMeta.name }}</span>
        <span class="kv-key">注册表路径</span><span class="kv-val mono">{{ restoreMeta.path }}</span>
        <span class="kv-key">备份时间</span><span class="kv-val">{{ restoreMeta.createdAtText }}</span>
      </div>

      <a-spin :spinning="dryRunning">
        <div class="stat-grid" style="margin-bottom: 10px">
          <div class="stat-card">
            <div class="stat-label">差异总数</div>
            <div class="stat-value">{{ restoreSummary.total }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">将新建</div>
            <div class="stat-value" style="color: #00b42a">{{ restoreSummary.create }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">将覆盖</div>
            <div class="stat-value" style="color: #ff7d00">{{ restoreSummary.update }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">将删除</div>
            <div class="stat-value" style="color: #f53f3f">{{ restoreSummary.delete }}</div>
          </div>
        </div>

        <div v-if="restoreSummary.skippedDeletes" class="hint-box warn" style="margin-bottom: 10px">
          <InfoCircleOutlined />
          <div>该备份创建时被截断，无法判断哪些键值是备份后新增的，因此本次恢复不会删除任何键值。</div>
        </div>

        <WemTable
          table-id="reg-backup-restore"
          row-key="__key"
          :rows="restoreRows"
          :columns="restoreColumns"
          :page-size="8"
          :capabilities="previewCaps"
          :row-class="restoreRowClass"
          empty-text="当前分支与备份完全一致，无需恢复"
        >
          <template #cell="{ row, column }">
            <template v-if="column.key === 'action'">
              <a-tag :color="actionColor(row.action)">{{ actionLabel(row.action) }}</a-tag>
            </template>
            <template v-else-if="column.key === 'path'">
              <span class="mono cell-path" :title="row.path">{{ row.path }}</span>
            </template>
            <template v-else-if="column.key === 'name'">
              <span class="mono">{{ row.name || '(默认)' }}</span>
            </template>
            <template v-else-if="column.key === 'before'">
              <span class="mono cell-path diff-value-old" :title="row.before">{{ clip(row.before) }}</span>
            </template>
            <template v-else-if="column.key === 'after'">
              <span class="mono cell-path diff-value-new" :title="row.after">{{ clip(row.after) }}</span>
            </template>
          </template>
        </WemTable>
      </a-spin>

      <div class="toolbar" style="justify-content: flex-end; margin-top: 14px">
        <a-button @click="restoreOpen = false">取消</a-button>
        <a-button
          type="primary"
          danger
          :disabled="dryRunning || !restoreSummary.total"
          :loading="restoring"
          @click="confirmRestore"
        >
          执行恢复（{{ restoreSummary.total }} 项）
        </a-button>
      </div>
    </a-modal>

    <!-- ===================== 对比结果 ===================== -->
    <a-modal v-model:open="diffOpen" title="注册表备份对比" width="1080px" :footer="null" :force-render="true">
      <a-spin :spinning="diffLoading">
        <div v-if="diffData" class="diff-wrap">
          <div class="diff-head-card">
            <div class="diff-side">
              <div class="diff-side-label">对比源 A（基准）</div>
              <div class="diff-side-name">{{ diffData.a.name }}</div>
              <div class="diff-side-path mono" :title="diffData.a.path">{{ diffData.a.path }}</div>
              <div class="diff-side-time text-muted">{{ timeText(diffData.a.createdAt) }}</div>
            </div>
            <div class="diff-arrow"><SwapRightOutlined /></div>
            <div class="diff-side">
              <div class="diff-side-label">对比源 B（目标）</div>
              <div class="diff-side-name">{{ diffData.b.name }}</div>
              <div class="diff-side-path mono" :title="diffData.b.path">{{ diffData.b.path }}</div>
              <div class="diff-side-time text-muted">{{ timeText(diffData.b.createdAt) }}</div>
            </div>
          </div>

          <div class="stat-grid" style="margin-bottom: 12px">
            <div class="stat-card">
              <div class="stat-label">差异总数</div>
              <div class="stat-value">{{ diffStats.total }}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">新增</div>
              <div class="stat-value" style="color: #00b42a">{{ diffStats.added }}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">修改</div>
              <div class="stat-value" style="color: #ff7d00">{{ diffStats.modified }}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">删除</div>
              <div class="stat-value" style="color: #f53f3f">{{ diffStats.deleted }}</div>
            </div>
          </div>

          <div class="toolbar" style="margin-bottom: 10px">
            <a-checkbox :checked="true" disabled>仅显示变更项</a-checkbox>
            <span class="text-muted" style="font-size: 11.5px">（对比结果本身只包含有差异的键值）</span>
            <a-radio-group v-model:value="diffFilter.kind" size="small" button-style="solid">
              <a-radio-button value="all">全部</a-radio-button>
              <a-radio-button value="value">仅键值变更</a-radio-button>
              <a-radio-button value="structure">仅结构变更</a-radio-button>
            </a-radio-group>
            <span class="text-muted">新增＝绿，修改＝黄，删除＝红</span>
          </div>

          <WemTable
            table-id="reg-diff"
            row-key="__key"
            :rows="diffRows"
            :columns="diffColumns"
            :page-size="10"
            :capabilities="diffCaps"
            :row-class="diffRowClass"
            empty-text="两个备份之间没有差异"
          >
            <template #cell="{ row, column }">
              <template v-if="column.key === 'changeType'">
                <a-tag :color="changeColor(row.changeType)">{{ changeLabel(row.changeType) }}</a-tag>
              </template>
              <template v-else-if="column.key === 'path'">
                <span class="mono cell-path" :title="row.path">{{ row.path }}</span>
              </template>
              <template v-else-if="column.key === 'name'">
                <span class="mono">{{ row.name || '(默认)' }}</span>
              </template>
              <template v-else-if="column.key === 'type'">
                <span class="mono">{{ row.type }}</span>
                <a-tag v-if="row.binaryChanged" color="purple" style="margin-left: 4px">二进制变化</a-tag>
              </template>
              <template v-else-if="column.key === 'oldValue'">
                <span class="mono cell-path diff-value-old" :title="row.oldValue">{{ clip(row.oldValue) }}</span>
              </template>
              <template v-else-if="column.key === 'newValue'">
                <span class="mono cell-path diff-value-new" :title="row.newValue">{{ clip(row.newValue) }}</span>
              </template>
            </template>
          </WemTable>

          <div class="toolbar" style="justify-content: flex-end; margin-top: 14px">
            <a-dropdown>
              <a-button :loading="reportLoading">
                <template #icon><FileTextOutlined /></template>
                导出差异报告
              </a-button>
              <template #overlay>
                <a-menu @click="({ key }) => exportReport(key)">
                  <a-menu-item key="html">导出 HTML 报告</a-menu-item>
                  <a-menu-item key="csv">导出 CSV 表格</a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
            <a-button :loading="rollbackLoading" @click="buildRollback">
              <template #icon><RollbackOutlined /></template>
              一键生成回滚任务
            </a-button>
          </div>
        </div>
      </a-spin>
    </a-modal>

    <!-- ===================== 与当前状态对比：选路径 ===================== -->
    <a-modal
      v-model:open="currentOpen"
      title="与当前注册表状态对比"
      ok-text="开始对比"
      cancel-text="取消"
      :confirm-loading="diffLoading"
      @ok="runCompareWithCurrent"
    >
      <a-form layout="vertical" style="margin-top: 6px">
        <a-form-item label="备份">
          <a-select v-model:value="currentForm.id" placeholder="选择备份">
            <a-select-option v-for="item in backups" :key="item.id" :value="item.id">
              {{ item.name }}（{{ item.createdAtText }}）
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="对比的当前注册表路径">
          <a-input v-model:value="currentForm.path" class="mono" placeholder="留空则使用备份内记录的路径" />
          <div class="field-hint">留空时按备份元数据里的注册表路径读取当前值。</div>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- ===================== 回滚任务结果 ===================== -->
    <a-modal v-model:open="rollbackOpen" title="回滚任务" width="760px" :footer="null">
      <div class="hint-box" style="margin-bottom: 10px">
        <InfoCircleOutlined />
        <div>
          已生成 {{ rollbackRows.length }} 条反向恢复指令（新增项→删除，删除项→重建，修改项→还原旧值）。
          可据此在「导入 REG」或备份恢复中执行回滚。
        </div>
      </div>
      <div class="toolbar" style="margin-bottom: 8px">
        <a-button size="small" @click="copyRollback">复制回滚清单</a-button>
        <span class="text-muted">动作说明：delete＝从当前注册表移除，create＝按备份值重建，update＝还原为旧值</span>
      </div>
      <div class="path-list mono">
        <div v-for="(row, i) in rollbackRows.slice(0, 300)" :key="i">
          [{{ row.action }}] {{ row.path }}{{ row.name ? '\\' + row.name : ' (默认)' }}
          <span class="text-muted">= {{ clip(row.value) }}</span>
        </div>
        <div v-if="rollbackRows.length > 300" class="text-muted">…共 {{ rollbackRows.length }} 条</div>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { message } from 'ant-design-vue'
import {
  DatabaseOutlined, ReloadOutlined, FolderOpenOutlined, DiffOutlined, DeleteOutlined,
  SwapOutlined, SwapRightOutlined, WarningOutlined, InfoCircleOutlined,
  FileTextOutlined, RollbackOutlined
} from '@ant-design/icons-vue'
import api from '@/api'
import WemTable from '@/components/wem-table/WemTable.vue'
import { confirmDanger } from '@/components/registry/confirmDanger'
import { useUiStore } from '@/store/ui'

const ui = useUiStore()

const backups = ref([])
const loading = ref(false)
const error = ref('')
const selectedKeys = ref([])
const backupTable = ref(null)

const caps = {
  inline: false,
  drag: false,
  sort: true,
  summary: false,
  select: true,
  batchDelete: false,
  batchTag: false,
  batchEnable: false,
  contextMenu: false,
  export: false
}

const previewCaps = {
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

const columns = [
  { title: '名称', key: 'name', dataIndex: 'name', width: 230, ellipsis: true },
  { title: '注册表路径', key: 'path', dataIndex: 'path', width: 280, ellipsis: true },
  { title: '格式', key: 'format', dataIndex: 'format', width: 86 },
  { title: '创建时间', key: 'createdAtText', dataIndex: 'createdAtText', width: 165 },
  { title: '大小', key: 'size', dataIndex: 'size', width: 90 },
  { title: 'SHA256', key: 'sha256', dataIndex: 'sha256', width: 150 },
  { title: '标签', key: 'tags', dataIndex: 'tags', width: 140 },
  { title: '保护', key: 'protected', dataIndex: 'protected', width: 80 },
  { title: '操作', key: 'actions', dataIndex: 'actions', width: 250, fixed: 'right', sortable: false, filterable: false }
]

const backupRows = computed(() => (backups.value || []).map((row) => ({ ...row, __key: row.id })))
const protectedCount = computed(() => backups.value.filter((b) => b.protected).length)

function shortSha(sha) {
  const s = String(sha || '')
  if (!s) return '—'
  return `${s.slice(0, 10)}…${s.slice(-4)}`
}

function formatBytes(n) {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = Number(n) || 0
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  return `${Math.round(value * 10) / 10} ${units[i]}`
}

function timeText(ms) {
  const n = Number(ms) || 0
  if (!n) return '—'
  const d = new Date(n)
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function clip(text) {
  const s = String(text == null ? '' : text)
  return s.length > 80 ? `${s.slice(0, 80)}…` : (s || '—')
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(String(text || ''))
    message.success('已复制到剪贴板')
  } catch {
    message.warning('复制失败，请手动选择复制')
  }
}

async function loadList() {
  loading.value = true
  error.value = ''
  try {
    const res = await api.regBackup.list()
    if (!res.ok) {
      error.value = res.message
      message.error(res.message)
      return
    }
    backups.value = res.data || []
    selectedKeys.value = []
    backupTable.value?.clearSelection()
  } finally {
    loading.value = false
  }
}

async function openBackupDir() {
  const res = await api.regBackup.openDir()
  if (!res.ok) message.error(res.message)
}

/* ------------------------------ 预览 ------------------------------ */

const previewOpen = ref(false)
const previewLoading = ref(false)
const previewMeta = ref(null)
const previewNodes = ref([])
const previewTotal = ref(0)
const previewSummary = reactive({ keyCount: 0, valueCount: 0 })

const previewColumns = [
  { title: '注册表路径', key: 'path', dataIndex: 'path', ellipsis: true },
  { title: '键名', key: 'name', dataIndex: 'name', width: 180, ellipsis: true },
  { title: '类型', key: 'type', dataIndex: 'type', width: 130 },
  { title: '值', key: 'value', dataIndex: 'value', ellipsis: true }
]

const previewRows = computed(() => {
  const rows = []
  for (const node of previewNodes.value) {
    const values = (node.values || [])
    if (!values.length) {
      rows.push({ __key: `k-${rows.length}`, path: node.path, name: '', type: '', value: '（仅注册表项，无键值）' })
      continue
    }
    for (const v of values) {
      rows.push({
        __key: `v-${rows.length}`,
        path: node.path,
        name: v.name,
        type: v.type,
        value: v.type === 'REG_BINARY' ? (v.binary || v.value) : v.value
      })
    }
  }
  return rows
})

async function previewBackup(row) {
  previewOpen.value = true
  previewLoading.value = true
  previewMeta.value = null
  previewNodes.value = []
  previewTotal.value = 0
  try {
    const res = await api.regBackup.preview({ id: row.id })
    if (!res.ok) {
      message.error(res.message)
      return
    }
    const data = res.data || {}
    previewMeta.value = { ...(data.meta || {}), format: (data.meta && data.meta.format) || row.format }
    previewNodes.value = data.nodes || []
    previewTotal.value = Number(data.total) || previewNodes.value.length
    const summary = data.summary || {}
    previewSummary.keyCount = Number(summary.keyCount) || previewTotal.value
    previewSummary.valueCount = Number(summary.valueCount) || 0
  } finally {
    previewLoading.value = false
  }
}

/* ------------------------------ 导出 / 保护 / 删除 ------------------------------ */

async function exportBackup(row) {
  const res = await api.regBackup.exportFile({ id: row.id })
  if (!res.ok) {
    message.error(res.message)
    return
  }
  if (!res.data || !res.data.file) return
  message.success(`已导出到 ${res.data.file}`)
  ui.tip(`注册表备份已导出：${res.data.file}`, 'success')
}

async function toggleProtect(row) {
  const next = !row.protected
  const res = await api.regBackup.toggleProtect({ id: row.id, protected: next })
  if (!res.ok) {
    message.error(res.message)
    return
  }
  row.protected = next
  message.success(next ? '已标记为受保护，批量删除与自动清理会跳过该备份' : '已取消保护')
}

async function removeBackup(row) {
  if (row.protected) {
    message.warning('该备份已受保护，请先取消保护再删除')
    return
  }
  const ok = await confirmDanger({
    title: '⚠️ 删除注册表备份',
    warning: '删除后该备份文件将从磁盘移除，无法再用于恢复。',
    content: `${row.name}（${row.createdAtText}）`,
    hint: '受保护的备份不会被删除，需先取消保护。',
    rows: [{ 名称: row.name, 路径: row.path || '', 格式: row.format }],
    columns: [
      { title: '名称', dataIndex: '名称', key: '名称', width: 200, ellipsis: true },
      { title: '路径', dataIndex: '路径', key: '路径', ellipsis: true },
      { title: '格式', dataIndex: '格式', key: '格式', width: 90 }
    ]
  })
  if (!ok) return
  const res = await api.regBackup.remove([row.id])
  if (!res.ok) {
    message.error(res.message)
    return
  }
  const removed = (res.data && res.data.removed) || 0
  const skipped = (res.data && res.data.skipped) || []
  if (removed) message.success(`已删除 ${removed} 个备份`)
  if (skipped.length) message.warning(`跳过 ${skipped.length} 个：${skipped.map((s) => s.reason).join('，')}`)
  await loadList()
}

async function batchDelete() {
  const picked = backups.value.filter((b) => selectedKeys.value.includes(b.id))
  if (!picked.length) return
  const removable = picked.filter((b) => !b.protected)
  if (!removable.length) {
    message.warning('选中的备份全部受保护，无法删除')
    return
  }
  const ok = await confirmDanger({
    title: '⚠️ 批量删除注册表备份',
    warning: `将删除 ${removable.length} 个备份文件，从磁盘移除后无法恢复。`,
    content: picked.length !== removable.length
      ? `所选 ${picked.length} 个备份中有 ${picked.length - removable.length} 个受保护，将自动跳过。`
      : '',
    hint: '删除前请确认这些备份不再需要用于回滚。',
    rows: removable.map((b) => ({ 名称: b.name, 路径: b.path || '', 时间: b.createdAtText })),
    columns: [
      { title: '名称', dataIndex: '名称', key: '名称', width: 220, ellipsis: true },
      { title: '路径', dataIndex: '路径', key: '路径', ellipsis: true },
      { title: '时间', dataIndex: '时间', key: '时间', width: 165 }
    ]
  })
  if (!ok) return
  const res = await api.regBackup.remove(removable.map((b) => b.id))
  if (!res.ok) {
    message.error(res.message)
    return
  }
  const removed = (res.data && res.data.removed) || 0
  const skipped = (res.data && res.data.skipped) || []
  message.success(`已删除 ${removed} 个备份${skipped.length ? `，跳过 ${skipped.length} 个` : ''}`)
  await loadList()
}

/* ------------------------------ 恢复（两阶段） ------------------------------ */

const restoreOpen = ref(false)
const restoreMeta = ref(null)
const restoreTarget = ref(null)
const dryRunning = ref(false)
const restoring = ref(false)
const restoreChanges = ref([])
const restoreSummary = reactive({ create: 0, update: 0, delete: 0, total: 0, skippedDeletes: false })

const restoreColumns = [
  { title: '动作', key: 'action', dataIndex: 'action', width: 90 },
  { title: '注册表路径', key: 'path', dataIndex: 'path', ellipsis: true },
  { title: '键名', key: 'name', dataIndex: 'name', width: 160, ellipsis: true },
  { title: '当前值', key: 'before', dataIndex: 'before', ellipsis: true },
  { title: '恢复为', key: 'after', dataIndex: 'after', ellipsis: true }
]

const restoreRows = computed(() => restoreChanges.value.map((row, i) => ({ ...row, __key: `rs-${i}` })))

function actionLabel(action) {
  if (action === 'create') return '新建'
  if (action === 'update') return '覆盖'
  if (action === 'delete') return '删除'
  return action
}

function actionColor(action) {
  if (action === 'create') return 'green'
  if (action === 'update') return 'orange'
  if (action === 'delete') return 'red'
  return 'default'
}

function restoreRowClass(row) {
  if (row.action === 'create') return 'row-added'
  if (row.action === 'delete') return 'row-removed'
  if (row.action === 'update') return 'row-modified'
  return ''
}

async function startRestore(row) {
  restoreTarget.value = row
  restoreMeta.value = row
  restoreChanges.value = []
  restoreSummary.create = 0
  restoreSummary.update = 0
  restoreSummary.delete = 0
  restoreSummary.total = 0
  restoreSummary.skippedDeletes = false
  restoreOpen.value = true
  dryRunning.value = true
  try {
    const res = await api.regBackup.restore({ id: row.id, dryRun: true })
    if (!res.ok) {
      message.error(res.message)
      restoreOpen.value = false
      return
    }
    const data = res.data || {}
    restoreChanges.value = data.changes || []
    const s = data.summary || {}
    restoreSummary.create = Number(s.create) || 0
    restoreSummary.update = Number(s.update) || 0
    restoreSummary.delete = Number(s.delete) || 0
    restoreSummary.total = Number(s.total) || restoreChanges.value.length
    restoreSummary.skippedDeletes = !!s.skippedDeletes
  } finally {
    dryRunning.value = false
  }
}

async function confirmRestore() {
  const target = restoreTarget.value
  if (!target) return
  if (!restoreSummary.total) {
    message.info('当前分支与备份一致，无需恢复')
    return
  }
  const ok = await confirmDanger({
    title: '⚠️ 注册表修改高危警告',
    warning:
      '修改 Windows 注册表可能造成程序异常、系统无法启动等严重问题，' +
      '强烈建议在修改前先对该注册表分支创建注册表备份。',
    content: `即将把「${target.path}」恢复为备份「${target.name}」中的状态，` +
      `共 ${restoreSummary.total} 项变更（新建 ${restoreSummary.create} · 覆盖 ${restoreSummary.update} · 删除 ${restoreSummary.delete}）。` +
      '执行前会自动生成恢复前临时备份，写入失败自动回滚。',
    hint: '删除类变更会把备份中不存在的键值从当前注册表移除，请仔细核对。',
    rows: restoreChanges.value.slice(0, 200).map((row) => ({
      动作: actionLabel(row.action),
      路径: row.path,
      键名: row.name || '(默认)',
      当前值: row.before,
      恢复为: row.after
    })),
    columns: [
      { title: '动作', dataIndex: '动作', key: '动作', width: 80 },
      { title: '路径', dataIndex: '路径', key: '路径', ellipsis: true },
      { title: '键名', dataIndex: '键名', key: '键名', width: 140, ellipsis: true },
      { title: '当前值', dataIndex: '当前值', key: '当前值', ellipsis: true },
      { title: '恢复为', dataIndex: '恢复为', key: '恢复为', ellipsis: true }
    ]
  })
  if (!ok) return

  restoring.value = true
  try {
    const res = await api.regBackup.restore({ id: target.id })
    if (!res.ok) {
      message.error(res.message)
      return
    }
    const applied = (res.data && res.data.applied) || 0
    restoreOpen.value = false
    message.success(`已回滚 ${applied} 项`)
    ui.tip(`注册表备份恢复完成，已回滚 ${applied} 项`, 'success')
    await loadList()
  } finally {
    restoring.value = false
  }
}

/* ------------------------------ 对比 ------------------------------ */

const diffOpen = ref(false)
const diffLoading = ref(false)
const diffData = ref(null)
const diffFilter = reactive({ kind: 'all' })

const diffCaps = {
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

const diffColumns = [
  { title: '变更', key: 'changeType', dataIndex: 'changeType', width: 90 },
  { title: '注册表路径', key: 'path', dataIndex: 'path', ellipsis: true },
  { title: '键名', key: 'name', dataIndex: 'name', width: 150, ellipsis: true },
  { title: '类型', key: 'type', dataIndex: 'type', width: 180 },
  { title: '旧值（A）', key: 'oldValue', dataIndex: 'oldValue', ellipsis: true },
  { title: '新值（B）', key: 'newValue', dataIndex: 'newValue', ellipsis: true }
]

const diffStats = computed(() => {
  const s = (diffData.value && diffData.value.stats) || {}
  return {
    added: Number(s.added) || 0,
    modified: Number(s.modified) || 0,
    deleted: Number(s.deleted) || 0,
    total: Number(s.total) || 0
  }
})

const diffRows = computed(() => {
  const rows = (diffData.value && diffData.value.rows) || []
  const kind = diffFilter.kind
  // 后端只返回有差异的键值；「仅键值变更」= 修改类，「仅结构变更」= 新增 / 删除
  const filtered = rows.filter((row) => {
    if (kind === 'value') return row.changeType === 'modified'
    if (kind === 'structure') return row.changeType === 'added' || row.changeType === 'deleted'
    return true
  })
  return filtered.map((row, i) => ({ ...row, __key: `df-${i}` }))
})

function changeLabel(type) {
  if (type === 'added') return '新增'
  if (type === 'modified') return '修改'
  if (type === 'deleted') return '删除'
  return type || '—'
}

function changeColor(type) {
  if (type === 'added') return 'green'
  if (type === 'modified') return 'orange'
  if (type === 'deleted') return 'red'
  return 'default'
}

/**
 * 行背景色。WemTable 的 rowClass 只接类名，
 * 这里复用 main.css 里已定义的 diff-row-* 配色（绿 / 黄 / 红）。
 */
function diffRowClass(row) {
  if (row.changeType === 'added') return 'diff-row-added'
  if (row.changeType === 'deleted') return 'diff-row-removed'
  if (row.changeType === 'modified') return 'diff-row-changed'
  return ''
}

async function compareTwo() {
  if (selectedKeys.value.length !== 2) {
    message.warning('请勾选两个备份进行对比')
    return
  }
  const [aId, bId] = selectedKeys.value
  diffOpen.value = true
  diffLoading.value = true
  diffData.value = null
  try {
    const res = await api.regDiff.compare({ aId, bId })
    if (!res.ok) {
      message.error(res.message)
      diffOpen.value = false
      return
    }
    diffData.value = res.data
  } finally {
    diffLoading.value = false
  }
}

const currentOpen = ref(false)
const currentForm = reactive({ id: undefined, path: '' })

function openCompareCurrent() {
  const id = selectedKeys.value[0]
  if (!id) {
    message.warning('请先勾选一个备份')
    return
  }
  const row = backups.value.find((b) => b.id === id)
  currentForm.id = id
  currentForm.path = (row && row.path) || ''
  currentOpen.value = true
}

async function runCompareWithCurrent() {
  if (!currentForm.id) {
    message.warning('请选择备份')
    return
  }
  diffOpen.value = true
  diffLoading.value = true
  diffData.value = null
  currentOpen.value = false
  try {
    const res = await api.regDiff.compareWithCurrent({
      id: currentForm.id,
      path: currentForm.path || undefined
    })
    if (!res.ok) {
      message.error(res.message)
      return
    }
    diffData.value = res.data
  } finally {
    diffLoading.value = false
  }
}

const reportLoading = ref(false)

async function exportReport(format) {
  if (!diffData.value) return
  reportLoading.value = true
  try {
    const res = await api.regDiff.exportReport({
      rows: diffRows.value.map(({ __key, ...rest }) => rest),
      format,
      labels: {
        a: diffData.value.a.name,
        b: diffData.value.b.name
      }
    })
    if (!res.ok) {
      message.error(res.message)
      return
    }
    if (!res.data || !res.data.file) return
    message.success(`差异报告已导出：${res.data.file}`)
    ui.tip(`对比报告已导出（${format.toUpperCase()}）`, 'success')
  } finally {
    reportLoading.value = false
  }
}

const rollbackOpen = ref(false)
const rollbackLoading = ref(false)
const rollbackRows = ref([])

async function buildRollback() {
  if (!diffData.value) return
  rollbackLoading.value = true
  try {
    const res = await api.regDiff.buildRollback({ rows: diffRows.value.map(({ __key, ...rest }) => rest) })
    if (!res.ok) {
      message.error(res.message)
      return
    }
    rollbackRows.value = (res.data && res.data.rows) || []
    if (!rollbackRows.value.length) {
      message.info('没有可回滚的差异行')
      return
    }
    rollbackOpen.value = true
  } finally {
    rollbackLoading.value = false
  }
}

async function copyRollback() {
  const text = rollbackRows.value
    .map((row) => {
      const name = row.name ? '\\' + row.name : ' (默认)'
      return `[${row.action}] ${row.path}${name} = ${row.value || ''}`
    })
    .join('\r\n')
  await copyText(text)
}

onMounted(loadList)
</script>

<style scoped>
.note-text {
  font-size: 11px;
  color: var(--wem-text-3);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sub-text {
  font-size: 11px;
  margin-top: 2px;
}

.sha-text {
  font-size: 11.5px;
  color: var(--wem-text-2);
}

.sha-full {
  word-break: break-all;
}

.danger-link {
  color: var(--wem-danger);
}

.field-hint {
  font-size: 11.5px;
  color: var(--wem-text-3);
  margin-top: 4px;
  line-height: 1.5;
}

.diff-head-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 40px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  padding: 12px 14px;
  border: 1px solid var(--wem-border);
  border-radius: 10px;
  background: var(--wem-card-alt);
  margin-bottom: 12px;
}

.diff-side {
  min-width: 0;
}

.diff-side-label {
  font-size: 11px;
  color: var(--wem-text-3);
}

.diff-side-name {
  font-weight: 600;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diff-side-path {
  font-size: 11.5px;
  color: var(--wem-text-2);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diff-side-time {
  font-size: 11px;
  margin-top: 2px;
}

.diff-arrow {
  text-align: center;
  color: var(--wem-primary);
  font-size: 18px;
}

.path-list {
  max-height: 320px;
  overflow: auto;
  font-size: 11.5px;
  line-height: 1.9;
  word-break: break-all;
  padding: 8px 10px;
  border: 1px solid var(--wem-border);
  border-radius: 8px;
  background: var(--wem-card-alt);
}

</style>

<!-- 对比表格在弹窗里（Teleport 到 body），scoped + :deep 匹配不到，因此用全局样式 -->
<style>
tr.diff-row-added > td {
  background: rgba(0, 180, 42, 0.12) !important;
}

tr.diff-row-modified > td,
tr.diff-row-changed > td {
  background: rgba(255, 125, 0, 0.12) !important;
}

tr.diff-row-removed > td {
  background: rgba(245, 63, 63, 0.12) !important;
}
</style>
