<template>
  <a-modal
    :open="open"
    title="识别规则库"
    :width="960"
    :keyboard="false"
    :mask-closable="false"
    @update:open="onOpen"
  >
    <div class="toolbar" style="margin-bottom: 10px">
      <a-button type="primary" size="small" @click="openCreate">
        <template #icon><PlusOutlined /></template>
        新建规则
      </a-button>
      <a-button size="small" @click="resetBuiltin">重置内置</a-button>
      <span class="text-muted">内置规则不能删除。测试只在样例文本里查找，不执行版本命令，也不写注册表。</span>
    </div>
    <a-table
      class="wem-table"
      size="small"
      row-key="id"
      :data-source="localRules"
      :columns="columns"
      :pagination="{ pageSize: 8, size: 'small', hideOnSinglePage: true }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'enabled'">
          <a-switch :checked="record.enabled" @change="(v) => setEnabled(record, v)" />
        </template>
        <template v-else-if="column.key === 'name'">
          <span class="cell-name">{{ record.name }}</span>
          <a-tag v-if="record.builtin" color="blue" style="margin-left: 6px">内置</a-tag>
        </template>
        <template v-else-if="column.key === 'file'">
          <span class="mono">{{ record.matchText || '—' }}</span>
          <span class="text-muted"> · {{ modeLabel(record.matchMode) }}</span>
        </template>
        <template v-else-if="column.key === 'cmd'"><span class="mono">{{ record.versionCmd || '—' }}</span></template>
        <template v-else-if="column.key === 'remark'"><span class="text-muted">{{ record.remark || '—' }}</span></template>
        <template v-else-if="column.key === 'op'">
          <a-space size="small">
            <a @click="openEdit(record)">编辑</a>
            <a-tooltip :title="record.builtin ? '内置规则不可删除' : ''">
              <a :class="{ 'op-off': record.builtin }" @click="removeRule(record)">删除</a>
            </a-tooltip>
          </a-space>
        </template>
      </template>
    </a-table>
    <div v-if="!localRules.length" class="empty-block">还没有规则</div>

    <template #footer>
      <a-button @click="onOpen(false)">关闭</a-button>
      <a-button type="primary" @click="commit">保存</a-button>
    </template>

    <a-modal
      v-model:open="editOpen"
      :title="editForm.id ? '编辑规则' : '新建规则'"
      :width="640"
      ok-text="确定"
      cancel-text="取消"
      :keyboard="false"
      @ok="applyEdit"
    >
      <a-form layout="vertical" style="margin-top: 4px">
        <a-row :gutter="12">
          <a-col :span="12">
            <a-form-item label="名称" required>
              <a-input v-model:value="editForm.name" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="分类">
              <a-select v-model:value="editForm.category" :options="categoryOptions" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-form-item>
          <a-checkbox v-model:checked="editForm.enabled">启用</a-checkbox>
          <a-tag v-if="editForm.builtin" color="blue" style="margin-left: 8px">内置，不可删除</a-tag>
        </a-form-item>
        <a-row :gutter="12">
          <a-col :span="8">
            <a-form-item label="匹配模式">
              <a-select v-model:value="editForm.matchMode" :options="modeOptions" />
            </a-form-item>
          </a-col>
          <a-col :span="16">
            <a-form-item label="匹配文本（文件名）">
              <a-input v-model:value="editForm.matchText" class="mono" placeholder="例如 java.exe" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-row :gutter="12">
          <a-col :span="10">
            <a-form-item label="版本命令">
              <a-input v-model:value="editForm.versionCmd" class="mono" placeholder="--version" />
            </a-form-item>
          </a-col>
          <a-col :span="6">
            <a-form-item label="向上几级目录">
              <a-input-number v-model:value="editForm.parentLevels" :min="0" :max="8" style="width: 100%" />
            </a-form-item>
          </a-col>
          <a-col :span="8">
            <a-form-item label="HOME 变量名">
              <a-input v-model:value="editForm.homeVar" class="mono" placeholder="JAVA_HOME" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-form-item label="备注">
          <a-input v-model:value="editForm.remark" />
        </a-form-item>
        <a-form-item label="测试样例文本">
          <a-textarea v-model:value="editForm.sample" :rows="3" placeholder="例如 C:\dev\jdk\bin\java.exe&#10;openjdk version &quot;17.0.12&quot;" />
          <div class="toolbar" style="margin-top: 8px">
            <a-button size="small" type="primary" @click="runTest">测试</a-button>
            <span class="text-muted">样例包含匹配文本即算成功（忽略大小写）。版本取第一个 x.y.z，不运行命令。</span>
          </div>
        </a-form-item>
        <a-alert
          v-if="testResult"
          :type="testResult.hit ? 'success' : 'warning'"
          show-icon
          :message="testResult.hit ? '匹配成功' : '未匹配'"
          :description="testResult.detail"
        />
      </a-form>
    </a-modal>
  </a-modal>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { Modal, message } from 'ant-design-vue'
