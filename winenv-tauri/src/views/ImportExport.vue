<template>
  <div class="flex flex-col gap-3.5">
    <!-- 批量导出 -->
    <Card>
      <div class="flex flex-wrap items-center gap-2 border-b border-border p-2.5">
        <span class="flex items-center gap-1.5 text-[13px] font-semibold"><Upload :size="14" /> 批量导出</span>
        <div class="flex overflow-hidden rounded-md border border-border text-[12px]">
          <button class="px-2.5 py-1" :class="exportScope === 'all' ? 'bg-primary text-white' : ''" @click="exportScope = 'all'">全部变量</button>
          <button class="px-2.5 py-1" :class="exportScope === 'user' ? 'bg-primary text-white' : ''" @click="exportScope = 'user'">仅用户</button>
          <button class="px-2.5 py-1" :class="exportScope === 'machine' ? 'bg-primary text-white' : ''" @click="exportScope = 'machine'">仅系统</button>
        </div>
        <div class="flex overflow-hidden rounded-md border border-border text-[12px]">
          <button v-for="f in formats" :key="f" class="px-2.5 py-1" :class="exportFormat === f ? 'bg-primary text-white' : ''" @click="exportFormat = f">{{ f }}</button>
        </div>
        <Checkbox v-model:checked="exportMask">脱敏导出</Checkbox>
        <Button size="sm" @click="doExport"><Download :size="13" /> 导出</Button>
      </div>
    </Card>

    <!-- 批量导入 -->
    <Card>
      <div class="flex flex-wrap items-center gap-2 border-b border-border p-2.5">
        <span class="flex items-center gap-1.5 text-[13px] font-semibold"><Download :size="14" /> 批量导入</span>
        <span class="text-[11.5px] text-muted-foreground">支持 .reg / .json / .env / .properties / txt</span>
      </div>
      <div class="flex flex-wrap items-center gap-1.5 border-b border-border p-2.5">
        <Button size="sm" variant="outline" @click="pickImportFile"><FolderOpen :size="13" /> 加载文件</Button>
        <Button size="sm" variant="outline" @click="pasteOpen = true"><ClipboardPaste :size="13" /> 粘贴导入</Button>
      </div>
      <div class="p-2">
        <DataTable
          v-if="importRows.length"
          :columns="importColumns" :rows="importRows" row-key="__key" selectable :height="300"
          :selected-keys="selectedKeys" @select="(k) => (selectedKeys = k)" :row-class="rowClass"
        >
          <template #status="{ row }"><Badge :tone="{ create: 'success', conflict: 'warning', same: 'default' }[row.status]">{{ { create: '新增', conflict: '冲突', same: '相同' }[row.status] }}</Badge></template>
          <template #target="{ row }"><Badge :tone="row.targetScope === 'machine' ? 'purple' : 'info'">{{ row.targetScope === 'machine' ? '系统' : '用户' }}</Badge></template>
          <template #name="{ row }"><span class="mono">{{ row.name }}</span></template>
          <template #value="{ row }"><span class="mono">{{ clip(row.value) }}</span></template>
          <template #current="{ row }"><span class="mono text-red-500">{{ row.current === null ? '（不存在）' : clip(row.current) }}</span></template>
        </DataTable>
        <div v-else class="py-8 text-center text-[12px] text-muted-foreground">加载文件后在此列出全部变量，可选择导入域与冲突策略</div>
      </div>
      <div v-if="importRows.length" class="flex flex-wrap items-center gap-2 border-t border-border p-2.5 text-[12px]">
        <span class="muted">导入到：</span>
        <Select v-model="importScope" :options="[{ label: '保持文件中的归属', value: 'keep' }, { label: '全部到用户变量', value: 'user' }, { label: '全部到系统变量', value: 'machine' }]" class="!w-44" @update:model-value="recalc" />
        <span class="muted ml-2">冲突策略：</span>
        <Select v-model="conflictMode" :options="[{ label: '覆盖', value: 'overwrite' }, { label: '合并', value: 'merge' }, { label: '仅新增不覆盖', value: 'skip' }]" class="!w-40" />
        <Button size="sm" :disabled="!selectedKeys.length" @click="doImport"><Upload :size="13" /> 导入（{{ selectedKeys.length }}）</Button>
        <Button size="sm" variant="outline" @click="clearImport">清空</Button>
      </div>
    </Card>

    <!-- 批量工具 -->
    <div class="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
      <Card>
        <div class="border-b border-border p-2.5 text-[13px] font-semibold"><ArrowLeftRight :size="14" class="inline text-primary" /> 批量替换工具</div>
        <div class="space-y-2.5 p-3">
          <div class="flex gap-2">
            <Input v-model="repFind" class="mono flex-1" placeholder="查找文本" />
            <Input v-model="repReplace" class="mono flex-1" placeholder="替换为" />
          </div>
          <div class="flex items-center gap-2">
            <Checkbox v-model:checked="repCase">忽略大小写</Checkbox>
            <Button size="sm" variant="outline" @click="previewReplace">预览</Button>
            <Button size="sm" :disabled="!repRows.length" @click="applyReplace">应用（{{ repRows.length }}）</Button>
          </div>
          <div v-if="repRows.length" class="mono max-h-40 overflow-auto rounded-lg border border-border bg-muted/40 p-2 text-[11px]">
            <div v-for="r in repRows" :key="r.key">[{{ r.scope }}] {{ r.name }}: {{ clip(r.before, 40) }} → {{ clip(r.after, 40) }}</div>
          </div>
        </div>
      </Card>
      <Card>
        <div class="border-b border-border p-2.5 text-[13px] font-semibold"><Trash2 :size="14" class="inline text-red-500" /> 批量删除</div>
        <div class="space-y-2.5 p-3">
          <div class="flex gap-2">
            <Input v-model="delKeyword" class="mono flex-1" placeholder="变量名关键词（如 OLD_）" />
            <Button size="sm" variant="outline" @click="previewDelete">筛选预览</Button>
          </div>
          <Button v-if="delRows.length" size="sm" variant="destructive" @click="applyDelete">标记选中（{{ delRows.length }}）为待删除</Button>
          <div v-if="delRows.length" class="mono max-h-40 overflow-auto rounded-lg border border-border bg-muted/40 p-2 text-[11px]">
            <div v-for="r in delRows" :key="r.key">[{{ r.scope }}] {{ r.name }}</div>
          </div>
        </div>
      </Card>
    </div>

    <Dialog v-model:open="pasteOpen" title="粘贴变量内容" width="620px">
      <Textarea v-model="pasteText" :rows="11" class="mono" placeholder="DB_HOST=127.0.0.1" />
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="outline" @click="pasteOpen = false">取消</Button>
        <Button @click="parsePaste">解析</Button>
      </div>
    </Dialog>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { Upload, Download, FolderOpen, ClipboardPaste, ArrowLeftRight, Trash2 } from 'lucide-vue-next'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'
