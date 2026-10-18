<template>
  <div>
    <!-- ==================== 顶部仪表盘 ==================== -->
    <div class="wem-card">
      <div class="wem-card-head">
        <div class="wem-card-title"><SafetyCertificateOutlined /> 环境健康诊断中心</div>
        <div class="toolbar">
          <span class="text-muted">{{ lastScanText }}</span>
          <a-dropdown :disabled="!result">
            <a-button size="small" :disabled="!result">
              导出报告
              <template #icon><DownloadOutlined /></template>
            </a-button>
            <template #overlay>
              <a-menu @click="({ key }) => exportReport(key)">
                <a-menu-item key="html">导出 HTML 报告</a-menu-item>
                <a-menu-item key="markdown">导出 Markdown 报告</a-menu-item>
              </a-menu>
            </template>
          </a-dropdown>
          <a-button size="small" :disabled="!result" @click="saveBaseline">保存本次扫描基线</a-button>
          <a-button type="primary" size="small" :loading="scanning" @click="scan(true)">
            <template #icon><ScanOutlined /></template>
            {{ scanning ? '扫描中…' : '开始扫描' }}
          </a-button>
        </div>
      </div>
      <div class="wem-card-body">
        <div class="dash">
          <div class="ring">
            <a-progress
              type="circle"
              :percent="ringPercent"
              :size="136"
              :stroke-width="9"
              :stroke-color="scoreColor"
              :trail-color="'rgba(134, 144, 156, 0.22)'"
              :format="() => ''"
            />
            <div class="ring-inner">
              <div class="ring-score" :style="{ color: scoreColor }">{{ scoreText }}</div>
              <div class="ring-label">健康得分</div>
            </div>
          </div>

          <div class="dash-right">
            <div class="mini-grid">
              <div class="mini" :class="{ on: stats.critical > 0 }">
                <div class="mini-label"><span class="dot" style="background: #f53f3f" />严重</div>
                <div class="mini-value" :style="{ color: stats.critical ? '#f53f3f' : 'var(--wem-text)' }">{{ stats.critical }}</div>
                <div class="mini-extra">需尽快处理</div>
              </div>
              <div class="mini" :class="{ on: stats.warning > 0 }">
                <div class="mini-label"><span class="dot" style="background: #ff7d00" />警告</div>
                <div class="mini-value" :style="{ color: stats.warning ? '#ff7d00' : 'var(--wem-text)' }">{{ stats.warning }}</div>
                <div class="mini-extra">建议修复</div>
              </div>
              <div class="mini">
                <div class="mini-label"><span class="dot" style="background: #165dff" />提示</div>
                <div class="mini-value" style="color: #165dff">{{ stats.info }}</div>
                <div class="mini-extra">优化项</div>
              </div>
              <div class="mini">
                <div class="mini-label"><span class="dot" style="background: #00b42a" />可自动修复</div>
                <div class="mini-value" style="color: #00b42a">{{ fixableCount }}</div>
                <div class="mini-extra">在本页直接执行</div>
              </div>
            </div>

            <div v-if="scanning" class="scan-box">
              <a-progress :percent="100" status="active" :show-info="false" size="small" />
              <div class="scan-text">正在检查 PATH 重复与失效目录、%变量% 引用完整性、循环引用、键值类型、配置集互斥组…</div>
            </div>
            <div v-else class="dash-tip">
              <InfoCircleOutlined />
              <div>
                诊断只读取系统状态，不会修改环境变量。修复前会先展示变更清单，并在执行前自动备份
                <span class="mono">HKCU\Environment</span> 与系统环境变量分支。
                <template v-if="!result"> 点击右上角「开始扫描」生成诊断结果。</template>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== 诊断结果 ==================== -->
    <div class="wem-card">
      <div class="wem-card-head">
        <div class="wem-card-title">
          <WarningOutlined /> 诊断结果
          <span class="text-muted" style="font-weight: 400">筛选 {{ filteredRows.length }} / 全部 {{ rows.length }}</span>
        </div>
        <div class="toolbar">
          <a-radio-group v-model:value="levelFilter" size="small" button-style="solid">
            <a-radio-button value="all">全部 {{ rows.length }}</a-radio-button>
            <a-radio-button value="critical">🔴 严重 {{ stats.critical }}</a-radio-button>
            <a-radio-button value="warning">🟡 警告 {{ stats.warning }}</a-radio-button>
            <a-radio-button value="info">🔵 提示 {{ stats.info }}</a-radio-button>
          </a-radio-group>
        </div>
      </div>
      <div class="wem-card-body tight">
        <WemTable
          table-id="health-issues"
          row-key="id"
          :rows="filteredRows"
          :columns="columns"
          :page-size="20"
          :capabilities="caps"
          :batch-actions="batchActions"
          :row-class="rowClass"
          empty-text="尚未扫描，或当前环境没有发现问题"
          @selection-change="onSelectionChange"
          @batch="onBatch"
        >
          <template #cell="{ row, column }">
            <template v-if="column.key === 'level'">
              <a-tag :color="levelColor(row.level)">{{ levelIcon(row.level) }} {{ levelText(row.level) }}</a-tag>
            </template>
            <template v-else-if="column.key === 'type'">
              <span>{{ row.typeText }}</span>
            </template>
            <template v-else-if="column.key === 'location'">
              <span class="cell-name" :title="row.location">{{ row.location }}</span>
            </template>
            <template v-else-if="column.key === 'title'">
              <span class="cell-name" :title="row.title">{{ row.title }}</span>
            </template>
            <template v-else-if="column.key === 'suggestion'">
              <span class="cell-value" :title="row.suggestion">{{ row.suggestion }}</span>
            </template>
            <template v-else-if="column.key === 'actions'">
              <a-space size="small" @click.stop>
                <a @click.stop="openDetail(row)">详情</a>
                <a v-if="row.fixable" @click.stop="previewFix([row.id])">预览修复</a>
                <a v-if="row.fixable" class="danger-link" @click.stop="startFix([row.id])">执行修复</a>
                <span v-else class="text-muted" style="font-size: 12px">需手动处理</span>
              </a-space>
            </template>
          </template>
        </WemTable>
      </div>
    </div>

    <!-- ==================== 详情弹窗 ==================== -->
    <a-modal v-model:open="detailOpen" :title="`问题详情 · ${detailRow ? detailRow.title : ''}`" :footer="null" width="720px">
      <template v-if="detailRow">
        <div class="kv-list">
          <span class="kv-key">等级</span>
          <span class="kv-val">
            <a-tag :color="levelColor(detailRow.level)">{{ levelText(detailRow.level) }}</a-tag>
          </span>
          <span class="kv-key">问题类型</span><span class="kv-val">{{ detailRow.typeText }}（{{ detailRow.type }}）</span>
          <span class="kv-key">位置</span><span class="kv-val mono">{{ detailRow.location }}</span>
          <span class="kv-key">可自动修复</span><span class="kv-val">{{ detailRow.fixable ? '是' : '否，需要手动处理' }}</span>
        </div>
        <div class="section-title">问题描述</div>
        <div class="detail-box">{{ detailRow.detail }}</div>
        <div class="section-title">建议修复</div>
        <div class="detail-box">{{ detailRow.suggestion }}</div>
        <div v-if="detailRow.fixable" class="hint-box" style="margin-top: 12px">
          <InfoCircleOutlined />
          <div>该问题可以自动修复。点击下方按钮先预览变更清单，确认后再写入注册表。</div>
        </div>
        <div class="modal-actions">
          <a-button @click="detailOpen = false">关闭</a-button>
          <a-button v-if="detailRow.fixable" type="primary" @click="startFix([detailRow.id])">预览并修复</a-button>
        </div>
      </template>
    </a-modal>

    <!-- ==================== 修复预览 ==================== -->
    <a-modal
      v-model:open="previewOpen"
      title="修复预览 · 变更清单"
      width="900px"
      :mask-closable="false"
      :footer="null"
    >
      <div class="hint-box warn" style="margin-bottom: 10px">
        <ExclamationCircleOutlined />
        <div>
          下面列出即将写入注册表的全部改动。<b>before / after 为完整键值内容</b>，请确认无误后再执行。
          执行前会自动备份当前注册表分支，修复失败不影响原值。
        </div>
      </div>
      <WemTable
        table-id="health-fix-preview"
        row-key="id"
        :rows="actions"
        :columns="actionColumns"
        :page-size="10"
        :capabilities="previewCaps"
        empty-text="没有需要变更的项（可能已经是目标状态）"
      >
        <template #cell="{ row, column }">
          <template v-if="column.key === 'name'"><span class="mono">{{ row.name }}</span></template>
          <template v-else-if="column.key === 'path'"><span class="cell-path mono" :title="row.path">{{ row.path }}</span></template>
          <template v-else-if="column.key === 'before'">
            <span class="cell-value mono" :title="row.before">{{ clip(row.before) }}</span>
          </template>
          <template v-else-if="column.key === 'after'">
            <span class="cell-value mono after" :title="row.after">{{ clip(row.after) }}</span>
          </template>
          <template v-else-if="column.key === 'description'">
            <span :title="row.description">{{ row.description }}</span>
          </template>
        </template>
      </WemTable>
      <div class="modal-actions">
        <a-button @click="previewOpen = false">取消</a-button>
        <a-button type="primary" danger :disabled="!actions.length" :loading="applying" @click="confirmFix">
          确认修复（{{ actions.length }} 项）
        </a-button>
      </div>
    </a-modal>

    <!-- ==================== 修复结果 ==================== -->
    <a-modal v-model:open="resultOpen" title="修复结果" :footer="null" width="640px">
      <div class="kv-list">
        <span class="kv-key">已修复</span><span class="kv-val">{{ fixResult.applied }} 项</span>
        <span class="kv-key">已跳过</span><span class="kv-val">{{ (fixResult.skipped || []).length }} 项</span>
        <span class="kv-key">修复前备份</span><span class="kv-val mono">{{ fixResult.backupId || '—' }}</span>
      </div>
      <template v-if="(fixResult.skipped || []).length">
        <div class="section-title">跳过明细</div>
        <div class="detail-box mono skip-list">
          <div v-for="(s, i) in fixResult.skipped" :key="i">{{ s.id }} — {{ s.message }}</div>
        </div>
      </template>
      <div class="hint-box" style="margin-top: 12px">
        <InfoCircleOutlined />
        <div>修复后已自动重新扫描。已打开的命令行窗口不会感知变化，需要重启对应程序或资源管理器。</div>
      </div>
      <div class="modal-actions">
        <a-button type="primary" @click="resultOpen = false">知道了</a-button>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import {
  SafetyCertificateOutlined, WarningOutlined, InfoCircleOutlined, ExclamationCircleOutlined,
  ScanOutlined, DownloadOutlined
} from '@ant-design/icons-vue'
import api from '@/api'
import WemTable from '@/components/wem-table/WemTable.vue'
import { danger } from '@/components/dialogs/dialogService'
import { formatTime, clipText } from '@/lib/helpers'

