<template>
  <div class="wem-card diff-card">
    <div class="wem-card-head">
      <div class="wem-card-title">
        <DiffOutlined />
        <span>{{ title }}</span>
        <a-tag v-if="rows.length" color="orange">{{ rows.length }} 处差异</a-tag>
        <a-tag v-else color="green">一致</a-tag>
      </div>
      <div class="toolbar">
        <a-tag color="green">新增 {{ diff.added.length }}</a-tag>
        <a-tag color="red">删除 {{ diff.removed.length }}</a-tag>
        <a-tag color="orange">修改 {{ diff.changed.length }}</a-tag>
      </div>
    </div>

    <div class="wem-card-body tight">
      <WemTable
        v-if="rows.length"
        ref="table"
        :table-id="`diff-${scope}`"
        row-key="__key"
        :rows="rows"
        :columns="columns"
        :page-size="12"
        :capabilities="caps"
        :row-class="diffRowClass"
        empty-text="该作用域下无任何差异"
        @selection-change="onSelect"
      >
        <template #cell="{ row, column }">
          <template v-if="column.key === 'action'">
            <a-tag :color="actionColor(row.action)">{{ row.action }}</a-tag>
          </template>
          <template v-else-if="column.key === 'name'">
            <span class="cell-name">{{ row.name }}</span>
          </template>
          <template v-else-if="column.key === 'before'">
            <span v-if="row.from !== undefined" class="diff-value-old">{{ row.beforeText }}</span>
            <span v-else class="text-muted">—</span>
          </template>
          <template v-else-if="column.key === 'after'">
            <span v-if="row.to !== undefined" class="diff-value-new">{{ row.afterText }}</span>
            <span v-else class="text-muted">—</span>
          </template>
        </template>
      </WemTable>

      <div v-else class="empty-block">
        <CheckCircleOutlined style="color: #00b42a; font-size: 18px" />
        <span style="margin-left: 8px">该作用域下无任何差异</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { DiffOutlined, CheckCircleOutlined } from '@ant-design/icons-vue'
import WemTable from '@/components/wem-table/WemTable.vue'

const props = defineProps({
  title: { type: String, required: true },
  diff: { type: Object, default: () => ({ added: [], removed: [], changed: [] }) },
  selectable: { type: Boolean, default: false },
  scope: { type: String, default: 'user' }
})

const emit = defineEmits(['select'])
const table = ref(null)

const rows = computed(() => {
  const out = []
  for (const item of props.diff.added || []) {
    out.push(rowOf('a', '新增', item.name, undefined, item.to))
  }
  for (const item of props.diff.removed || []) {
    out.push(rowOf('r', '删除', item.name, item.from, undefined))
  }
  for (const item of props.diff.changed || []) {
    out.push(rowOf('c', '修改', item.name, item.from, item.to))
  }
  return out
})

const columns = [
  { title: '动作', key: 'action', dataIndex: 'action', width: 90 },
  { title: '变量名', key: 'name', dataIndex: 'name', width: 190, ellipsis: true },
  { title: '变更前', key: 'before', dataIndex: 'beforeText', ellipsis: true },
  { title: '变更后', key: 'after', dataIndex: 'afterText', ellipsis: true }
]

const caps = computed(() => ({
  select: props.selectable,
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
}))

function rowOf(kind, action, name, from, to) {
  return {
    __key: `${kind}::${name}`,
    action,
    name,
    from,
    to,
    beforeText: from === undefined ? '' : short(from),
    afterText: to === undefined ? '' : short(to),
    scope: props.scope
  }
}

function actionColor(action) {
  return { 新增: 'green', 删除: 'red', 修改: 'orange' }[action] || 'default'
}

function diffRowClass(record) {
  return record.action === '新增' ? 'diff-row-added' : record.action === '删除' ? 'diff-row-removed' : 'diff-row-changed'
}

function short(value) {
  const text = String(value ?? '')
  return text.length > 90 ? text.slice(0, 90) + '…' : text || '（空）'
}

function onSelect(keys) {
  const picked = new Set(keys || [])
  emit('select', rows.value.filter((row) => picked.has(row.__key)))
}

watch(
  () => props.diff,
  () => {
    table.value?.clearSelection()
    emit('select', [])
  }
)

defineExpose({ clearSelection: () => table.value?.clearSelection() })
</script>

<style scoped>
.diff-card + .diff-card {
  margin-top: 14px;
}
</style>