import Badge from '@/components/ui/Badge.vue'
import Input from '@/components/ui/Input.vue'
import Textarea from '@/components/ui/Textarea.vue'
import Select from '@/components/ui/Select.vue'
import Checkbox from '@/components/ui/Checkbox.vue'
import Dialog from '@/components/ui/Dialog.vue'
import DataTable from '@/components/ui/DataTable.vue'
import { useEnvStore } from '@/store/env'
import api from '@/api'
import { clip, detectSensitive } from '@/lib/utils'

const env = useEnvStore()
const formats = ['json', 'txt', 'reg', 'env', 'cmd', 'ps1']
const exportScope = ref('all')
const exportFormat = ref('json')
const exportMask = ref(false)
const importScope = ref('keep')
const conflictMode = ref('overwrite')
const importRows = ref([])
const selectedKeys = ref([])
const pasteOpen = ref(false)
const pasteText = ref('')
const repFind = ref('')
const repReplace = ref('')
const repCase = ref(false)
const repRows = ref([])
const delKeyword = ref('')
const delRows = ref([])

const importColumns = [
  { key: 'status', title: '状态', width: 70 },
  { key: 'target', title: '归属', width: 70 },
  { key: 'name', title: '变量名', width: 190, ellipsis: true },
  { key: 'value', title: '导入值', ellipsis: true },
  { key: 'current', title: '当前值', ellipsis: true }
]

const exportCount = computed(() => (exportScope.value === 'all' ? env.counts.total : env.counts[exportScope.value]))

