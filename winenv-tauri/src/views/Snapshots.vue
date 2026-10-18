<template>
  <div class="flex flex-col gap-3.5">
    <Card>
      <div class="flex items-center justify-between border-b border-border p-2.5">
        <span class="flex items-center gap-1.5 text-[13px] font-semibold"><Camera :size="14" /> 环境变量快照 <Badge tone="info">{{ snapshots.length }} 个</Badge></span>
        <div class="flex gap-1.5">
          <Button size="sm" @click="createOpen = true"><Plus :size="13" /> 新建快照</Button>
          <Button size="sm" variant="outline" @click="loadList"><RotateCw :size="13" /> 刷新</Button>
        </div>
      </div>
      <div class="p-2">
        <DataTable
          :columns="snapColumns" :rows="snapshots" row-key="id" :height="260"
          empty="还没有任何快照，点击「新建快照」抓取当前环境"
        >
          <template #name="{ row }">
            <span class="font-semibold">{{ row.name }}</span>
            <Badge v-if="row.auto" tone="warning" class="ml-1">自动</Badge>
            <Badge v-if="isBaseline(row.id)" tone="gold" class="ml-1">基线</Badge>
          </template>
          <template #note="{ row }"><span class="text-muted-foreground">{{ row.note || '—' }}</span></template>
          <template #counts="{ row }">
            <span class="mono">用户 {{ row.counts?.user }} · 系统 {{ row.counts?.machine }}</span>
          </template>
          <template #actions="{ row }">
            <div class="flex items-center gap-2 text-[11.5px]">
              <button class="text-primary hover:underline" @click="compareWith(row)">与当前对比</button>
              <button class="text-primary hover:underline" @click="restoreFrom(row)">选择性恢复</button>
              <button class="text-muted-foreground hover:underline" @click="markBaseline(row)">{{ isBaseline(row.id) ? '取消基线' : '标记基线' }}</button>
              <button class="text-primary hover:underline" @click="exportSnapshot(row)">导出</button>
              <button class="text-red-500 hover:underline" @click="removeSnapshot(row)">删除</button>
            </div>
          </template>
        </DataTable>
      </div>
    </Card>

    <Card>
      <div class="flex flex-wrap items-center gap-2 border-b border-border p-2.5">
        <span class="flex items-center gap-1.5 text-[13px] font-semibold"><GitCompare :size="14" /> 差异对比</span>
        <span class="text-[11.5px] text-muted-foreground">绿色＝新增，红色＝删除，黄色＝修改</span>
      </div>
      <div class="flex flex-wrap items-center gap-2 p-2.5">
        <div class="flex overflow-hidden rounded-md border border-border text-[12px]">
          <button class="px-2.5 py-1" :class="mode === 'current' ? 'bg-primary text-white' : ''" @click="mode = 'current'">当前环境 VS 快照</button>
          <button class="px-2.5 py-1" :class="mode === 'two' ? 'bg-primary text-white' : ''" @click="mode = 'two'">快照 A VS 快照 B</button>
        </div>
        <template v-if="mode === 'current'">
          <Select v-model="snapId" :options="snapOptions" class="!w-64" placeholder="选择快照" />
          <span class="muted text-[12px]">→</span>
          <Badge tone="info">当前环境</Badge>
        </template>
        <template v-else>
          <Select v-model="leftId" :options="snapOptions" class="!w-56" placeholder="快照 A" />
          <span class="muted text-[12px]">VS</span>
          <Select v-model="rightId" :options="snapOptions" class="!w-56" placeholder="快照 B" />
        </template>
        <Button size="sm" @click="runCompare"><GitCompare :size="13" /> 开始对比</Button>
        <Button v-if="diff" size="sm" variant="outline" @click="diff = null">清除结果</Button>
      </div>

      <div v-if="!diff" class="p-6 text-center text-[12px] text-muted-foreground">选择对比对象后点击「开始对比」</div>
      <template v-else>
        <div class="grid grid-cols-2 gap-3 px-2.5 pb-2 md:grid-cols-4">
          <div class="rounded-lg border border-border bg-card p-3">
            <div class="text-[11.5px] text-muted-foreground">差异总数</div>
            <div class="mt-1 text-[20px] font-semibold text-primary">{{ diff.summary.total }}</div>
          </div>
          <div class="rounded-lg border border-border bg-card p-3">
            <div class="text-[11.5px] text-muted-foreground">新增</div>
            <div class="mt-1 text-[20px] font-semibold text-emerald-600">{{ diff.summary.added }}</div>
          </div>
          <div class="rounded-lg border border-border bg-card p-3">
            <div class="text-[11.5px] text-muted-foreground">删除</div>
            <div class="mt-1 text-[20px] font-semibold text-red-500">{{ diff.summary.removed }}</div>
          </div>
          <div class="rounded-lg border border-border bg-card p-3">
            <div class="text-[11.5px] text-muted-foreground">修改</div>
            <div class="mt-1 text-[20px] font-semibold text-amber-500">{{ diff.summary.changed }}</div>
          </div>
        </div>
        <div v-for="scope in ['user', 'machine']" :key="scope" class="px-2.5 pb-2.5">
          <div class="mb-1.5 text-[12.5px] font-semibold">{{ scope === 'user' ? '用户' : '系统' }}变量差异（{{ rowsOf(scope).length }}）</div>
          <DataTable
            :columns="diffColumns" :rows="rowsOf(scope)" :row-key="(r) => r.__key" :height="240"
            :row-class="diffRowClass" empty="该作用域下无任何差异"
          >
            <template #action="{ row }"><Badge :tone="{ 新增: 'success', 删除: 'destructive', 修改: 'warning' }[row.action]">{{ row.action }}</Badge></template>
            <template #name="{ row }"><span class="mono font-semibold">{{ row.name }}</span></template>
            <template #before="{ row }"><span class="mono text-red-500 line-through">{{ row.from ?? '—' }}</span></template>
            <template #after="{ row }"><span class="mono text-emerald-600">{{ row.to ?? '—' }}</span></template>
            <template #pick="{ row }">
              <input type="checkbox" class="h-3.5 w-3.5 accent-[var(--primary)]" :checked="picked.includes(row.__key)" @change="togglePick(row)" />
            </template>
          </DataTable>
        </div>
        <div class="flex items-center gap-2.5 border-t border-border p-2.5">
          <Button size="sm" :disabled="!picked.length" @click="restorePicked"><Undo2 :size="13" /> 将勾选项还原为「{{ diff.rightLabel }}」状态</Button>
          <span class="text-[11.5px] text-muted-foreground">已勾选 {{ picked.length }} 项（{{ diff.leftLabel }} → {{ diff.rightLabel }}）</span>
        </div>
      </template>
    </Card>

    <Dialog v-model:open="createOpen" title="新建环境变量快照" width="520px">
      <div class="space-y-2.5">
        <div><div class="mb-1 text-[11.5px] text-muted-foreground">快照名称</div><Input v-model="createForm.name" /></div>
        <div><div class="mb-1 text-[11.5px] text-muted-foreground">备注</div><Textarea v-model="createForm.note" :rows="3" /></div>
      </div>
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="outline" @click="createOpen = false">取消</Button>
        <Button @click="submitCreate">创建</Button>
      </div>
    </Dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { Camera, Plus, RotateCw, GitCompare, Undo2 } from 'lucide-vue-next'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'
