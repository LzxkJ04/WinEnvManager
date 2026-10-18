<template>
  <a-modal
    :open="open"
    title="从文本导入变量"
    :width="760"
    :mask-closable="false"
    :keyboard="false"
    @update:open="onOpen"
  >
    <a-steps :current="step" size="small" class="imp-steps">
      <a-step title="粘贴" />
      <a-step title="解析" />
      <a-step title="目标" />
      <a-step title="确认" />
    </a-steps>

    <div v-show="step === 0" class="imp-body">
      <div class="hint-box" style="margin-bottom: 10px">
        <InfoCircleOutlined />
        <div>
          按 UTF-8 读取。文件开头的 BOM 会去掉。中文若变成乱码，请用记事本另存为 UTF-8 再粘贴。
          这里只生成导入清单，不写注册表。
        </div>
      </div>
      <div class="toolbar" style="margin-bottom: 8px">
        <a-upload :before-upload="onFile" :show-upload-list="false" accept=".env,.txt,.properties,.ini">
          <a-button size="small">选择文本文件</a-button>
        </a-upload>
        <span class="text-muted">选择后只读入文本，不会上传。</span>
      </div>
      <a-textarea v-model:value="text" :rows="8" class="mono" placeholder="KEY=VALUE&#10;# 注释会被忽略&#10;PATH_EXTRA=&quot;C:\tools\bin&quot;" />
      <div class="imp-checks">
        <a-checkbox v-model:checked="opt.ignoreComment">忽略 # 注释</a-checkbox>
        <a-checkbox v-model:checked="opt.ignoreEmpty">忽略空行</a-checkbox>
        <a-checkbox v-model:checked="opt.trim">去掉首尾空白</a-checkbox>
      </div>
    </div>

    <div v-show="step === 1" class="imp-body">
      <div class="toolbar" style="margin-bottom: 8px">
        <a-checkbox :checked="allChecked" :indeterminate="someChecked" @change="toggleAll">全选可导入行</a-checkbox>
        <span class="text-muted">已勾选 {{ selectedCount }} / {{ rows.length }}</span>
      </div>
      <a-table
        class="wem-table"
        size="small"
        row-key="line"
        :data-source="rows"
        :columns="parseColumns"
        :pagination="{ pageSize: 8, size: 'small', hideOnSinglePage: true }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'pick'">
            <a-checkbox v-model:checked="record.selected" :disabled="record.skip" />
          </template>
          <template v-else-if="column.key === 'key'">
            <span class="mono" :class="{ 'name-bad': badName(record.key) }">{{ record.key || '—' }}</span>
          </template>
          <template v-else-if="column.key === 'value'"><span class="cell-value">{{ record.value }}</span></template>
          <template v-else-if="column.key === 'reason'">
            <span v-if="badName(record.key)" class="name-bad">{{ badName(record.key) }}</span>
            <span v-else class="text-muted">{{ record.reason || '可导入' }}</span>
          </template>
        </template>
      </a-table>
      <div v-if="!rows.length" class="empty-block">没有解析出内容。返回上一步检查文本。</div>
    </div>

    <div v-show="step === 2" class="imp-body">
      <a-form layout="vertical">
        <a-form-item label="导入到">
          <a-radio-group v-model:value="targetMode">
            <a-radio value="new">新建配置集</a-radio>
            <a-radio value="existing">已有配置集</a-radio>
          </a-radio-group>
        </a-form-item>
        <a-form-item v-if="targetMode === 'new'" label="新配置集名称" required>
          <a-input v-model:value="newName" placeholder="例如 项目 .env" />
        </a-form-item>
        <a-form-item v-else label="选择配置集" required>
          <a-select
            v-model:value="existId"
            placeholder="选择已有配置集"
            :options="setOptions"
            style="width: 100%"
          />
          <div v-if="!setOptions.length" class="text-muted" style="margin-top: 6px">没有传入已有配置集，请改用新建。</div>
        </a-form-item>
        <a-form-item label="同名变量">
          <a-radio-group v-model:value="mode">
            <a-radio value="merge">合并，仅新增</a-radio>
            <a-radio value="overwrite">覆盖同名</a-radio>
            <a-radio value="skip">跳过冲突</a-radio>
          </a-radio-group>
        </a-form-item>
        <a-form-item label="字段映射（固定）">
          <div class="kv-list">
            <div class="kv-key">Key</div><div class="kv-val">变量名</div>
            <div class="kv-key">Value</div><div class="kv-val">变量值</div>
          </div>
        </a-form-item>
        <a-form-item label="备注（同一段文字写到每一条，可留空）">
          <a-input v-model:value="remark" placeholder="例如 从 .env 导入" />
        </a-form-item>
      </a-form>
      <div class="text-muted">覆盖和跳过只针对配置集里的同名变量，不会改注册表。</div>
    </div>

    <div v-show="step === 3" class="imp-body">
      <div class="hint-box" style="margin-bottom: 10px">
        <InfoCircleOutlined />
        <div>{{ existingNote }} 确认后只把清单交给外层，不写注册表。</div>
      </div>
      <div class="text-muted" style="margin-bottom: 8px">将导入 {{ finalVars.length }} 条，不导入 {{ rejected.length }} 条。</div>
      <a-table
        class="wem-table"
        size="small"
        row-key="key"
        :data-source="finalRows"
        :columns="finalColumns"
        :pagination="{ pageSize: 8, size: 'small', hideOnSinglePage: true }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'name'">
            <span class="mono" :class="{ 'name-bad': !record.keep }">{{ record.name }}</span>
          </template>
          <template v-else-if="column.key === 'value'"><span class="cell-value">{{ record.value }}</span></template>
          <template v-else-if="column.key === 'state'">
            <span :class="{ 'name-bad': !record.keep }">{{ record.state }}</span>
          </template>
        </template>
      </a-table>
    </div>

    <template #footer>
      <div class="imp-foot">
        <a-button @click="onOpen(false)">取消</a-button>
        <div class="toolbar">
          <a-button :disabled="step === 0" @click="step -= 1">上一步</a-button>
          <a-button v-if="step < 3" type="primary" @click="goNext">下一步</a-button>
          <a-button v-else type="primary" :disabled="!finalVars.length" @click="commit">完成</a-button>
        </div>
      </div>
    </template>
  </a-modal>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { InfoCircleOutlined } from '@ant-design/icons-vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  sets: { type: Array, default: () => [] }
})