function collectVars() {
  const scopes = exportScope.value === 'all' ? ['user', 'machine'] : [exportScope.value]
  return scopes.flatMap((s) => env.working[s].filter((i) => !i._deleted).map((i) => ({ name: i.name, value: i.value, scope: s })))
}
async function doExport() {
  const vars = collectVars()
  if (!vars.length) return alert('没有可导出的变量')
  const saved = await api.fs.saveFile({ title: '导出环境变量', defaultPath: `EnvVars-${exportScope.value}.${exportFormat.value}` })
  if (!saved.ok || saved.data.canceled) return
  let content = ''
  let bom = false
  const list = exportMask.value ? vars.map((v) => ({ ...v, value: detectSensitive(v.name, v.value).length ? '****（已脱敏）' : v.value })) : vars
  if (exportFormat.value === 'json') content = JSON.stringify({ app: 'WinEnvManager', type: 'env-export', vars: list }, null, 2)
  else if (exportFormat.value === 'env') content = list.map((v) => `${v.name.toUpperCase()}="${v.value}"`).join('\r\n')
  else if (['cmd', 'ps1'].includes(exportFormat.value)) {
    content = list.map((v) => (exportFormat.value === 'cmd' ? `set "${v.name}=${v.value}"` : `$Env:${v.name} = "${v.value}"`)).join('\r\n')
  } else if (exportFormat.value === 'reg') {
    const lines = ['Windows Registry Editor Version 5.00', '', '[HKEY_CURRENT_USER\\Environment]']
    for (const v of list.filter((x) => x.scope === 'user')) lines.push(`"${v.name}"="${String(v.value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    lines.push('', '[HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment]')
    for (const v of list.filter((x) => x.scope === 'machine')) lines.push(`"${v.name}"="${String(v.value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    content = lines.join('\r\n')
    bom = true
  } else {
    content = ['# WinEnvManager 环境变量导出', '', '[用户变量]', ...list.filter((v) => v.scope === 'user').map((v) => `${v.name}=${v.value}`), '', '[系统变量]', ...list.filter((v) => v.scope === 'machine').map((v) => `${v.name}=${v.value}`)].join('\r\n')
    bom = true
  }
  await api.fs.writeTextFile({ file: saved.data.path, content, bom })
  alert(`已导出 ${list.length} 个变量`)
}
async function pickImportFile() {
  const picked = await api.fs.selectFile({ title: '选择变量文件', filters: [{ name: '变量文件', extensions: ['json', 'txt', 'reg', 'env', 'properties'] }] })
  if (!picked.ok || picked.data.canceled) return
  const read = await api.fs.readTextFile(picked.data.path)
  if (!read.ok) return alert(read.message)
  handleContent(String(read.data))
}
function parsePaste() {
  handleContent(pasteText.value)
  pasteOpen.value = false
}
function handleContent(text) {
  api.backup.parseText(text).then((res) => {
    if (!res.ok) return alert(`解析失败：${res.message}`)
    importRows.value = res.data.entries.map((e, idx) => {
      const scope = e.scope || 'user'
      const cur = env.original[scope]?.[e.name]
      const has = Object.prototype.hasOwnProperty.call(env.original[scope] || {}, e.name)
      return { __key: `${scope}::${e.name}::${idx}`, scope, name: e.name, value: e.value, targetScope: scope, current: has ? cur : null, status: !has ? 'create' : cur === e.value ? 'same' : 'conflict' }
    })
    recalc()
  })
}
function recalc() {
  for (const row of importRows.value) {
    const scope = importScope.value === 'keep' ? row.scope : importScope.value
    row.targetScope = scope
    const cur = env.original[scope]?.[row.name]
    const has = Object.prototype.hasOwnProperty.call(env.original[scope] || {}, row.name)
    row.current = has ? cur : null
    row.status = !has ? 'create' : cur === row.value ? 'same' : 'conflict'
  }
  selectedKeys.value = importRows.value.filter((r) => r.status !== 'same').map((r) => r.__key)
}
function clearImport() {
  importRows.value = []
  selectedKeys.value = []
}
function rowClass(r) {
  return r.status === 'conflict' ? 'bg-amber-500/10' : r.status === 'create' ? 'bg-emerald-500/10' : ''
}
async function doImport() {
  let targets = importRows.value.filter((r) => selectedKeys.value.includes(r.__key) && r.status !== 'same')
  if (conflictMode.value === 'skip') targets = targets.filter((r) => r.status !== 'conflict')
  if (!targets.length) return alert('没有需要导入的条目')
  const r = env.applyTemplateVars(targets.map((t) => ({ scope: t.targetScope, name: t.name, value: t.value, op: 'create' })), { source: 'import', originId: 'bulk-import', originName: '批量导入' })
  alert(`已导入 ${r.added.length} 条到草稿区`)
  clearImport()
}
function previewReplace() {
  if (!repFind.value) return
  const re = new RegExp(repFind.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), repCase.value ? 'gi' : 'g')
  repRows.value = ['user', 'machine'].flatMap((scope) =>
    env.working[scope].filter((i) => !i._deleted && String(i.value) !== String(i.value).replace(re, repReplace.value))
      .map((i) => ({ key: `${scope}::${i.name}`, scope, name: i.name, before: i.value, after: String(i.value).replace(re, repReplace.value) }))
  )
}
function applyReplace() {
  for (const r of repRows.value) env.setValue(r.scope, r.name, r.after)
  alert(`已替换 ${repRows.value.length} 条`)
  repRows.value = []
}
function previewDelete() {
  if (!delKeyword.value) return
  const kw = delKeyword.value.toLowerCase()
  delRows.value = ['user', 'machine'].flatMap((scope) =>
    env.working[scope].filter((i) => !i._deleted && i.name.toLowerCase().includes(kw))
      .map((i) => ({ key: `${scope}::${i.name}`, scope, name: i.name, value: i.value }))
  )
}
function applyDelete() {
  const byScope = {}
  for (const r of delRows.value) (byScope[r.scope] = byScope[r.scope] || []).push(r.name)
  for (const [scope, names] of Object.entries(byScope)) env.remove(scope, names)
  alert(`已标记 ${delRows.value.length} 条为待删除`)
  delRows.value = []
}
</script>
