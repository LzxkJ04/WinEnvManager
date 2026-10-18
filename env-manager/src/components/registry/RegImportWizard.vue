<template>
  <a-modal
    v-model:open="open"
    title="导入 REG 文件"
    width="920px"
    :mask-closable="false"
    :footer="null"
    @cancel="onCancel"
  >
    <a-steps :current="step" size="small" style="margin: 6px 0 14px">
      <a-step title="选择文件" />
      <a-step title="预览内容" />
      <a-step title="选择模式" />
      <a-step title="确认导入" />
    </a-steps>

    <!-- 1. 选文件 -->
    <div v-show="step === 0">
      <div class="hint-box" style="margin-bottom: 12px">
        <InfoCircleOutlined />
        <div>
          WinEnv管家 导入带事务回滚：任一条失败会自动回滚已写入项。
          <b>若用系统注册表编辑器（regedit）直接导入 .reg，则无法回滚</b>，请优先使用本软件的备份格式。
        </div>
      </div>
      <div class="toolbar">
        <a-button type="primary" @click="pickFile">
          <template #icon><FolderOpenOutlined /></template>
          选择 .reg 文件
        </a-button>
        <span class="text-muted mono file-text">{{ file || '尚未选择文件' }}</span>
      </div>
      <div v-if="encoding" class="toolbar" style="margin-top: 10px">
        <a-tag color="blue">检测到编码：{{ encodingLabel }}</a-tag>
        <a-tag v-if="nodes.length" color="green">{{ nodes.length }} 个注册表项</a-tag>
      </div>
    </div>

    <!-- 2. 预览 -->
    <div v-show="step === 1">
      <div class="stat-grid" style="margin-bottom: 10px">
        <div class="stat-card">
          <div class="stat-label">预览条目</div>
          <div class="stat-value">{{ rows.length }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">新增</div>
          <div class="stat-value" style="color: #00b42a">{{ summary.new }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">冲突（将被覆盖）</div>
          <div class="stat-value" style="color: #ff7d00">{{ summary.conflict }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">跳过</div>
          <div class="stat-value" style="color: var(--wem-text-3)">{{ summary.skip }}</div>
        </div>
      </div>

      <div v-if="issues.length" class="hint-box warn" style="margin-bottom: 10px">
        <WarningOutlined />
        <div>
          解析发现 {{ issues.length }} 条提示：
          <span v-for="(it, i) in issues.slice(0, 6)" :key="i" class="mono issue-item">
            {{ it.message || it }}
          </span>
        </div>
      </div>

      <WemTable
        table-id="reg-import-preview"
        row-key="__key"
        :rows="previewRows"
        :columns="previewColumns"
        :row-class="previewRowClass"
        :page-size="8"
        :capabilities="previewCaps"
        empty-text="该文件没有可导入的键值"
      >
        <template #cell="{ row, column }">
          <template v-if="column.key === 'status'">
            <a-tag :color="statusColor(row.status)">{{ statusLabel(row.status) }}</a-tag>
          </template>
          <template v-else-if="column.key === 'path'">
            <span class="mono cell-path" :title="row.path">{{ row.path }}</span>
          </template>
          <template v-else-if="column.key === 'name'">
            <span class="mono">{{ row.name || '(默认)' }}</span>
          </template>
          <template v-else-if="column.key === 'newValue'">
            <span class="mono cell-path" :title="row.newValue">{{ clip(row.newValue) }}</span>
          </template>
          <template v-else-if="column.key === 'currentValue'">
            <span class="mono cell-path text-muted" :title="row.currentValue">{{ clip(row.currentValue) }}</span>
          </template>
        </template>
      </WemTable>
    </div>

    <!-- 3. 模式 -->
    <div v-show="step === 2">
      <a-radio-group v-model:value="mode" style="display: block" @change="reloadPreview">
        <a-radio value="merge" class="mode-item">
          <b>合并导入</b>
          <div class="mode-desc">已存在的键值用文件中的值覆盖，文件中没有的键值保持不变。</div>
        </a-radio>
        <a-radio value="append" class="mode-item">
          <b>仅新增</b>
          <div class="mode-desc">只写入当前不存在的键值，已存在的同名键值一律跳过，不会覆盖任何现有数据。</div>
        </a-radio>
      </a-radio-group>
    </div>

    <!-- 4. 确认 -->
    <div v-show="step === 3">
      <div class="hint-box danger" style="margin-bottom: 12px">
        <WarningOutlined />
        <div>
          即将向注册表写入 <b>{{ importable.length }}</b> 条键值。写入过程带事务回滚，
          但注册表修改本身仍属于高危操作，建议先对目标分支创建备份。
        </div>
      </div>
      <div class="kv-list">
        <span class="kv-key">来源文件</span><span class="kv-val mono">{{ file }}</span>
        <span class="kv-key">文件编码</span><span class="kv-val">{{ encodingLabel }}</span>
        <span class="kv-key">导入模式</span><span class="kv-val">{{ mode === 'append' ? '仅新增（跳过已存在）' : '合并（覆盖同名键值）' }}</span>
        <span class="kv-key">写入条数</span><span class="kv-val">{{ importable.length }}</span>
      </div>
      <a-collapse ghost style="margin-top: 8px">
        <a-collapse-panel key="list" :header="`查看完整路径清单（${importable.length}）`">
          <div class="path-list mono">
            <div v-for="(row, i) in importable.slice(0, 400)" :key="i">
              {{ row.path }}{{ row.name ? '\\' + row.name : ' (默认)' }}
            </div>
            <div v-if="importable.length > 400" class="text-muted">…共 {{ importable.length }} 条，仅展示前 400 条</div>
          </div>
        </a-collapse-panel>
      </a-collapse>
    </div>

    <div class="wiz-foot">
      <a-button :disabled="step === 0 || importing" @click="step -= 1">上一步</a-button>
      <a-button v-if="step === 0" type="primary" :disabled="!file" :loading="parsing" @click="loadPreview">
        下一步：预览
      </a-button>
      <a-button v-else-if="step === 1" type="primary" :disabled="!rows.length" @click="step = 2">下一步：选择模式</a-button>
      <a-button v-else-if="step === 2" type="primary" :disabled="!importable.length" @click="step = 3">
        下一步：确认
      </a-button>
      <a-button v-else type="primary" danger :loading="importing" :disabled="!importable.length" @click="doImport">
        确认导入 {{ importable.length }} 条
      </a-button>
      <a-button v-if="step < 3" @click="onCancel">取消</a-button>
    </div>
  </a-modal>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { message } from 'ant-design-vue'
import { FolderOpenOutlined, InfoCircleOutlined, WarningOutlined } from '@ant-design/icons-vue'
import api from '@/api'
import WemTable from '@/components/wem-table/WemTable.vue'
import { confirmDanger } from '@/components/registry/confirmDanger'
import { useUiStore } from '@/store/ui'

const emit = defineEmits(['done'])
const ui = useUiStore()

const open = ref(false)
const step = ref(0)
const file = ref('')
const mode = ref('merge')
const encoding = ref('')
const nodes = ref([])
const rows = ref([])
const issues = ref([])
const parsing = ref(false)
const importing = ref(false)

const summary = reactive({ new: 0, conflict: 0, skip: 0 })

const previewCaps = {
  inline: false,
  drag: false,
  sort: false,
  summary: false,
  batchDelete: false,
  batchTag: false,
  batchEnable: false,
  contextMenu: false,
  select: false
}

const previewColumns = [
  { title: '状态', key: 'status', dataIndex: 'status', width: 96 },
  { title: '注册表路径', key: 'path', dataIndex: 'path', ellipsis: true },
  { title: '键名', key: 'name', dataIndex: 'name', width: 160, ellipsis: true },
  { title: '类型', key: 'type', dataIndex: 'type', width: 130 },
  { title: '文件中的值', key: 'newValue', dataIndex: 'newValue', ellipsis: true },
  { title: '当前值', key: 'currentValue', dataIndex: 'currentValue', ellipsis: true }
]

const previewRows = computed(() => rows.value.map((row, i) => ({ ...row, __key: `imp-${i}` })))
const importable = computed(() => rows.value.filter((row) => row.status !== 'skip'))
const encodingLabel = computed(() => {
  if (encoding.value === 'utf16le' || encoding.value === 'utf-16le') return 'UTF-16 LE（regedit 导出默认）'
  if (encoding.value === 'ansi' || encoding.value === 'gbk') return 'ANSI / GBK（旧格式，中文可能异常）'
  if (encoding.value === 'utf8') return 'UTF-8'
  return encoding.value || '未检测'
})

function clip(text) {
  const s = String(text == null ? '' : text)
  return s.length > 90 ? `${s.slice(0, 90)}…` : (s || '—')
}

function statusLabel(status) {
  if (status === 'new') return '新增'
  if (status === 'conflict') return '冲突'
  return '跳过'
}

function statusColor(status) {
  if (status === 'new') return 'green'
  if (status === 'conflict') return 'orange'
  return 'default'
}

function previewRowClass(row) {
  if (row.status === 'conflict') return 'row-modified'
  if (row.status === 'skip') return 'imp-row-skip'
  return ''
}

function reset() {
  step.value = 0
  file.value = ''
  mode.value = 'merge'
  encoding.value = ''
  nodes.value = []
  rows.value = []
  issues.value = []
  summary.new = 0
  summary.conflict = 0
  summary.skip = 0
}

function openWizard(presetFile) {
  reset()
  if (presetFile) file.value = presetFile
  open.value = true
  if (presetFile) loadPreview()
}

async function pickFile() {
  const res = await api.reg.pickRegFile()
  if (!res.ok) {
    message.error(res.message)
    return
  }
  if (!res.data || !res.data.file) return
  file.value = res.data.file
  await loadPreview()
}

async function loadPreview() {
  if (!file.value) {
    message.warning('请先选择 .reg 文件')
    return
  }
  parsing.value = true
  try {
    const res = await api.reg.parseReg({ file: file.value, mode: mode.value })
    if (!res.ok) {
      message.error(res.message)
      return
    }
    const data = res.data || {}
    encoding.value = data.encoding || ''
    nodes.value = data.nodes || []
    rows.value = data.rows || []
    issues.value = data.issues || []
    const s = data.summary || {}
    summary.new = Number(s.new) || 0
    summary.conflict = Number(s.conflict) || 0
    summary.skip = Number(s.skip) || 0
    step.value = 1
  } finally {
    parsing.value = false
  }
}

async function reloadPreview() {
  if (!file.value) return
  parsing.value = true
  try {
    const res = await api.reg.parseReg({ file: file.value, mode: mode.value })
    if (!res.ok) {
      message.error(res.message)
      return
    }
    const data = res.data || {}
    rows.value = data.rows || []
    const s = data.summary || {}
    summary.new = Number(s.new) || 0
    summary.conflict = Number(s.conflict) || 0
    summary.skip = Number(s.skip) || 0
  } finally {
    parsing.value = false
  }
}

async function doImport() {
  const list = importable.value
  if (!list.length) {
    message.warning('没有可导入的条目')
    return
  }
  const ok = await confirmDanger({
    title: '⚠️ 注册表修改高危警告',
    warning:
      '修改 Windows 注册表可能造成程序异常、系统无法启动等严重问题，' +
      '强烈建议在修改前先对该注册表分支创建注册表备份。',
    content: `即将导入 ${list.length} 条键值（模式：${mode.value === 'append' ? '仅新增' : '合并覆盖'}）。` +
      '本软件导入带事务回滚；若用系统注册表编辑器直接导入 .reg，则无法回滚。',
    hint: '确认前请再次核对上面的完整路径清单。',
    rows: list.slice(0, 200).map((row) => ({
      路径: row.path,
      键名: row.name || '(默认)',
      类型: row.type || '',
      值: row.newValue
    })),
    columns: [
      { title: '路径', dataIndex: '路径', key: '路径', ellipsis: true },
      { title: '键名', dataIndex: '键名', key: '键名', width: 140, ellipsis: true },
      { title: '类型', dataIndex: '类型', key: '类型', width: 120 },
      { title: '值', dataIndex: '值', key: '值', ellipsis: true }
    ]
  })
  if (!ok) return

  importing.value = true
  try {
    const res = await api.reg.applyImport({ rows: list })
    if (!res.ok) {
      message.error(res.message)
      return
    }
    message.success(`导入完成，共写入 ${res.data.applied || list.length} 条键值`)
    ui.tip(`REG 导入完成：${res.data.applied || list.length} 条`, 'success')
    open.value = false
    emit('done')
  } finally {
    importing.value = false
  }
}

function onCancel() {
  open.value = false
}

defineExpose({ openWizard })
</script>

<style scoped>
.file-text {
  max-width: 640px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: inline-block;
  vertical-align: middle;
}

.issue-item {
  display: inline-block;
  margin-right: 10px;
  font-size: 11.5px;
}

.mode-item {
  display: flex;
  align-items: flex-start;
  width: 100%;
  padding: 10px 12px;
  margin-bottom: 10px;
  border: 1px solid var(--wem-border);
  border-radius: 10px;
}

.mode-desc {
  color: var(--wem-text-3);
  font-size: 12px;
  margin-top: 2px;
  line-height: 1.6;
}

.path-list {
  max-height: 220px;
  overflow: auto;
  font-size: 11.5px;
  line-height: 1.9;
  word-break: break-all;
}

.wiz-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

</style>

<!-- 预览表格在弹窗里（Teleport 到 body），用全局样式才能命中跳过的行 -->
<style>
tr.imp-row-skip > td {
  opacity: 0.55;
}
</style>