const emit = defineEmits(['imported', 'update:open'])

const step = ref(0)
const text = ref('')
const opt = reactive({ ignoreComment: true, ignoreEmpty: true, trim: true })
const rows = ref([])
const targetMode = ref('new')
const newName = ref('')
const existId = ref(undefined)
const mode = ref('merge')
const remark = ref('')
const existing = ref([])
const existingNote = ref('')

const parseColumns = [
  { title: '', key: 'pick', width: 46 },
  { title: '行', dataIndex: 'line', width: 56 },
  { title: '变量名', key: 'key', dataIndex: 'key', width: 180 },
  { title: '变量值', key: 'value', ellipsis: true },
  { title: '说明', key: 'reason', width: 140 }
]
const finalColumns = [
  { title: '变量名', key: 'name', dataIndex: 'name', width: 180 },
  { title: '变量值', key: 'value', ellipsis: true },
  { title: '结果', key: 'state', width: 160 }
]

const setOptions = computed(() => (props.sets || []).filter((s) => s && s.id).map((s) => ({ value: s.id, label: s.name || s.id })))
const importable = computed(() => rows.value.filter((r) => !r.skip))
const selectedCount = computed(() => importable.value.filter((r) => r.selected).length)
const allChecked = computed(() => importable.value.length > 0 && importable.value.every((r) => r.selected))
const someChecked = computed(() => selectedCount.value > 0 && !allChecked.value)

const plan = computed(() => buildPlan())
const finalVars = computed(() => plan.value.vars)
const rejected = computed(() => plan.value.rejected)
const finalRows = computed(() => plan.value.rows)

watch(() => props.open, (v) => { if (v) reset() })