const TYPE_TEXT = {
  'path-format': 'PATH 格式',
  'path-duplicate': 'PATH 重复',
  'path-missing': '目录缺失',
  'invalid-reference': '无效引用',
  'circular-reference': '循环引用',
  'value-type': '键值类型',
  'mutex-conflict': '配置集冲突',
  'project-folder': '项目目录',
  'tool-path': '工具路径'
}

const scanning = ref(false)
const applying = ref(false)
const result = ref(null)
const lastAt = ref(0)
const lastStats = ref({ critical: 0, warning: 0, info: 0 })
const levelFilter = ref('all')
const selectedKeys = ref([])

const detailOpen = ref(false)
const detailRow = ref(null)
const previewOpen = ref(false)
const actions = ref([])
const resultOpen = ref(false)
const fixResult = ref({ applied: 0, skipped: [], backupId: '' })
let fixIds = []

const caps = {
  inline: false,
  drag: false,
  export: false,
  format: false,
  presets: false,
  summary: false,
  contextMenu: false,
  expand: false,
  batchCopy: false,
  batchExport: false,
  batchDelete: false,
  batchTag: false,
  batchEnable: false
}
const previewCaps = {
  inline: false,
  drag: false,
  export: false,
  format: false,
  presets: false,
  summary: false,
  contextMenu: false,
  expand: false,
  select: false,
  batchCopy: false,
  batchExport: false,
  batchDelete: false,
  batchTag: false,
  batchEnable: false
}
const batchActions = [
  { key: 'preview', label: '预览修复' },
  { key: 'fix', label: '执行修复', danger: true }
]

