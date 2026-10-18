<template>
  <a-modal
    :open="open"
    title="条件格式"
    :width="760"
    :footer="null"
    :mask-closable="false"
    destroy-on-close
    @cancel="close"
  >
    <div class="fmt-toolbar">
      <a-button type="primary" size="small" @click="startCreate">新建规则</a-button>
      <span class="hint">靠前的规则优先。命中后不再往后匹配。</span>
    </div>

    <div v-if="!list.length" class="fmt-empty">
      <a-empty description="还没有条件格式" />
    </div>

    <div v-else class="fmt-list">
      <div v-for="(rule, index) in list" :key="rule.id" class="fmt-row">
        <a-checkbox :checked="rule.enabled !== false" @change="(e) => toggleRule(rule, e.target.checked)">启用</a-checkbox>
        <div class="fmt-main">
          <div class="fmt-name">{{ rule.name || '未命名规则' }}</div>
          <div class="fmt-brief">{{ brief(rule) }}</div>
        </div>
        <span class="fmt-swatch" :style="swatchStyle(rule)">Aa</span>
        <a-button size="small" @click="startEdit(rule)">编辑</a-button>
        <a-button size="small" :disabled="index === 0" @click="move(index, -1)">上移</a-button>
        <a-button size="small" :disabled="index === list.length - 1" @click="move(index, 1)">下移</a-button>
        <a-button size="small" danger @click="remove(rule)">删除</a-button>
      </div>
    </div>

    <div v-if="form" class="fmt-form">
      <div class="form-title">{{ form.id ? '编辑规则' : '新建规则' }}</div>
      <div class="form-grid">
        <label>名称</label>
        <a-input v-model:value="form.name" size="small" placeholder="例如：失败行标红" />

        <label>应用范围</label>
        <div class="inline">
          <a-button size="small" :type="form.scope === 'cell' ? 'primary' : 'default'" @click="form.scope = 'cell'">单元格</a-button>
          <a-button size="small" :type="form.scope === 'row' ? 'primary' : 'default'" @click="form.scope = 'row'">整行</a-button>
        </div>

        <label>列</label>
        <a-select v-model:value="form.columnKey" size="small" style="width: 100%" @change="onColumnChange">
          <a-select-option v-for="col in dataColumns" :key="col.key" :value="col.key">{{ col.title }}</a-select-option>
        </a-select>

        <label>条件类型</label>
        <a-select v-model:value="form.type" size="small" style="width: 100%" @change="onTypeChange">
          <a-select-option value="text">文本</a-select-option>
          <a-select-option value="number">数字</a-select-option>
          <a-select-option value="date">日期</a-select-option>
          <a-select-option value="enum">枚举</a-select-option>
        </a-select>

        <label>运算符</label>
        <a-select v-model:value="form.op" size="small" style="width: 100%" @change="onOpChange">
          <a-select-option v-for="op in operators" :key="op.value" :value="op.value">{{ op.label }}</a-select-option>
        </a-select>

        <template v-if="needsValue">
          <label>比较值</label>
          <div>
            <a-select
              v-if="form.type === 'enum' && enumOptions.length"
              v-model:value="form.value"
              size="small"
              style="width: 100%"
              :mode="form.op === 'in' ? 'multiple' : undefined"
            >
              <a-select-option v-for="opt in enumOptions" :key="String(opt.value)" :value="opt.value">{{ opt.label }}</a-select-option>
            </a-select>
            <a-input v-else v-model:value="form.value" size="small" :placeholder="valuePlaceholder" />
            <a-input
              v-if="form.op === 'between'"
              v-model:value="form.value2"
              size="small"
              style="margin-top: 6px"
              placeholder="结束值"
            />
          </div>
        </template>

        <label>字色</label>
        <div class="inline">
          <input v-model="form.color" class="color" type="color" :disabled="audit" />
          <span v-if="audit" class="hint">审计表只允许底色，文字颜色已禁用</span>
          <a-button v-else size="small" @click="form.color = ''">清除</a-button>
        </div>

        <label>底色</label>
        <div class="inline">
          <input v-model="form.background" class="color" type="color" />
          <a-button size="small" @click="form.background = ''">清除</a-button>
          <span class="fmt-swatch" :style="swatchStyle(form)">预览</span>
        </div>

        <label>字形</label>
        <div class="inline">
          <a-checkbox :checked="form.bold" @change="(e) => (form.bold = e.target.checked)">加粗</a-checkbox>
          <a-checkbox :checked="form.italic" @change="(e) => (form.italic = e.target.checked)">斜体</a-checkbox>
        </div>
      </div>
      <div class="form-actions">
        <a-button size="small" @click="form = null">取消</a-button>
        <a-button size="small" type="primary" @click="commitForm">保存规则</a-button>
      </div>
    </div>
  </a-modal>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { Modal, message } from 'ant-design-vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  tableId: { type: String, required: true },
  columns: { type: Array, default: () => [] },
  rules: { type: Array, default: () => [] }
})

