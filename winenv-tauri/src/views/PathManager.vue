<template>
  <div class="flex flex-col gap-3.5">
    <div class="rounded-lg border border-primary/20 bg-primary/5 p-2.5 text-[12px] text-muted-foreground">
      PATH 决定系统在哪些目录中查找可执行程序。<b class="text-foreground">顺序即优先级</b>，越靠前越优先。支持上移/下移/启用/禁用/删除，以及批量去重与有效性校验。
    </div>

    <Card>
      <div class="flex flex-wrap items-center gap-2 border-b border-border p-2.5">
        <span class="flex items-center gap-1.5 text-[13px] font-semibold"><Route :size="14" /> PATH 路径管理</span>
        <div class="flex overflow-hidden rounded-md border border-border text-[12px]">
          <button class="px-2.5 py-1" :class="scope === 'user' ? 'bg-primary text-white' : ''" @click="scope = 'user'">用户 PATH</button>
          <button class="px-2.5 py-1" :class="scope === 'machine' ? 'bg-primary text-white' : ''" @click="scope = 'machine'">系统 PATH</button>
        </div>
        <Badge tone="info">{{ items.length }} 条</Badge>
        <Badge v-if="invalidCount" tone="destructive">{{ invalidCount }} 条无效</Badge>
        <Badge :tone="valueLength > 2047 ? 'destructive' : valueLength > 1800 ? 'warning' : 'info'">{{ valueLength }} 字符</Badge>
        <div class="ml-auto flex flex-wrap items-center gap-1.5">
          <Button size="sm" @click="openAdd"><Plus :size="13" /> 新增路径</Button>
          <Button size="sm" variant="outline" :loading="validating" @click="validateAll"><ShieldCheck :size="13" /> 校验有效性</Button>
          <Button size="sm" variant="outline" :disabled="!invalidCount" @click="cleanInvalid"><Eraser :size="13" /> 清理无效</Button>
          <Button size="sm" variant="outline" @click="dedupe"><Copy :size="13" /> 一键去重</Button>
          <Button size="sm" variant="outline" @click="sortPaths(1)">A→Z</Button>
          <Button size="sm" variant="outline" @click="sortPaths(-1)">Z→A</Button>
          <Button size="sm" variant="outline" @click="importList"><Upload :size="13" /> 导入</Button>
          <Button size="sm" variant="outline" @click="exportList"><Download :size="13" /> 导出</Button>
          <Button size="sm" variant="outline" @click="exportScript('cmd')"><Terminal :size="13" /> CMD 脚本</Button>
          <Button size="sm" variant="outline" @click="exportScript('ps')"><Terminal :size="13" /> PS 脚本</Button>
          <Button size="sm" @click="savePath"><Save :size="13" /> 保存 PATH 到系统</Button>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-1.5 border-b border-border p-2.5 text-[12px]">
        <span class="muted">批量：</span>
        <Button size="sm" variant="outline" :disabled="!selected.length" @click="batchMove(-1)"><ArrowUp :size="13" /> 上移</Button>
        <Button size="sm" variant="outline" :disabled="!selected.length" @click="batchMove(1)"><ArrowDown :size="13" /> 下移</Button>
        <Button size="sm" variant="destructive" :disabled="!selected.length" @click="batchDelete"><Trash2 :size="13" /> 批量删除（{{ selected.length }}）</Button>
        <span class="muted ml-3">常用目录：</span>
        <button
          v-for="p in presets" :key="p"
          class="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary hover:bg-primary/20"
          @click="addPreset(p)"
        >+ {{ p }}</button>
      </div>

      <div class="p-2">
        <DataTable
          :columns="columns" :rows="items" row-key="id" selectable :height="400"
          :selected-keys="selectedRowKeys" @select="(k) => (selectedRowKeys = k)" :row-class="rowClass"
        >
          <template #index="{ row }"><span class="mono text-muted-foreground">{{ items.indexOf(row) + 1 }}</span></template>
          <template #path="{ row }">
            <span class="mono" :style="{ opacity: row.disabled ? 0.45 : 1 }">{{ row.path }}</span>
            <Badge v-if="row.disabled" class="ml-1.5">已禁用</Badge>
            <Badge v-else-if="row.invalid" tone="destructive" class="ml-1.5">目录不存在</Badge>
            <Badge v-if="sourceTag(row.path)" :tone="sourceTone(row.path)" class="ml-1">{{ sourceTag(row.path) }}</Badge>
            <div v-if="pathRemark(row)" class="text-[10.5px] text-muted-foreground">{{ pathRemark(row) }}</div>
          </template>
          <template #status="{ row }">
            <Badge v-if="row.disabled">未生效</Badge>
            <Badge v-else-if="row.invalid" tone="destructive">无效</Badge>
            <Badge v-else-if="row.checked" tone="success">有效</Badge>
            <Badge v-else tone="info">未校验</Badge>
          </template>
          <template #actions="{ row }">
            <div class="flex items-center gap-1.5 text-[11.5px]">
              <button class="text-primary hover:underline" :disabled="items.indexOf(row) === 0" @click.stop="move(items.indexOf(row), -1)">上移</button>
              <button class="text-primary hover:underline" :disabled="items.indexOf(row) === items.length - 1" @click.stop="move(items.indexOf(row), 1)">下移</button>
              <button class="text-primary hover:underline" @click.stop="toggleDisabled(row)">{{ row.disabled ? '启用' : '禁用' }}</button>
              <button class="text-primary hover:underline" @click.stop="openEdit(row)">编辑</button>
              <button class="text-muted-foreground hover:underline" @click.stop="openRemark(row)">备注</button>
              <button class="text-primary hover:underline" @click.stop="openDir(row)">打开</button>
              <button class="text-red-500 hover:underline" @click.stop="deleteOne(row)">删除</button>
            </div>
          </template>
        </DataTable>
      </div>
    </Card>

    <Card>
      <div class="flex items-center justify-between border-b border-border p-2.5">
        <span class="flex items-center gap-1.5 text-[13px] font-semibold"><FileText :size="14" /> 合并预览（写入后的完整 PATH）</span>
        <Button size="sm" variant="outline" @click="copyValue"><Copy :size="13" /> 复制完整 PATH</Button>
      </div>
      <div class="p-3">
        <div v-if="valueLength > 2047" class="mb-2 rounded-lg border border-red-500/40 bg-red-500/10 p-2.5 text-[12px] text-red-600">
          当前 PATH 已超过 2047 字符上限，可能导致部分程序读取失败，建议清理无效路径。
        </div>
        <div class="mono max-h-36 overflow-auto rounded-lg border border-border bg-muted/40 p-2.5 leading-relaxed text-muted-foreground">{{ mergedValue || '（空）' }}</div>
      </div>
    </Card>

    <!-- 新增 / 编辑 -->
    <Dialog v-model:open="editOpen" :title="editForm.mode === 'add' ? '新增 PATH 路径' : '编辑 PATH 路径'" width="600px">
      <Input v-model="editForm.path" class="mono" placeholder="C:\your\tool\bin 或 %LOCALAPPDATA%\Programs" />
      <div class="mt-2.5 flex items-center gap-2">
        <Button size="sm" variant="outline" @click="pickFolder"><FolderOpen :size="13" /> 浏览文件夹</Button>
        <Button size="sm" variant="outline" @click="previewExpand">解析预览</Button>
        <span v-if="editForm.expanded" class="mono text-[11.5px] text-muted-foreground">{{ editForm.expanded }}</span>
      </div>
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="outline" @click="editOpen = false">取消</Button>
        <Button @click="submitEdit">确认</Button>
      </div>
    </Dialog>

    <!-- 备注 -->
    <Dialog v-model:open="remarkOpen" title="PATH 条目备注" width="520px">
      <div class="mb-2 rounded-lg border border-primary/20 bg-primary/5 p-2.5 text-[12px]">备注仅本工具内部保存，不写入注册表。</div>
      <p class="mono mb-1.5 text-[11.5px] text-muted-foreground">{{ remarkPath }}</p>
      <Textarea v-model="remarkText" :rows="3" />
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="outline" @click="remarkOpen = false">取消</Button>
        <Button @click="submitRemark">保存</Button>
      </div>
    </Dialog>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import {
  Route, Plus, ShieldCheck, Eraser, Copy, Upload, Download, Terminal, Save,
  ArrowUp, ArrowDown, Trash2, FileText, FolderOpen
} from 'lucide-vue-next'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'
import Badge from '@/components/ui/Badge.vue'
import Input from '@/components/ui/Input.vue'
import Textarea from '@/components/ui/Textarea.vue'
import Dialog from '@/components/ui/Dialog.vue'
import DataTable from '@/components/ui/DataTable.vue'
import { useEnvStore } from '@/store/env'
import api from '@/api'
import { buildScript } from '@/lib/utils'

