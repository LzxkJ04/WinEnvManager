<template>
  <a-modal
    :open="dialogState.open"
    :width="dialogState.kind === 'danger' || dialogState.kind === 'preview' ? 720 : 520"
    :mask-closable="dialogState.maskClosable"
    :keyboard="false"
    :closable="dialogState.kind !== 'danger'"
    :footer="null"
    :style="modalStyle"
    @cancel="onMask"
  >
    <template #title>
      <div class="dlg-title" :class="{ danger: dialogState.kind === 'danger' }" @mousedown="onDragStart">
        {{ dialogState.title }}
      </div>
    </template>
    <div class="dlg-body">
      <p v-if="dialogState.kind === 'danger'" class="dlg-warn">{{ dialogState.warning }}</p>
      <p v-if="dialogState.content">{{ dialogState.content }}</p>
      <ul v-if="dialogState.items.length" class="dlg-list">
        <li v-for="(item, i) in dialogState.items" :key="i">{{ item }}</li>
      </ul>
      <a-table
        v-if="dialogState.rows.length"
        class="wem-table"
        size="small"
        :columns="tableColumns"
        :data-source="tableRows"
        :pagination="false"
        :scroll="{ y: 220 }"
      />
      <p v-if="dialogState.hint" class="text-muted">{{ dialogState.hint }}</p>
      <div v-if="dialogState.kind === 'progress'">
        <a-progress :percent="dialogState.percent" />
        <pre v-if="dialogState.logs" class="dlg-log">{{ dialogState.logs }}</pre>
      </div>
      <a-collapse v-if="dialogState.detail" ghost>
        <a-collapse-panel key="d" header="查看详情">
          <pre class="dlg-log">{{ dialogState.detail }}</pre>
        </a-collapse-panel>
      </a-collapse>
      <a-checkbox v-if="dialogState.kind === 'danger'" v-model:checked="dialogState.checked">
        我已经阅读风险提示，确认执行本次操作
      </a-checkbox>
      <a-checkbox v-else-if="dialogState.kind === 'confirm' && dialogState.skipKey" v-model:checked="dialogState.checked">
        不再提示
      </a-checkbox>
    </div>
    <div class="dlg-foot">
      <a-button v-if="dialogState.kind === 'error'" @click="copyDetail">复制错误信息</a-button>
      <a-button v-if="showCancel" @click="cancelDialog">取消</a-button>
      <a-button
        :type="dialogState.kind === 'danger' ? 'primary' : 'primary'"
        :danger="dialogState.kind === 'danger'"
        :disabled="dialogState.kind === 'danger' && !dialogState.checked"
        @click="acceptDialog"
      >
        {{ okText }}
      </a-button>
    </div>
  </a-modal>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { acceptDialog, cancelDialog, dialogState } from './dialogService'

const drag = ref(null)
const pos = ref(readPos())

const modalStyle = computed(() => (pos.value ? { top: `${pos.value.top}px`, left: `${pos.value.left}px`, margin: 0 } : {}))
const showCancel = computed(() => ['confirm', 'danger', 'preview', 'progress'].includes(dialogState.kind))
const okText = computed(() => {
  if (dialogState.kind === 'danger') return '确认执行'
  if (dialogState.kind === 'preview') return '确认'
  if (dialogState.kind === 'progress') return '关闭'
  return '确定'
})
const tableColumns = computed(() => {
  if (dialogState.columns.length) return dialogState.columns
  const row = dialogState.rows[0] || {}
  return Object.keys(row).filter((k) => k !== 'key').map((k) => ({ title: k, dataIndex: k, key: k, ellipsis: true }))
})
const tableRows = computed(() => dialogState.rows.map((row, i) => ({ key: row.key || i, ...row })))

function rememberPos() {
  try {
    const settings = JSON.parse(localStorage.getItem('wem-popup-settings') || '{}')
    return settings.rememberPos !== false
  } catch (_) {
    return true
  }
}

function clampPos(saved) {
  if (!saved || !Number.isFinite(saved.top) || !Number.isFinite(saved.left)) return null
  const top = Math.max(8, Math.min(Math.max(8, window.innerHeight - 160), saved.top))
  const left = Math.max(8, Math.min(Math.max(8, window.innerWidth - 360), saved.left))
  return { top, left }
}

function readPos() {
  if (!rememberPos()) return null
  try {
    return clampPos(JSON.parse(localStorage.getItem('wem-dialog-pos') || 'null'))
  } catch (_) {
    return null
  }
}

watch(() => dialogState.open, (open) => {
  if (open) pos.value = readPos()
})

function onMask() {
  if (!dialogState.maskClosable) return
  cancelDialog()
}

function onDragStart(event) {
  const box = event.currentTarget.closest('.ant-modal')
  if (!box) return
  const rect = box.getBoundingClientRect()
  drag.value = { dx: event.clientX - rect.left, dy: event.clientY - rect.top }
  window.addEventListener('mousemove', onDrag)
  window.addEventListener('mouseup', onDragEnd)
}

function onDrag(event) {
  if (!drag.value) return
  pos.value = clampPos({
    top: event.clientY - drag.value.dy,
    left: event.clientX - drag.value.dx
  })
}

function onDragEnd() {
  drag.value = null
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', onDragEnd)
  if (!pos.value || !rememberPos()) return
  localStorage.setItem('wem-dialog-pos', JSON.stringify(pos.value))
}

async function copyDetail() {
  const text = [dialogState.content, dialogState.detail].filter(Boolean).join('\n')
  try {
    await navigator.clipboard.writeText(text)
    message.success('已复制')
  } catch (_) {
    message.warning('复制失败，请手动选择文字')
  }
}

onBeforeUnmount(() => onDragEnd())
</script>

<style scoped>
.dlg-title {
  cursor: move;
  user-select: none;
}
.dlg-title.danger {
  color: var(--wem-danger, #f53f3f);
}
.dlg-body {
  max-height: 60vh;
  overflow: auto;
}
.dlg-warn {
  color: var(--wem-danger, #f53f3f);
  font-weight: 700;
}
.dlg-list {
  margin: 0 0 8px;
  padding-left: 18px;
}
.dlg-log {
  max-height: 160px;
  overflow: auto;
  white-space: pre-wrap;
  background: var(--wem-card-alt, #fafbfc);
  border-radius: 8px;
  padding: 8px;
}
.dlg-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}
</style>