const emit = defineEmits(['update:open', 'save'])

const OP = {
  text: [
    { value: 'contains', label: '包含' },
    { value: 'notContains', label: '不包含' },
    { value: 'eq', label: '等于' },
    { value: 'neq', label: '不等于' },
    { value: 'startsWith', label: '开头是' },
    { value: 'endsWith', label: '结尾是' },
    { value: 'empty', label: '为空' },
    { value: 'notEmpty', label: '不为空' }
  ],
  number: [
    { value: 'gt', label: '大于' },
    { value: 'gte', label: '大于等于' },
    { value: 'lt', label: '小于' },
    { value: 'lte', label: '小于等于' },
    { value: 'eq', label: '等于' },
    { value: 'neq', label: '不等于' },
    { value: 'between', label: '介于' },
    { value: 'empty', label: '为空' },
    { value: 'notEmpty', label: '不为空' }
  ],
  date: [
    { value: 'before', label: '早于' },
    { value: 'after', label: '晚于' },
    { value: 'eq', label: '等于当天' },
    { value: 'between', label: '介于' },
    { value: 'empty', label: '为空' },
    { value: 'notEmpty', label: '不为空' }
  ],
  enum: [
    { value: 'eq', label: '等于' },
    { value: 'neq', label: '不等于' },
    { value: 'in', label: '属于' },
    { value: 'empty', label: '为空' },
    { value: 'notEmpty', label: '不为空' }
  ]
}

const OP_LABEL = Object.values(OP).flat().reduce((map, item) => {
  map[item.value] = item.label
  return map
}, {})

const list = ref([])
const form = ref(null)

const audit = computed(() => String(props.tableId || '').toLowerCase().includes('audit'))
const dataColumns = computed(() => (props.columns || []).filter((col) => col && col.key && !String(col.key).startsWith('__')))
const operators = computed(() => OP[form.value?.type] || OP.text)
const needsValue = computed(() => form.value && form.value.op !== 'empty' && form.value.op !== 'notEmpty')
const enumOptions = computed(() => {
  const col = dataColumns.value.find((item) => item.key === form.value?.columnKey)
  return col?.enumOptions || []
})
const valuePlaceholder = computed(() => (form.value?.op === 'in' ? '多个值用英文逗号分隔' : '比较值'))

watch(() => props.open, (open) => {
  if (!open) return
  list.value = loadRules()
  form.value = null
})

function storageKey() {
  return `wem-format:${props.tableId}`
}

function readJson(key) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function loadRules() {
  const stored = readJson(storageKey())
  const source = Array.isArray(stored) ? stored : (props.rules || [])
  return source.map(normalizeRule)
}

function normalizeRule(rule) {
  return {
    id: rule.id || uid(),
    name: rule.name || '',
    enabled: rule.enabled !== false,
    scope: rule.scope === 'row' ? 'row' : 'cell',
    columnKey: rule.columnKey || '',
    type: OP[rule.type] ? rule.type : 'text',
    op: rule.op || 'contains',
    value: rule.value ?? '',
    value2: rule.value2 ?? '',
    color: rule.color || '',
    background: rule.background || '',
    bold: !!rule.bold,
    italic: !!rule.italic
  }
}

