<script setup>
// 轻量数据表格：支持列定义、行选择、斑马纹、行高亮
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps({
  columns: { type: Array, default: () => [] },  // [{ key, title, width, ellipsis, align }]
  rows: { type: Array, default: () => [] },
  rowKey: { type: String, default: 'id' },
  selectable: Boolean,
  selectedKeys: { type: Array, default: () => [] },
  rowClass: { type: Function, default: null },
  height: { type: Number, default: 0 },
  empty: { type: String, default: '暂无数据' },
  compact: { type: Boolean, default: true }
})
const emit = defineEmits(['row-click', 'row-dblclick', 'select'])

const allSelected = computed(
  () => props.rows.length > 0 && props.selectedKeys.length === props.rows.length
)

function keyOf(row) {
  return String(row[props.rowKey])
}

function toggleAll(e) {
  emit('select', e.target.checked ? props.rows.map(keyOf) : [])
}

function toggleRow(row, e) {
  e.stopPropagation()
  const k = keyOf(row)
  const next = props.selectedKeys.includes(k)
    ? props.selectedKeys.filter((x) => x !== k)
    : [...props.selectedKeys, k]
  emit('select', next)
}

function cls(col) {
  return cn(col.align === 'right' && 'text-right', col.ellipsis && 'max-w-0 truncate')
}
</script>

<template>
  <div
    class="overflow-auto rounded-lg border border-border"
    :style="height ? { maxHeight: height + 'px' } : {}"
  >
    <table class="w-full border-collapse text-[12.5px]">
      <thead class="sticky top-0 z-10 bg-muted/80 backdrop-blur">
        <tr>
          <th v-if="selectable" class="w-9 px-2 py-2 text-left">
            <input
              type="checkbox"
              class="h-3.5 w-3.5 cursor-pointer accent-[var(--primary)]"
              :checked="allSelected"
              @change="toggleAll"
            />
          </th>
          <th
            v-for="col in columns"
            :key="col.key"
            :style="col.width ? { width: col.width + 'px' } : {}"
            class="px-2.5 py-2 text-left font-semibold text-muted-foreground"
            :class="cls(col)"
          >
            {{ col.title }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="keyOf(row)"
          class="border-t border-border transition-colors hover:bg-primary/5"
          :class="[rowClass && rowClass(row), selectedKeys.includes(keyOf(row)) ? 'bg-primary/10' : '']"
          @click="emit('row-click', row)"
          @dblclick="emit('row-dblclick', row)"
        >
          <td v-if="selectable" class="px-2 py-1.5" @click="toggleRow(row, $event)">
            <input type="checkbox" class="h-3.5 w-3.5 cursor-pointer accent-[var(--primary)]" :checked="selectedKeys.includes(keyOf(row))" />
          </td>
          <td
            v-for="col in columns"
            :key="col.key"
            class="px-2.5 align-middle"
            :class="[compact ? 'py-1.5' : 'py-2.5', cls(col)]"
          >
            <slot :name="col.key" :row="row">{{ row[col.key] }}</slot>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + (selectable ? 1 : 0)" class="px-3 py-9 text-center text-muted-foreground">
            {{ empty }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