const columns = [
  {
    title: '等级',
    key: 'level',
    dataIndex: 'level',
    type: 'enum',
    width: 96,
    enumOptions: [
      { value: 'critical', label: '严重' },
      { value: 'warning', label: '警告' },
      { value: 'info', label: '提示' }
    ]
  },
  { title: '问题类型', key: 'type', dataIndex: 'typeText', width: 120 },
  { title: '位置', key: 'location', dataIndex: 'location', width: 210, ellipsis: true },
  { title: '问题描述', key: 'title', dataIndex: 'title', ellipsis: true },
  { title: '建议修复', key: 'suggestion', dataIndex: 'suggestion', width: 260, ellipsis: true },
  { title: '操作', key: 'actions', width: 190, fixed: 'right', sortable: false, filterable: false }
]

const actionColumns = [
  { title: '键位路径', key: 'path', dataIndex: 'path', width: 250, ellipsis: true },
  { title: '键值名', key: 'name', dataIndex: 'name', width: 100 },
  { title: '修改前', key: 'before', dataIndex: 'before', ellipsis: true },
  { title: '修改后', key: 'after', dataIndex: 'after', ellipsis: true },
  { title: '说明', key: 'description', dataIndex: 'description', width: 220, ellipsis: true }
]

const rows = computed(() => {
  const items = result.value && Array.isArray(result.value.items) ? result.value.items : []
  return items.map((item) => ({
    ...item,
    typeText: TYPE_TEXT[item.type] || item.type || '未知'
  }))
})