function uid() {
  return `fmt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function close() {
  emit('update:open', false)
}

function persist(next) {
  const rules = next.map(normalizeRule)
  list.value = rules
  try {
    localStorage.setItem(storageKey(), JSON.stringify(rules))
  } catch {
    message.error('条件格式写入本地失败')
  }
  const saveExtras = window.envAPI?.table?.saveExtras
  if (typeof saveExtras === 'function') {
    try {
      saveExtras(props.tableId, { formats: rules })
    } catch {
      /* 本地已保存，远端失败不阻断界面 */
    }
  }
  emit('save', rules)
}

function blankForm() {
  const first = dataColumns.value[0]
  const type = mapType(first?.type)
  return {
    id: '',
    name: '',
    enabled: true,
    scope: 'cell',
    columnKey: first?.key || '',
    type,
    op: (OP[type] || OP.text)[0].value,
    value: type === 'enum' ? undefined : '',
    value2: '',
    color: audit.value ? '' : '#cf1322',
    background: '#fff1f0',
    bold: false,
    italic: false
  }
}

function mapType(type) {
  if (type === 'number' || type === 'size') return 'number'
  if (type === 'date' || type === 'enum') return type
  return 'text'
}

function startCreate() {
  form.value = blankForm()
}

function startEdit(rule) {
  form.value = normalizeRule(rule)
  if (audit.value) form.value.color = ''
}

function onColumnChange(key) {
  const col = dataColumns.value.find((item) => item.key === key)
  const type = mapType(col?.type)
  form.value.type = type
  form.value.op = (OP[type] || OP.text)[0].value
  form.value.value = type === 'enum' ? undefined : ''
  form.value.value2 = ''
}

function onTypeChange(type) {
  form.value.op = (OP[type] || OP.text)[0].value
  form.value.value = type === 'enum' ? undefined : ''
  form.value.value2 = ''
}

function onOpChange(op) {
  if (op === 'in' && !Array.isArray(form.value.value)) {
    form.value.value = form.value.value ? String(form.value.value).split(',').map((item) => item.trim()).filter(Boolean) : []
  } else if (op !== 'in' && Array.isArray(form.value.value)) {
    form.value.value = form.value.value[0] ?? ''
  }
}

function commitForm() {
  const draft = { ...form.value }
  if (!String(draft.name || '').trim()) {
    message.warning('请填写规则名称')
    return
  }
  if (!draft.columnKey) {
    message.warning('请选择要判断的列')
    return
  }
  if (audit.value) draft.color = ''
  if (!draft.id) draft.id = uid()
  const next = list.value.slice()
  const index = next.findIndex((item) => item.id === draft.id)
  if (index >= 0) next.splice(index, 1, normalizeRule(draft))
  else next.push(normalizeRule(draft))
  persist(next)
  form.value = null
  message.success('条件格式已保存')
}

function toggleRule(rule, enabled) {
  persist(list.value.map((item) => (item.id === rule.id ? { ...item, enabled } : item)))
}

function move(index, step) {
  const target = index + step
  if (target < 0 || target >= list.value.length) return
  const next = list.value.slice()
  const [row] = next.splice(index, 1)
  next.splice(target, 0, row)
  persist(next)
}

function remove(rule) {
  Modal.confirm({
    title: '删除条件格式',
    content: `确定删除「${rule.name || '未命名规则'}」吗？`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: () => persist(list.value.filter((item) => item.id !== rule.id))
  })
}

function brief(rule) {
  const col = dataColumns.value.find((item) => item.key === rule.columnKey)
  const name = col?.title || rule.columnKey || '未指定列'
  const op = OP_LABEL[rule.op] || rule.op
  const scope = rule.scope === 'row' ? '整行' : '单元格'
  if (rule.op === 'empty' || rule.op === 'notEmpty') return `${scope} · ${name} ${op}`
  if (rule.op === 'between') return `${scope} · ${name} ${op} ${showValue(rule.value)} ~ ${showValue(rule.value2)}`
  return `${scope} · ${name} ${op} ${showValue(rule.value)}`
}

function showValue(value) {
  if (Array.isArray(value)) return value.join('、')
  return value == null || value === '' ? '（空）' : String(value)
}

function swatchStyle(rule) {
  return {
    color: audit.value ? 'inherit' : (rule.color || 'inherit'),
    background: rule.background || 'transparent',
    fontWeight: rule.bold ? '700' : '400',
    fontStyle: rule.italic ? 'italic' : 'normal'
  }
}
</script>

<style scoped>
.fmt-toolbar,
.form-actions,
.inline {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.fmt-toolbar {
  margin-bottom: 10px;
}

.hint {
  color: var(--wem-text-3);
  font-size: 12px;
}

.fmt-empty {
  padding: 12px 0 4px;
}

.fmt-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 280px;
  overflow: auto;
}

.fmt-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--wem-border);
  border-radius: 8px;
  background: var(--wem-card);
}

.fmt-main {
  flex: 1;
  min-width: 0;
}

.fmt-name {
  font-weight: 600;
  color: var(--wem-text);
}

.fmt-brief {
  color: var(--wem-text-3);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fmt-swatch {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  height: 22px;
  padding: 0 6px;
  border: 1px solid var(--wem-border);
  border-radius: 4px;
  font-size: 12px;
}

.fmt-form {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--wem-border);
}

.form-title {
  font-weight: 600;
  margin-bottom: 8px;
}

.form-grid {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 8px 10px;
  align-items: center;
}

.form-grid label {
  color: var(--wem-text-2);
}

.form-actions {
  justify-content: flex-end;
  margin-top: 12px;
}

.color {
  width: 36px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--wem-border);
  background: var(--wem-card);
  cursor: pointer;
}

.color:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
</style>