import Badge from '@/components/ui/Badge.vue'
import Input from '@/components/ui/Input.vue'
import Textarea from '@/components/ui/Textarea.vue'
import Select from '@/components/ui/Select.vue'
import Dialog from '@/components/ui/Dialog.vue'
import DataTable from '@/components/ui/DataTable.vue'
import { useEnvStore } from '@/store/env'
import api from '@/api'
import { clip } from '@/lib/utils'

const env = useEnvStore()
const snapshots = ref([])
const mode = ref('current')
const snapId = ref(undefined)
const leftId = ref(undefined)
const rightId = ref(undefined)
const diff = ref(null)
const picked = ref([])
const createOpen = ref(false)
const createForm = ref({ name: '', note: '' })
const baselineId = ref('')

const snapColumns = [
  { key: 'name', title: '快照名称', width: 240, ellipsis: true },
  { key: 'note', title: '备注', ellipsis: true },
  { key: 'counts', title: '包含变量', width: 190 },
  { key: 'createdAtText', title: '创建时间', width: 160 },
  { key: 'actions', title: '操作', width: 250 }
]
const diffColumns = [
  { key: 'action', title: '动作', width: 68 },
  { key: 'name', title: '变量名', width: 190, ellipsis: true },
  { key: 'before', title: '变更前', ellipsis: true },
  { key: 'after', title: '变更后', ellipsis: true },
  { key: 'pick', title: '还原', width: 56 }
]
const snapOptions = computed(() => snapshots.value.map((s) => ({ label: `${s.name}（${s.createdAtText}）`, value: s.id })))