import { PlusOutlined } from '@ant-design/icons-vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  rules: { type: Array, default: () => [] }
})

const emit = defineEmits(['save', 'update:open'])

const PRESET_CATS = [
  '编程语言运行时',
  '构建&包管理工具',
  '数据库 & 中间件',
  '容器、虚拟化 & 云原生',
  'IDE与工具',
  '多媒体、编译、逆向',
  '运维、网络与系统工具',
  '脚本与环境工具',
  '未分类'
]
const modeOptions = [
  { value: 'eq', label: '等于' },
  { value: 'contains', label: '包含' },
  { value: 'starts', label: '开头' },
  { value: 'ends', label: '结尾' }
]
const columns = [
  { title: '启用', key: 'enabled', width: 70 },
  { title: '名称', key: 'name', dataIndex: 'name', width: 180 },
  { title: '分类', dataIndex: 'category', width: 150 },
  { title: '匹配文件名', key: 'file' },
  { title: '版本命令', key: 'cmd', width: 120 },
  { title: '备注', key: 'remark', ellipsis: true },
  { title: '', key: 'op', width: 110 }
]

const localRules = ref([])
const dirty = ref(false)
const editOpen = ref(false)
const testResult = ref(null)
const editForm = reactive(blankRule())

const categoryOptions = computed(() => {
  const extra = localRules.value.map((r) => r.category).filter(Boolean)
  return [...new Set([...PRESET_CATS, ...extra])].map((c) => ({ value: c, label: c }))
})

watch(() => props.open, (v) => { if (v) sync(false) })
watch(() => props.rules, () => { if (props.open && !dirty.value) sync(false) }, { deep: true })

function clone(v) {
  return JSON.parse(JSON.stringify(v))
}