const filteredRows = computed(() => (
  levelFilter.value === 'all' ? rows.value : rows.value.filter((row) => row.level === levelFilter.value)
))

const stats = computed(() => {
  if (result.value && result.value.stats) {
    return {
      critical: Number(result.value.stats.critical) || 0,
      warning: Number(result.value.stats.warning) || 0,
      info: Number(result.value.stats.info) || 0
    }
  }
  return {
    critical: Number(lastStats.value.critical) || 0,
    warning: Number(lastStats.value.warning) || 0,
    info: Number(lastStats.value.info) || 0
  }
})

const score = computed(() => {
  if (result.value && typeof result.value.score === 'number') return result.value.score
  return null
})
const scoreText = computed(() => (score.value == null ? '—' : String(score.value)))
const ringPercent = computed(() => (score.value == null ? 0 : Math.max(0, Math.min(100, score.value))))
const scoreColor = computed(() => {
  if (score.value == null) return 'var(--wem-text-3)'
  if (score.value >= 85) return '#00b42a'
  if (score.value >= 60) return '#ff7d00'
  return '#f53f3f'
})
const fixableCount = computed(() => rows.value.filter((row) => row.fixable).length)
const lastScanText = computed(() => {
  const at = result.value ? result.value.scannedAt : lastAt.value
  if (!at) return '尚未扫描'
  return `上次扫描：${formatTime(at)}`
})

function levelText(level) {
  return { critical: '严重', warning: '警告', info: '提示' }[level] || '提示'
}
function levelIcon(level) {
  return { critical: '🔴', warning: '🟡', info: '🔵' }[level] || '🔵'
}
function levelColor(level) {
  return { critical: 'red', warning: 'orange', info: 'blue' }[level] || 'blue'
}
function clip(text) {
  const s = String(text == null ? '' : text)
  return s.length > 120 ? `${s.slice(0, 120)}…` : (s || '（空）')
}
function rowClass(record) {
  if (record.level === 'critical') return 'row-removed'
  if (record.level === 'warning') return 'row-modified'
  return ''
}

async function loadLast() {
  const res = await api.health.lastScore()
  if (!res.ok) {
    message.error(res.message)
    return
  }
  const data = res.data || {}
  lastAt.value = Number(data.scannedAt) || 0
  lastStats.value = data.stats || { critical: 0, warning: 0, info: 0 }
  // 回填上次扫描结果，进入页面即可看到历史明细（文档要求首页展示最近一次结果）
  if (!result.value && Array.isArray(data.items) && data.items.length && data.score != null) {
    result.value = {
      score: data.score,
      scannedAt: Number(data.scannedAt) || 0,
      stats: lastStats.value,
      items: data.items
    }
  }
}

async function scan(notify) {
  scanning.value = true
  try {
    const res = await api.health.scan()
    if (!res.ok) {
      message.error(res.message)
      return
    }
    const data = res.data && Array.isArray(res.data.items)
      ? res.data
      : { score: null, scannedAt: Date.now(), items: [], stats: { critical: 0, warning: 0, info: 0 } }
    result.value = data
    lastAt.value = Number(data.scannedAt) || Date.now()
    selectedKeys.value = []
    if (notify) {
      const s = data.stats || {}
      message.success(`扫描完成：得分 ${data.score == null ? '—' : data.score}，严重 ${s.critical || 0} / 警告 ${s.warning || 0} / 提示 ${s.info || 0}`)
    }
  } finally {
    scanning.value = false
  }
}

function onSelectionChange(keys) {
  selectedKeys.value = Array.isArray(keys) ? keys : []
}

function onBatch({ action, rows: picked }) {
  const ids = (picked || []).filter((row) => row.fixable).map((row) => row.id)
  if (!ids.length) {
    message.warning('所选问题都不支持自动修复，请按建议手动处理')
    return
  }
  if (action === 'preview') previewFix(ids)
  if (action === 'fix') startFix(ids)
}

function openDetail(row) {
  detailRow.value = row
  detailOpen.value = true
}