const env = useEnvStore()
const scope = ref('user')
const selectedRowKeys = ref([])
const validating = ref(false)
const checks = ref({})
const editOpen = ref(false)
const editForm = ref({ mode: 'add', path: '', index: '', expanded: '' })
const remarkOpen = ref(false)
const remarkPath = ref('')
const remarkText = ref('')

const presets = ['C:\\bin', '%LOCALAPPDATA%\\Programs', '%USERPROFILE%\\go\\bin', 'C:\\tools\\nodejs', 'C:\\tools\\Python315', 'C:\\tools\\Python315\\Scripts']

const SOURCE_TAGS = [
  { test: /jdk|java/i, name: 'JDK', tone: 'warning' },
  { test: /node|npm|nvm/i, name: 'Node', tone: 'success' },
  { test: /python|conda/i, name: 'Python', tone: 'info' },
  { test: /git/i, name: 'Git', tone: 'destructive' },
  { test: /cargo|rust/i, name: 'Rust', tone: 'volcano' },
  { test: /maven|gradle/i, name: '构建工具', tone: 'purple' }
]
function sourceTag(p) {
  return (SOURCE_TAGS.find((t) => t.test.test(p)) || {}).name || ''
}
function sourceTone(p) {
  return (SOURCE_TAGS.find((t) => t.test.test(p)) || {}).tone || 'default'
}