function uid() {
  return `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function blankRule() {
  return {
    id: '',
    name: '',
    category: '未分类',
    enabled: true,
    matchMode: 'contains',
    matchText: '',
    versionCmd: '',
    parentLevels: 0,
    homeVar: '',
    remark: '',
    sample: '',
    builtin: false
  }
}

function modeLabel(v) {
  return (modeOptions.find((m) => m.value === v) || { label: '包含' }).label
}

function normalize(raw, index) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const enabled = src.enabled !== undefined ? !!src.enabled : src.enable !== false
  const matchText = src.matchText || src.executableName || ''
  let homeVar = src.homeVar || ''
  if (!homeVar && Array.isArray(src.envTemplate)) {
    const hit = src.envTemplate.find((e) => /HOME|ROOT/i.test((e && e.varKey) || ''))
    homeVar = (hit && hit.varKey) || ''
  }
  return {
    ...src,
    id: src.id || `rule-${index}`,
    name: src.name || '',
    category: src.category || '未分类',
    enabled,
    enable: enabled,
    matchMode: src.matchMode || (src.executableName ? 'eq' : 'contains'),
    matchText,
    versionCmd: src.versionCmd || '',
    parentLevels: Number(src.parentLevels != null ? src.parentLevels : (src.installPathExtract && src.installPathExtract.level)) || 0,
    homeVar,
    remark: src.remark || src.description || '',
    sample: src.sample || '',
    builtin: !!src.builtin
  }
}

function sync() {
  localRules.value = (Array.isArray(props.rules) ? props.rules : []).map(normalize)
  dirty.value = false
}

function onOpen(v) {
  emit('update:open', v)
}

function setEnabled(record, value) {
  record.enabled = !!value
  record.enable = !!value
  dirty.value = true
}

function openCreate() {
  Object.assign(editForm, blankRule(), { id: '' })
  testResult.value = null
  editOpen.value = true
}

function openEdit(record) {
  Object.assign(editForm, blankRule(), clone(record))
  testResult.value = null
  editOpen.value = true
}

function applyEdit() {
  const name = String(editForm.name || '').trim()
  if (!name) {
    message.warning('请填写规则名称')
    return Promise.reject(new Error('名称必填'))
  }
  const next = normalize({
    ...editForm,
    name,
    enabled: !!editForm.enabled,
    enable: !!editForm.enabled,
    matchText: String(editForm.matchText || '').trim(),
    parentLevels: Number(editForm.parentLevels) || 0,
    remark: editForm.remark || ''
  }, localRules.value.length)
  next.executableName = next.matchText || next.executableName || ''
  next.description = next.remark
  if (next.installPathExtract && typeof next.installPathExtract === 'object') {
    next.installPathExtract = {
      ...next.installPathExtract,
      level: next.parentLevels,
      mode: next.parentLevels > 0 ? 'parentNLevel' : (next.installPathExtract.mode || 'self')
    }
  }
  const idx = localRules.value.findIndex((r) => r.id === next.id)
  if (idx >= 0) localRules.value.splice(idx, 1, next)
  else {
    next.id = next.id || uid()
    next.builtin = false
    localRules.value.push(next)
  }
  dirty.value = true
  editOpen.value = false
}

function removeRule(record) {
  if (record.builtin) return
  Modal.confirm({
    title: '删除规则',
    content: `删除自定义规则「${record.name || '未命名'}」。内置规则不会受影响。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk() {
      localRules.value = localRules.value.filter((r) => r.id !== record.id)
      dirty.value = true
    }
  })
}

function resetBuiltin() {
  const n = localRules.value.filter((r) => r.builtin).length
  if (!n) {
    message.info('当前没有内置规则')
    return
  }
  Modal.confirm({
    title: '重置内置规则',
    content: `只把 ${n} 条内置规则重新设为启用，不改名称、匹配和自定义规则。`,
    okText: '恢复启用',
    cancelText: '取消',
    onOk() {
      localRules.value = localRules.value.map((r) => (r.builtin ? { ...r, enabled: true, enable: true } : r))
      dirty.value = true
      emit('save', clone(localRules.value))
      message.success('已恢复内置规则的启用状态')
    }
  })
}

function runTest() {
  const sample = String(editForm.sample || '')
  const text = String(editForm.matchText || '').trim()
  if (!text) {
    testResult.value = { hit: false, detail: '请先填写匹配文本。未执行版本命令。' }
    return
  }
  const hit = sample.toLowerCase().includes(text.toLowerCase())
  const ver = (sample.match(/\d+\.\d+\.\d+/) || [])[0] || ''
  const verText = ver ? `版本 ${ver}` : '没有提取到 x.y.z 版本'
  const cmd = editForm.versionCmd ? `未执行命令「${editForm.versionCmd}」。` : '未执行版本命令。'
  testResult.value = { hit, detail: `${verText}。${cmd}` }
}

function commit() {
  emit('save', clone(localRules.value))
  dirty.value = false
  message.success('规则已交给外层保存，没有写入注册表')
  emit('update:open', false)
}
</script>

<style scoped>
.op-off {
  color: var(--wem-text-3);
  cursor: not-allowed;
}
</style>