async function previewFix(ids) {
  const res = await api.health.previewFix({ ids })
  if (!res.ok) {
    message.error(res.message)
    return
  }
  actions.value = (res.data && res.data.actions) || []
  fixIds = ids
  if (!actions.value.length) {
    message.info('没有需要变更的内容，可能已经是目标状态')
    return
  }
  if (detailOpen.value) detailOpen.value = false
  previewOpen.value = true
}

function startFix(ids) {
  return previewFix(ids)
}

async function confirmFix() {
  const list = actions.value.slice()
  const ok = await danger({
    title: '确认执行环境修复？',
    warning: '以下改动会直接写入 Windows 注册表（HKCU / HKLM 环境变量分支），错误修改可能影响程序运行。',
    columns: [
      { title: '键值名', dataIndex: 'name', key: 'name', width: 110 },
      { title: '修改前', dataIndex: 'before', key: 'before', ellipsis: true },
      { title: '修改后', dataIndex: 'after', key: 'after', ellipsis: true }
    ],
    rows: list.map((item, index) => ({
      key: `${item.id}-${index}`,
      name: item.name,
      before: clipText(item.before, 160),
      after: clipText(item.after, 160)
    })),
    hint: '执行前会自动备份当前环境变量分支，备份 ID 会在结果里给出。'
  })
  if (!ok) return
  previewOpen.value = false

  applying.value = true
  try {
    const res = await api.health.applyFix({ ids: fixIds })
    if (!res.ok) {
      message.error(res.message)
      return
    }
    fixResult.value = {
      applied: Number(res.data.applied) || 0,
      skipped: res.data.skipped || [],
      backupId: res.data.backupId || ''
    }
    actions.value = []
    resultOpen.value = true
    message.success(`修复完成：${fixResult.value.applied} 项已写入`)
    await scan(false)
  } finally {
    applying.value = false
  }
}

async function exportReport(format) {
  if (!result.value) {
    message.warning('请先执行一次扫描')
    return
  }
  const res = await api.health.exportReport({ format, result: result.value })
  if (!res.ok) {
    message.error(res.message)
    return
  }
  if (!res.data || !res.data.file) return
  message.success(`报告已导出：${res.data.file}`)
}

function saveBaseline() {
  message.info('当前后端未提供「保存扫描基线」通道，本次扫描结果会作为 last.json 缓存保留，可在下次打开时看到得分。')
}

onMounted(loadLast)
</script>

<style scoped>
.dash {
  display: flex;
  gap: 18px;
  align-items: center;
  flex-wrap: wrap;
}

.ring {
  position: relative;
  width: 136px;
  height: 136px;
  flex: 0 0 136px;
}

.ring-inner {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.ring-score {
  font-size: 34px;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -1px;
  font-variant-numeric: tabular-nums;
}

.ring-label {
  font-size: 11.5px;
  color: var(--wem-text-3);
  margin-top: 2px;
}

.dash-right {
  flex: 1;
  min-width: 320px;
}

.mini-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 10px;
}

.mini {
  border: 1px solid var(--wem-border);
  border-radius: 10px;
  background: var(--wem-card-alt);
  padding: 10px 12px;
}

.mini.on {
  border-color: rgba(245, 63, 63, 0.35);
}

.mini-label {
  font-size: 12px;
  color: var(--wem-text-3);
  display: flex;
  align-items: center;
  gap: 6px;
}

.mini-value {
  font-size: 22px;
  font-weight: 600;
  margin-top: 4px;
  font-variant-numeric: tabular-nums;
}

.mini-extra {
  font-size: 11px;
  color: var(--wem-text-3);
  margin-top: 2px;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}

.scan-box {
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid var(--wem-border);
  border-radius: 10px;
  background: var(--wem-card-alt);
}

.scan-text {
  font-size: 12px;
  color: var(--wem-text-3);
  margin-top: 4px;
  line-height: 1.6;
}

.dash-tip {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid var(--wem-border);
  border-radius: 10px;
  background: var(--wem-card-alt);
  font-size: 12px;
  color: var(--wem-text-2);
  line-height: 1.7;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  margin: 14px 0 6px;
}

.detail-box {
  border: 1px solid var(--wem-border);
  border-radius: 8px;
  background: var(--wem-card-alt);
  padding: 10px 12px;
  font-size: 12.5px;
  line-height: 1.75;
  color: var(--wem-text-2);
  word-break: break-all;
}

.skip-list {
  max-height: 160px;
  overflow: auto;
  font-size: 12px;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}

.danger-link {
  color: var(--wem-danger);
}

.cell-value.after {
  color: var(--wem-success);
}
</style>
