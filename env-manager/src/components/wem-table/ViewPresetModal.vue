<template>
  <a-modal
    :open="open"
    title="视图预设"
    :width="680"
    :footer="null"
    :mask-closable="false"
    destroy-on-close
    @cancel="close"
  >
    <div class="preset-save">
      <a-input v-model:value="name" size="small" placeholder="预设名称，例如：只看失败列" @mousedown.stop />
      <a-button type="primary" size="small" @click="saveCurrent">保存当前视图</a-button>
      <a-button size="small" @click="pickFile">导入 JSON</a-button>
      <a-button size="small" :disabled="!list.length" @click="exportAll">导出 JSON</a-button>
      <input ref="fileRef" class="file" type="file" accept="application/json,.json" @change="onImport" />
    </div>
    <p class="hint">保存列布局、筛选、排序和条件格式开关。加载不会改动行数据。</p>

    <div v-if="!list.length" class="preset-empty">
      <a-empty description="还没有视图预设" />
    </div>

    <div v-else class="preset-list">
      <div v-for="item in list" :key="item.id" class="preset-row">
        <div class="preset-main">
          <template v-if="renamingId === item.id">
            <a-input v-model:value="renameText" size="small" />
          </template>
          <template v-else>
            <div class="preset-name">{{ item.name }}</div>
            <div class="preset-meta">{{ formatTime(item.updatedAt) }}</div>
          </template>
        </div>
        <template v-if="renamingId === item.id">
          <a-button size="small" type="primary" @click="commitRename(item)">确定</a-button>
          <a-button size="small" @click="renamingId = ''">取消</a-button>
        </template>
        <template v-else>
          <a-button size="small" type="primary" @click="load(item)">加载</a-button>
          <a-button size="small" @click="beginRename(item)">重命名</a-button>
          <a-button size="small" @click="exportOne(item)">导出</a-button>
          <a-button size="small" danger @click="remove(item)">删除</a-button>
        </template>
      </div>
    </div>
  </a-modal>
</template>

<script setup>
import { ref, watch } from 'vue'
import { Modal, message } from 'ant-design-vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  tableId: { type: String, required: true },
  current: { type: Object, default: () => ({}) }
})

const emit = defineEmits(['update:open', 'load'])

const list = ref([])
const name = ref('')
const renamingId = ref('')
const renameText = ref('')
const fileRef = ref(null)

watch(() => props.open, (open) => {
  if (!open) return
  list.value = readList()
  name.value = ''
  renamingId.value = ''
})

watch(() => props.tableId, () => {
  list.value = readList()
})

function storageKey() {
  return `wem-presets:${props.tableId}`
}

function readList() {
  try {
    const raw = localStorage.getItem(storageKey())
    const data = raw ? JSON.parse(raw) : []
    return Array.isArray(data) ? data.filter((item) => item && item.id && item.name) : []
  } catch {
    return []
  }
}

function writeList(next) {
  list.value = next
  try {
    localStorage.setItem(storageKey(), JSON.stringify(next))
  } catch {
    message.error('视图预设写入本地失败')
  }
}

function uid() {
  return `view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function close() {
  emit('update:open', false)
}

function snapshot() {
  const current = props.current || {}
  return {
    layout: clone(current.layout || {}),
    filters: clone(current.filters || {}),
    sorts: clone(current.sorts || []),
    formatEnabled: clone(current.formatEnabled || {})
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null))
}

function saveCurrent() {
  const title = name.value.trim()
  if (!title) {
    message.warning('请填写预设名称')
    return
  }
  const preset = {
    id: uid(),
    name: title,
    updatedAt: Date.now(),
    ...snapshot()
  }
  writeList([preset, ...list.value])
  name.value = ''
  message.success('已保存视图预设')
}

function load(item) {
  emit('load', clone(item))
  message.success(`已加载「${item.name}」`)
  close()
}

function beginRename(item) {
  renamingId.value = item.id
  renameText.value = item.name
}

function commitRename(item) {
  const title = renameText.value.trim()
  if (!title) {
    message.warning('名称不能为空')
    return
  }
  writeList(list.value.map((row) => (row.id === item.id ? { ...row, name: title, updatedAt: Date.now() } : row)))
  renamingId.value = ''
}

function remove(item) {
  Modal.confirm({
    title: '删除视图预设',
    content: `确定删除「${item.name}」吗？`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: () => writeList(list.value.filter((row) => row.id !== item.id))
  })
}

function download(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function exportAll() {
  download(`${props.tableId}-views.json`, list.value)
}

function exportOne(item) {
  download(`${props.tableId}-${item.name}.json`, item)
}

function pickFile() {
  if (fileRef.value) {
    fileRef.value.value = ''
    fileRef.value.click()
  }
}

function onImport(event) {
  const file = event.target.files && event.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result || ''))
      const incoming = Array.isArray(data) ? data : [data]
      const valid = incoming.map(normalizeImported).filter(Boolean)
      if (!valid.length) {
        message.error('JSON 里没有可用的视图预设')
        return
      }
      const map = new Map(list.value.map((item) => [item.id, item]))
      valid.forEach((item) => map.set(item.id, item))
      writeList([...map.values()])
      message.success(`已导入 ${valid.length} 个预设`)
    } catch {
      message.error('JSON 无法解析')
    }
  }
  reader.readAsText(file)
}

function normalizeImported(item) {
  if (!item || typeof item !== 'object') return null
  if (!item.name || !item.layout || typeof item.layout !== 'object') return null
  return {
    id: item.id || uid(),
    name: String(item.name),
    updatedAt: item.updatedAt || Date.now(),
    layout: item.layout,
    filters: item.filters || {},
    sorts: Array.isArray(item.sorts) ? item.sorts : [],
    formatEnabled: item.formatEnabled || {}
  }
}

function formatTime(time) {
  if (!time) return ''
  const date = new Date(time)
  if (Number.isNaN(date.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`
}
</script>

<style scoped>
.preset-save,
.preset-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.preset-save {
  margin-bottom: 6px;
}

.preset-save .ant-input,
.preset-save :deep(.ant-input) {
  flex: 1;
}

.hint {
  margin: 0 0 10px;
  color: var(--wem-text-3);
  font-size: 12px;
}

.file {
  display: none;
}

.preset-empty {
  padding: 8px 0;
}

.preset-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 360px;
  overflow: auto;
}

.preset-row {
  padding: 8px;
  border: 1px solid var(--wem-border);
  border-radius: 8px;
  background: var(--wem-card);
}

.preset-main {
  flex: 1;
  min-width: 0;
}

.preset-name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-meta {
  color: var(--wem-text-3);
  font-size: 12px;
}
</style>