function reset() {
  step.value = 0
  text.value = ''
  opt.ignoreComment = true
  opt.ignoreEmpty = true
  opt.trim = true
  rows.value = []
  targetMode.value = 'new'
  newName.value = ''
  existId.value = undefined
  mode.value = 'merge'
  remark.value = ''
  existing.value = []
  existingNote.value = ''
}

function onOpen(v) {
  emit('update:open', v)
}

function unwrap(res) {
  if (res && typeof res === 'object' && 'data' in res && ('ok' in res || 'message' in res)) return res.data
  return res
}

function unescapeEnvValue(s) {
  return String(s)
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\')
}

function hasClosing(body, quote) {
  return String(body).trimEnd().endsWith(quote)
}

function readQuoted(value, lines, index, trim) {
  const trimmed = String(value).trim()
  const first = trimmed[0]
  if (first !== '"' && first !== "'") {
    return { value: trim ? String(value).trim() : String(value), index, closed: true }
  }
  const quote = first
  let body = trimmed.slice(1)
  let closed = hasClosing(body, quote)
  while (!closed && index + 1 < lines.length) {
    index += 1
    body += '\n' + lines[index]
    closed = hasClosing(body, quote)
  }
  if (!closed) return { value: body, index, closed: false }
  const cut = body.lastIndexOf(quote)
  let inner = body.slice(0, cut)
  if (quote === '"') inner = unescapeEnvValue(inner)
  return { value: inner, index, closed: true }
}

/** 与后端 .env 解析对齐的轻量版：KEY=VALUE、# 注释、引号、${VAR} → %VAR% */
function parseEnvText(source) {
  const lines = String(source || '').replace(/^\uFEFF/, '').split(/\r?\n/)
  const out = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const look = line.trim()
    if (!look) {
      if (!opt.ignoreEmpty) out.push({ line: i + 1, key: '', value: '', selected: false, skip: true, reason: '空行' })
      continue
    }
    if (look.startsWith('#')) {
      if (!opt.ignoreComment) out.push({ line: i + 1, key: '', value: look, selected: false, skip: true, reason: '注释' })
      continue
    }
    const src = opt.trim ? look : line
    const eq = src.indexOf('=')
    if (eq <= 0) {
      out.push({ line: i + 1, key: opt.trim ? look : line, value: '', selected: false, skip: true, reason: '缺少等号' })
      continue
    }
    let rawKey = src.slice(0, eq)
    if (opt.trim) rawKey = rawKey.trim()
    const lineNo = i + 1
    const quoted = readQuoted(src.slice(eq + 1), lines, i, opt.trim)
    i = quoted.index
    const value = quoted.value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, n) => `%${n}%`)
    out.push({
      line: lineNo,
      key: rawKey.toUpperCase(),
      value,
      selected: true,
      skip: false,
      reason: quoted.closed ? '' : '引号未闭合，已按原文保留'
    })
  }
  return out
}

function badName(name) {
  const n = String(name ?? '')
  if (!n) return '空名称'
  if (/\s/.test(n)) return '名称含空格'
  if (n.includes('=')) return '名称含 ='
  if (n.includes(';')) return '名称含 ;'
  return ''
}

function onFile(file) {
  const reader = new FileReader()
  reader.onload = () => { text.value = String(reader.result || '') }
  reader.onerror = () => message.error('读取文件失败，请改用粘贴')
  reader.readAsText(file, 'utf-8')
  return false
}

function toggleAll(e) {
  const on = !!(e && e.target && e.target.checked)
  rows.value.forEach((r) => { if (!r.skip) r.selected = on })
}

function goNext() {
  if (step.value === 0) {
    if (!String(text.value || '').trim()) {
      message.warning('请先粘贴或选择文本')
      return
    }
    rows.value = parseEnvText(text.value)
    step.value = 1
    return
  }
  if (step.value === 1) {
    if (!rows.value.some((r) => r.selected && !r.skip)) {
      message.warning('请至少勾选一行')
      return
    }
    step.value = 2
    return
  }
  if (step.value === 2) {
    if (targetMode.value === 'new' && !String(newName.value || '').trim()) {
      message.warning('请填写新配置集名称')
      return
    }
    if (targetMode.value === 'existing' && !existId.value) {
      message.warning('请选择已有配置集')
      return
    }
    prepareExisting().then(() => { step.value = 3 })
  }
}