const items = computed(() =>
  env.pathItems[scope.value].map((i) => ({
    ...i,
    checked: checks.value[i.path]?.checked,
    invalid: checks.value[i.path] ? !checks.value[i.path].exists : false
  }))
)
const selected = computed(() => items.value.filter((i) => selectedRowKeys.value.includes(i.id)))
const invalidCount = computed(() => items.value.filter((i) => i.invalid).length)
const mergedValue = computed(() => items.value.filter((i) => !i.disabled).map((i) => i.path).join(';'))
const valueLength = computed(() => mergedValue.value.length)

const columns = [
  { key: 'index', title: '#', width: 40 },
  { key: 'path', title: '路径', ellipsis: true },
  { key: 'size', title: '长度', width: 58 },
  { key: 'status', title: '状态', width: 84 },
  { key: 'actions', title: '操作', width: 250 }
]

function rowClass() {
  return ''
}
function pathRemark(record) {
  return env.meta.path[`${scope.value}::${record.path.toLowerCase()}`]?.remark || ''
}
function commit(list) {
  env.setPathItems(scope.value, list)
}
function move(index, delta) {
  const list = items.value.map((i) => ({ ...i }))
  const target = index + delta
  if (target < 0 || target >= list.length) return
  ;[list[index], list[target]] = [list[target], list[index]]
  commit(list)
  selectedRowKeys.value = []
}
function batchMove(delta) {
  const sel = new Set(selectedRowKeys.value)
  const list = items.value.map((i) => ({ ...i }))
  const idxs = list.map((i, idx) => (sel.has(i.id) ? idx : -1)).filter((i) => i >= 0)
  const ordered = delta < 0 ? idxs : [...idxs].reverse()
  for (const i of ordered) {
    const t = i + delta
    if (t < 0 || t >= list.length) continue
    ;[list[i], list[t]] = [list[t], list[i]]
  }
  commit(list)
  selectedRowKeys.value = []
}
function toggleDisabled(record) {
  commit(items.value.map((i) => (i.id === record.id ? { ...i, disabled: !i.disabled } : { ...i })))
}
function batchDelete() {
  if (!confirm(`确认删除 ${selected.value.length} 条 PATH 路径？`)) return
  const ids = new Set(selected.value.map((s) => s.id))
  commit(items.value.filter((i) => !ids.has(i.id)))
  selectedRowKeys.value = []
}
function deleteOne(record) {
  if (!confirm(`确认删除该路径？\n${record.path}`)) return
  commit(items.value.filter((i) => i.id !== record.id))
}
function sortPaths(dir) {
  commit([...items.value].sort((a, b) => (dir === 1 ? a.path.localeCompare(b.path) : b.path.localeCompare(a.path))))
}
function openAdd() {
  editForm.value = { mode: 'add', path: '', index: '', expanded: '' }
  editOpen.value = true
}
function openEdit(record) {
  editForm.value = { mode: 'edit', path: record.path, index: record.id, expanded: '' }
  editOpen.value = true
}
async function pickFolder() {
  const res = await api.fs.selectFolder({ title: '选择要加入 PATH 的文件夹' })
  if (res.ok && !res.data.canceled) editForm.value.path = res.data.path
}
async function previewExpand() {
  const res = await api.env.expandString(editForm.value.path)
  if (res.ok) editForm.value.expanded = `→ ${res.data}`
}
function submitEdit() {
  const p = editForm.value.path.trim()
  if (!p) return
  const list = items.value.map((i) => ({ ...i }))
  if (editForm.value.mode === 'add') list.push({ id: `${scope.value}-n-${Date.now()}`, path: p, scope: scope.value, disabled: false, meta: {} })
  else {
    const idx = list.findIndex((i) => i.id === editForm.value.index)
    if (idx >= 0) list[idx].path = p
  }
  commit(list)
  editOpen.value = false
}
function addPreset(p) {
  const added = env.appendPaths(scope.value, [p])
  alert(added.length ? `已添加 ${added[0]}` : '该路径已存在，已自动跳过')
}
async function validateAll() {
  const list = items.value.filter((i) => !i.disabled).map((i) => i.path)
  validating.value = true
  try {
    const res = await api.env.validatePath(list)
    if (!res.ok) throw new Error(res.message)
    const map = {}
    for (const r of res.data.result) map[r.path] = { checked: true, exists: r.exists }
    checks.value = { ...checks.value, ...map }
    alert(res.data.invalid.length ? `校验完成，发现 ${res.data.invalid.length} 条无效路径（已标红）` : '全部路径有效')
  } catch (err) {
    alert(err.message)
  } finally {
    validating.value = false
  }
}
function cleanInvalid() {
  const bad = items.value.filter((i) => i.invalid)
  if (!bad.length || !confirm(`确认清理 ${bad.length} 条无效路径？`)) return
  const ids = new Set(bad.map((b) => b.id))
  commit(items.value.filter((i) => !ids.has(i.id)))
}
function dedupe() {
  const dups = env.findDuplicatePaths(scope.value)
  if (!dups.length) return alert('当前 PATH 中没有重复条目')
  if (!confirm(`发现 ${dups.length} 条重复路径，保留首次出现条目，删除后面重复项？`)) return
  env.removePathDuplicates(scope.value, dups.map((d) => d.id))
}
function openRemark(record) {
  remarkPath.value = record.path
  remarkText.value = env.meta.path[`${scope.value}::${record.path.toLowerCase()}`]?.remark || ''
  remarkOpen.value = true
}
async function submitRemark() {
  const res = await api.meta.pathSet({ scope: scope.value, path: remarkPath.value, patch: { remark: remarkText.value } })
  if (res.ok) {
    env.meta.path[`${scope.value}::${remarkPath.value.toLowerCase()}`] = { remark: remarkText.value }
    remarkOpen.value = false
  }
}
async function importList() {
  const picked = await api.fs.selectFile({ title: '选择路径清单文件', filters: [{ name: '文本', extensions: ['txt', 'json'] }] })
  if (!picked.ok || picked.data.canceled) return
  const read = await api.fs.readTextFile(picked.data.path)
  if (!read.ok) return alert(read.message)
  const lines = String(read.data).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  const added = env.appendPaths(scope.value, lines)
  alert(`已导入 ${added.length} 条新路径（自动去重）`)
}
async function exportList() {
  const list = items.value.filter((i) => !i.disabled).map((i) => i.path)
  const saved = await api.fs.saveFile({ title: '导出 PATH 列表', defaultPath: `PathList-${scope.value}.txt`, filters: [{ name: '文本', extensions: ['txt'] }] })
  if (!saved.ok || saved.data.canceled) return
  await api.fs.writeTextFile({ file: saved.data.path, content: list.join('\r\n'), bom: true })
  alert('导出成功')
}
async function exportScript(shell) {
  const vars = items.value.filter((i) => !i.disabled).map((i) => ({ name: 'PATH', value: i.path, action: 'create' }))
  const saved = await api.fs.saveFile({
    title: '导出 PATH 脚本',
    defaultPath: `path-${scope.value}.${shell === 'cmd' ? 'bat' : 'ps1'}`,
    filters: [{ name: shell === 'cmd' ? '批处理' : 'PowerShell', extensions: [shell === 'cmd' ? 'bat' : 'ps1'] }]
  })
  if (!saved.ok || saved.data.canceled) return
  await api.fs.writeTextFile({ file: saved.data.path, content: buildScript(vars, shell === 'cmd' ? 'cmd' : 'ps') })
  alert('脚本已导出')
}
async function openDir(record) {
  const res = await api.env.expandString(record.path)
  await api.tool.openFolder(res.ok ? res.data : record.path)
}
function copyValue() {
  navigator.clipboard.writeText(mergedValue.value)
}
async function savePath() {
  if (scope.value === 'machine' && !env.admin) return alert('普通权限无法写入系统 PATH，请先提权')
  const res = await api.env.savePathItems({ scope: scope.value, items: items.value.filter((i) => !i.disabled) })
  if (res.ok) {
    alert(`已写入${scope.value === 'machine' ? '系统' : '用户'} PATH（${res.data.length} 字符）`)
    await env.load()
  } else alert(res.message)
}
watch(scope, () => (selectedRowKeys.value = []))
</script>