function isBaseline(id) {
  return baselineId.value === id
}
function rowsOf(scope) {
  const d = diff.value?.[scope] || { added: [], removed: [], changed: [] }
  return [
    ...(d.added || []).map((a) => ({ __key: `a::${a.name}`, action: '新增', name: a.name, to: a.to })),
    ...(d.removed || []).map((r) => ({ __key: `r::${r.name}`, action: '删除', name: r.name, from: r.from })),
    ...(d.changed || []).map((c) => ({ __key: `c::${c.name}`, action: '修改', name: c.name, from: c.from, to: c.to }))
  ]
}
function diffRowClass(row) {
  return row.action === '新增' ? 'bg-emerald-500/10' : row.action === '删除' ? 'bg-red-500/10' : 'bg-amber-500/10'
}
function togglePick(row) {
  picked.value = picked.value.includes(row.__key) ? picked.value.filter((k) => k !== row.__key) : [...picked.value, row.__key]
}

async function loadList() {
  const res = await api.snapshot.list()
  if (res.ok) {
    snapshots.value = res.data
    if (!snapId.value && res.data.length) snapId.value = res.data[0].id
    if (!leftId.value && res.data.length) leftId.value = res.data[0].id
    if (!rightId.value && res.data.length > 1) rightId.value = res.data[1].id
  }
  const base = await api.snapshot.getBaseline()
  baselineId.value = base.ok ? base.data : ''
}
async function submitCreate() {
  const res = await api.snapshot.create(createForm.value)
  if (res.ok) {
    createOpen.value = false
    createForm.value = { name: '', note: '' }
    await loadList()
  } else alert(res.message)
}
function removeSnapshot(row) {
  if (!confirm(`删除快照「${row.name}」？`)) return
  api.snapshot.remove(row.id).then(loadList)
}
async function markBaseline(row) {
  if (isBaseline(row.id)) {
    baselineId.value = ''
    await api.snapshot.setBaseline('')
    return
  }
  const res = await api.snapshot.setBaseline(row.id)
  if (res.ok) baselineId.value = row.id
}
async function exportSnapshot(row) {
  const detail = await api.snapshot.get(row.id)
  if (!detail.ok) return alert(detail.message)
  const saved = await api.fs.saveFile({ title: '导出快照', defaultPath: `${row.name}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] })
  if (!saved.ok || saved.data.canceled) return
  await api.fs.writeTextFile({ file: saved.data.path, content: JSON.stringify(detail.data, null, 2) })
  alert('快照已导出')
}
function compareWith(row) {
  mode.value = 'current'
  snapId.value = row.id
  runCompare()
}
async function runCompare() {
  const payload = mode.value === 'current'
    ? { snapshotId: snapId.value, leftLabel: snapshots.value.find((s) => s.id === snapId.value)?.name, rightLabel: '当前环境' }
    : { mode: 'two', leftId: leftId.value, rightId: rightId.value }
  const res = await api.snapshot.compare(payload)
  if (res.ok) {
    diff.value = res.data
    picked.value = []
  } else alert(res.message)
}
async function restoreFrom(row) {
  const full = await api.snapshot.get(row.id)
  if (!full.ok) return alert(full.message)
  const items = []
  for (const scope of ['user', 'machine']) {
    const snapMap = full.data[scope] || {}
    const curMap = env.original[scope] || {}
    for (const k of Object.keys(snapMap)) if (curMap[k] !== snapMap[k]) items.push({ __key: `${scope}::${k}`, scope, name: k, snapshotValue: snapMap[k], currentValue: k in curMap ? curMap[k] : null })
    for (const k of Object.keys(curMap)) if (!(k in snapMap)) items.push({ __key: `${scope}::${k}`, scope, name: k, snapshotValue: null, currentValue: curMap[k] })
  }
  const plan = items
    .filter((i) => confirm(`「${row.name}」共 ${items.length} 处差异，确认还原到草稿区？`))
    .map((p) => (p.snapshotValue === null ? { action: 'delete', scope: p.scope, name: p.name } : { action: 'create', scope: p.scope, name: p.name, value: p.snapshotValue }))
  if (!plan.length) return
  const r = env.applyTemplateVars(plan.map((p) => ({ ...p, op: p.action === 'delete' ? 'delete' : 'create' })), { source: 'manual' })
  alert(`已将 ${r.added.length} 项变更加入草稿区，点击「保存写入系统」生效`)
}
async function restorePicked() {
  const all = [...rowsOf('user'), ...rowsOf('machine')].filter((r) => picked.value.includes(r.__key))
  if (!all.length) return
  const plan = all.map((p) => (p.action === '删除' ? { op: 'delete', scope: 'machine', name: p.name } : { op: 'create', scope: 'user', name: p.name, value: p.to }))
  const r = env.applyTemplateVars(plan, { source: 'manual' })
  alert(`已还原 ${r.added.length} 项到草稿区`)
  runCompare()
}
onMounted(loadList)
</script>