async function prepareExisting() {
  existing.value = []
  if (targetMode.value === 'new') {
    existingNote.value = '新建配置集，没有已有变量可比对。三条冲突策略的结果相同。'
    return
  }
  const set = (props.sets || []).find((s) => s.id === existId.value)
  const inline = set && (set.variables || set.vars)
  if (Array.isArray(inline) && inline.length) {
    existing.value = inline.map(normVar).filter((v) => v.name)
    existingNote.value = '已用该配置集自带的变量列表比对同名项。'
    return
  }
  const fn = window.envAPI && window.envAPI.envset && window.envAPI.envset.get
  if (set && typeof fn === 'function') {
    try {
      const res = await fn({ id: set.id })
      if (!(res && res.ok === false)) {
        const data = unwrap(res) || {}
        const vars = data.variables || (data.set && data.set.variables) || data.vars || []
        if (Array.isArray(vars) && vars.length) {
          existing.value = vars.map(normVar).filter((v) => v.name)
          existingNote.value = '已读取该配置集的变量做比对，没有修改它，也没有写注册表。'
          return
        }
      }
    } catch (_) { /* 读不到就按新增处理 */ }
  }
  existingNote.value = '没有拿到已有变量，不能判断冲突。清单按新增处理，不会误覆盖系统变量。'
}

function normVar(v) {
  const src = v && typeof v === 'object' ? v : {}
  return { name: String(src.name || src.key || ''), value: src.value == null ? '' : String(src.value) }
}

function buildPlan() {
  const chosen = []
  const seen = new Map()
  rows.value.forEach((r) => {
    if (r.skip || !r.selected) return
    seen.set(r.key, r)
  })
  seen.forEach((r) => chosen.push(r))
  const have = new Set(existing.value.map((v) => v.name.toUpperCase()))
  const vars = []
  const rejected = []
  const view = []
  chosen.forEach((r) => {
    const why = badName(r.key)
    if (why) {
      rejected.push(r)
      view.push({ key: `bad-${r.line}-${r.key}`, name: r.key || '(空)', value: r.value, keep: false, state: `${why}，不导入` })
      return
    }
    const clash = have.has(r.key.toUpperCase())
    if (clash && (mode.value === 'merge' || mode.value === 'skip')) {
      rejected.push(r)
      view.push({
        key: `skip-${r.line}-${r.key}`,
        name: r.key,
        value: r.value,
        keep: false,
        state: mode.value === 'merge' ? '已存在，仅新增时跳过' : '冲突，已跳过'
      })
      return
    }
    vars.push({ name: r.key, value: r.value, remark: remark.value || '' })
    view.push({
      key: `ok-${r.line}-${r.key}`,
      name: r.key,
      value: r.value,
      keep: true,
      state: clash ? '将覆盖配置集中的同名项' : '新增'
    })
  })
  return { vars, rejected, rows: view }
}

function targetPayload() {
  if (targetMode.value === 'existing') {
    const set = (props.sets || []).find((s) => s.id === existId.value)
    return { type: 'existing', id: existId.value, name: (set && set.name) || '' }
  }
  return { type: 'new', id: '', name: String(newName.value || '').trim() }
}

function commit() {
  const vars = finalVars.value.map((v) => ({ name: v.name, value: v.value, remark: v.remark }))
  if (!vars.length) {
    message.warning('没有可导入的变量')
    return
  }
  emit('imported', { target: targetPayload(), mode: mode.value, vars })
  message.success('已生成导入清单，没有写入注册表')
  emit('update:open', false)
}
</script>

<style scoped>
.imp-steps { margin-bottom: 14px; }
.imp-body { min-height: 220px; }
.imp-checks { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 10px; }
.imp-foot { display: flex; justify-content: space-between; gap: 8px; }
.name-bad { color: #f53f3f; font-weight: 600; }
</style>
