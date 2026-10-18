<template>
  <div class="flex flex-col gap-3.5">
    <div v-if="!env.admin && scope === 'machine'" class="flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-[12px]">
      <span class="flex-1">当前为<b>普通用户权限</b>，可查看系统变量但无法写入。系统变量位于 HKLM\SYSTEM\...\Environment。</span>
      <Button size="sm" @click="elevate">以管理员身份重启</Button>
    </div>

    <Card>
      <div class="flex flex-wrap items-center gap-2 border-b border-border p-2.5">
        <span class="flex items-center gap-1.5 text-[13px] font-semibold">
          <Table2 :size="14" /> {{ scope === 'user' ? '用户变量' : '系统变量' }}
          <Badge tone="info">{{ rows.length }}</Badge>
          <Badge v-if="modifiedCount" tone="warning">{{ modifiedCount }} 项已修改</Badge>
        </span>
        <div class="ml-auto flex items-center gap-1.5">
          <Input v-model="keyword" class="!w-52" placeholder="搜索变量名或变量值" />
          <Select v-model="filterMode" :options="filterOptions" class="!w-32" />
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-1.5 border-b border-border p-2.5">
        <Button size="sm" @click="openAdd"><Plus :size="13" /> 新增变量</Button>
        <Button size="sm" variant="outline" :disabled="selection.length !== 1" @click="openRename"><Pencil :size="13" /> 重命名</Button>
        <Button size="sm" variant="destructive" :disabled="!selection.length" @click="confirmDelete"><Trash2 :size="13" /> 删除{{ selection.length ? `（${selection.length}）` : '' }}</Button>
        <Button size="sm" variant="outline" :disabled="!selection.length" @click="copy('pair')"><Copy :size="13" /> 复制</Button>
        <Button size="sm" variant="outline" @click="pasteOpen = true"><ClipboardPaste :size="13" /> 剪贴板导入</Button>
        <Button v-if="scope === 'machine'" size="sm" variant="outline" @click="pathextOpen = true"><FileBadge :size="13" /> PATHEXT 管理</Button>
        <Button v-if="hasDeleted" size="sm" variant="ghost" @click="restoreDeleted"><Undo2 :size="13" /> 取消待删除</Button>
      </div>

      <div class="p-2">
        <DataTable
          :columns="columns" :rows="rows" row-key="__key" selectable :height="460"
          :selected-keys="selectedKeys" @select="(k) => (selectedKeys = k)"
          :row-class="rowClass" @row-dblclick="(r) => focus(r)"
        >
          <template #name="{ row }">
            <span class="font-semibold">{{ row.name }}</span>
            <Badge v-if="row._isNew" tone="success" class="ml-1">新增</Badge>
            <Badge v-if="row._deleted" tone="destructive" class="ml-1">待删除</Badge>
            <Badge v-else-if="isChanged(row)" tone="warning" class="ml-1">已修改</Badge>
            <Badge v-if="metaOf(row).locked" tone="gold" class="ml-1">锁定</Badge>
            <Badge v-if="metaOf(row).sensitive" tone="volcano" class="ml-1">敏感</Badge>
            <Badge v-if="metaOf(row).favorite" tone="pink" class="ml-1">收藏</Badge>
            <div v-if="metaOf(row).remark" class="text-[10.5px] text-muted-foreground">{{ metaOf(row).remark }}</div>
            <div v-if="metaOf(row).tags?.length" class="mt-0.5 flex gap-1">
              <Badge v-for="t in metaOf(row).tags" :key="t" variant="outline">{{ t }}</Badge>
            </div>
          </template>
          <template #value="{ row }">
            <span class="mono" :class="row._deleted ? 'opacity-50' : ''">{{ displayValue(row) }}</span>
          </template>
          <template #actions="{ row }">
            <div class="flex items-center gap-2 text-[11.5px]">
              <button class="text-primary hover:underline" @click.stop="focus(row)">编辑</button>
              <button class="text-red-500 hover:underline" @click.stop="deleteOne(row)">删除</button>
              <button class="text-muted-foreground hover:underline" @click.stop="openProps(row)">属性</button>
              <button class="text-muted-foreground hover:underline" @click.stop="openRefs(row)">引用</button>
            </div>
          </template>
        </DataTable>
      </div>
    </Card>

    <!-- 详情编辑 -->
    <Card v-if="current">
      <div class="flex items-center justify-between border-b border-border p-2.5">
        <span class="flex items-center gap-1.5 text-[13px] font-semibold"><Pencil :size="14" /> 详情编辑</span>
        <Badge :tone="current.scope === 'machine' ? 'purple' : 'info'">{{ current.scope === 'machine' ? '系统变量' : '用户变量' }}</Badge>
      </div>
      <div class="space-y-2.5 p-3">
        <div class="rounded-lg border border-primary/20 bg-primary/5 p-2.5 text-[12px] text-muted-foreground">
          当前编辑内容仅写入内存草稿区，不会立即改动注册表；点击右上角「保存写入系统」才会生效。
        </div>
        <div>
          <div class="mb-1 text-[11.5px] text-muted-foreground">变量名称</div>
          <Input v-model="draftName" :disabled="isPathVar" />
        </div>
        <div>
          <div class="mb-1 text-[11.5px] text-muted-foreground">变量值（支持 %VARNAME% 引用其它变量）</div>
          <Textarea v-model="draftValue" :rows="isPathVar ? 8 : 4" class="mono" />
        </div>
        <div class="flex gap-2">
          <Button size="sm" @click="applyDraft">应用到内存</Button>
          <Button size="sm" variant="outline" @click="resetDraft">还原</Button>
          <Button size="sm" variant="outline" :disabled="!env.admin" @click="writeDirectly">立即写入系统</Button>
        </div>
        <div class="mono rounded-lg border border-border bg-muted/40 p-2.5 text-[11.5px] leading-relaxed">
          <div>原始值：{{ originalOf(current) ?? '（新增变量）' }}</div>
          <div>写入后长度：{{ draftValue.length }} 字符</div>
        </div>
      </div>
    </Card>

    <!-- 新增 -->
    <Dialog v-model:open="addOpen" title="新增环境变量" width="600px">
      <div class="mb-2 flex items-center gap-2 text-[12px]">
        <span class="muted">模板快速插入：</span>
        <Select v-model="addTpl" :options="tplOptions" class="!w-64" placeholder="选择模板一键填充" @update:model-value="applyAddTpl" />
      </div>
      <div class="space-y-2.5">
        <div><div class="mb-1 text-[11.5px] text-muted-foreground">变量名称</div><Input v-model="addForm.name" class="mono" placeholder="例如 JAVA_HOME（不能包含 = 和 %）" /></div>
        <div><div class="mb-1 text-[11.5px] text-muted-foreground">变量值</div><Textarea v-model="addForm.value" :rows="3" class="mono" /></div>
        <div class="flex items-center gap-3 text-[12px]">
          归属域：
          <label class="flex items-center gap-1"><input v-model="addForm.scope" type="radio" value="user" /> 用户变量</label>
          <label class="flex items-center gap-1" :class="env.admin ? '' : 'opacity-50'"><input v-model="addForm.scope" type="radio" value="machine" :disabled="!env.admin" /> 系统变量</label>
        </div>
      </div>
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="outline" @click="addOpen = false">取消</Button>
        <Button @click="submitAdd">确认新增</Button>
      </div>
    </Dialog>

    <!-- 重命名 -->
    <Dialog v-model:open="renameOpen" title="重命名环境变量" width="520px">
      <div class="mb-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-[12px]">
        重命名会先删除原变量再创建新变量，引用旧名称的程序可能失效。
      </div>
      <div class="space-y-2.5">
        <div><div class="mb-1 text-[11.5px] text-muted-foreground">原名称</div><Input :model-value="renameForm.oldName" disabled class="mono" /></div>
        <div><div class="mb-1 text-[11.5px] text-muted-foreground">新名称</div><Input v-model="renameForm.newName" class="mono" /></div>
      </div>
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="outline" @click="renameOpen = false">取消</Button>
        <Button @click="submitRename">确认重命名</Button>
      </div>
    </Dialog>

    <!-- 属性 -->
    <Dialog v-model:open="propsOpen" title="变量属性" width="540px">
      <div class="mono mb-2.5 text-[12px] text-muted-foreground">{{ propsForm.scope }} :: {{ propsForm.name }}</div>
      <div class="space-y-2.5">
        <div><div class="mb-1 text-[11.5px] text-muted-foreground">备注（仅本工具内部保存，不写入注册表）</div><Textarea v-model="propsForm.remark" :rows="2" /></div>
        <div><div class="mb-1 text-[11.5px] text-muted-foreground">标签（逗号分隔）</div><Input v-model="propsForm.tagsText" class="mono" /></div>
        <div class="flex gap-5 text-[12px]">
          <Checkbox v-model:checked="propsForm.locked">锁定变量（草稿区无法编辑删除）</Checkbox>
          <Checkbox v-model:checked="propsForm.favorite">加入收藏</Checkbox>
        </div>
      </div>
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="outline" @click="propsOpen = false">取消</Button>
        <Button @click="submitProps">保存</Button>
      </div>
    </Dialog>

    <!-- 引用图谱 -->
    <Dialog v-model:open="refsOpen" :title="`引用图谱 · %${refsName}%`" width="680px">
      <div class="mb-2 rounded-lg border border-primary/20 bg-primary/5 p-2.5 text-[12px]">
        查看当前系统中哪些变量引用了 <span class="mono">%{{ refsName }}%</span>，识别依赖关系，方便清理废弃变量。
      </div>
      <DataTable
        :columns="[{ key: 'scope', title: '归属', width: 70 }, { key: 'name', title: '变量', width: 170 }, { key: 'value', title: '值', ellipsis: true }, { key: 'kind', title: '类型', width: 96 }]"
        :rows="refsList" row-key="name" empty="没有任何变量引用该变量"
      >
        <template #scope="{ row }"><Badge :tone="row.scope === 'machine' ? 'purple' : 'info'">{{ row.scope === 'machine' ? '系统' : '用户' }}</Badge></template>
        <template #name="{ row }"><span class="mono">{{ row.name }}</span></template>
        <template #value="{ row }"><span class="mono">{{ row.value }}</span></template>
        <template #kind="{ row }"><Badge :tone="row.kind === 'path-entry' ? 'cyan' : 'info'">{{ row.kind === 'path-entry' ? 'PATH 条目' : '变量引用' }}</Badge></template>
      </DataTable>
    </Dialog>

    <!-- 剪贴板导入 -->
    <Dialog v-model:open="pasteOpen" title="从剪贴板导入变量" width="620px">
      <div class="mb-2 rounded-lg border border-primary/20 bg-primary/5 p-2.5 text-[12px]">
        每行一条 <span class="mono">key=value</span>，<span class="mono">#</span> 开头为注释。
      </div>
      <Textarea v-model="pasteText" :rows="9" class="mono" placeholder="JAVA_HOME=C:\dev\soft\jdk-17" />
      <div class="mt-4 flex items-center justify-end gap-2">
        <span class="muted mr-auto text-[11.5px]">导入到：{{ pasteScope === 'user' ? '用户变量' : '系统变量' }}</span>
        <Button variant="outline" size="sm" @click="pasteScope = pasteScope === 'user' ? 'machine' : 'user'">切换归属域</Button>
        <Button size="sm" @click="submitPaste">解析并加入草稿</Button>
      </div>
    </Dialog>

    <!-- PATHEXT -->
    <Dialog v-model:open="pathextOpen" title="PATHEXT 可执行后缀管理" width="560px">
      <div class="mb-2 rounded-lg border border-primary/20 bg-primary/5 p-2.5 text-[12px]">
        PATHEXT 决定无扩展名命令按什么后缀查找可执行文件。修改进入草稿区，保存后生效。
      </div>
      <div class="mb-2 flex items-center gap-2">
        <Input v-model="pathextNew" class="mono !w-40" placeholder=".PS1" @keydown.enter="addPathext" />
        <Button size="sm" variant="outline" @click="addPathext"><Plus :size="13" /> 添加后缀</Button>
      </div>
      <div class="flex flex-wrap gap-1.5">
        <span v-for="e in pathextEntries" :key="e" class="mono inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[12px] text-primary">
          {{ e }}<button class="hover:text-red-500" @click="pathextEntries = pathextEntries.filter((x) => x !== e)">×</button>
        </span>
      </div>
      <div v-if="pathextInvalid.length" class="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 p-2.5 text-[12px] text-red-600">
        非法后缀：{{ pathextInvalid.join('、') }}（必须形如 .EXE）
      </div>
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="outline" @click="pathextOpen = false">取消</Button>
        <Button @click="submitPathext">保存到草稿</Button>
      </div>
    </Dialog>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import {
  Table2, Plus, Pencil, Trash2, Copy, ClipboardPaste, FileBadge, Undo2
} from 'lucide-vue-next'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Textarea from '@/components/ui/Textarea.vue'
import Badge from '@/components/ui/Badge.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Select from '@/components/ui/Select.vue'
import Checkbox from '@/components/ui/Checkbox.vue'
import DataTable from '@/components/ui/DataTable.vue'
import { useRoute } from 'vue-router'
import { useEnvStore } from '@/store/env'
import api from '@/api'
import { clip, detectSensitive } from '@/lib/utils'

const env = useEnvStore()
const route = useRoute()
const scope = computed(() => (route.path === '/system' ? 'machine' : 'user'))

const keyword = ref('')
const filterMode = ref('all')
const selectedKeys = ref([])
const currentKey = ref('')
const draftName = ref('')
const draftValue = ref('')
const addOpen = ref(false)
const renameOpen = ref(false)
const propsOpen = ref(false)
const refsOpen = ref(false)
const pasteOpen = ref(false)
const pathextOpen = ref(false)
const addTpl = ref(undefined)
const pasteScope = ref('user')

const addForm = ref({ name: '', value: '', scope: 'user' })
const renameForm = ref({ oldName: '', newName: '' })
const propsForm = ref({ scope: 'user', name: '', remark: '', tagsText: '', locked: false, favorite: false })
const refsName = ref('')
const refsList = ref([])
const pathextNew = ref('')
const pathextEntries = ref([])

const tplOptions = [
  { label: 'JAVA_HOME（JDK 主目录）', value: 'java' },
  { label: 'NODE_HOME（Node 主目录）', value: 'node' },
  { label: 'MAVEN_HOME + MAVEN_OPTS', value: 'maven' },
  { label: '代理变量 http_proxy / https_proxy', value: 'proxy' }
]
const TPL_VARS = {
  java: [{ name: 'JAVA_HOME', value: 'C:\\dev\\soft\\jdk-17' }],
  node: [{ name: 'NODE_HOME', value: 'C:\\dev\\soft\\node-v22' }],
  maven: [{ name: 'MAVEN_HOME', value: 'C:\\dev\\soft\\maven' }, { name: 'MAVEN_OPTS', value: '-Xms128m -Xmx512m' }],
  proxy: [{ name: 'http_proxy', value: 'http://127.0.0.1:7890' }, { name: 'https_proxy', value: 'http://127.0.0.1:7890' }]
}

const filterOptions = [
  { label: '全部变量', value: 'all' },
  { label: '仅已修改项', value: 'modified' },
  { label: '仅收藏', value: 'fav' },
  { label: '仅敏感', value: 'sensitive' }
]

const allRows = computed(() => env.working[scope.value].map((i) => ({ ...i, __key: `${i.scope}::${i.name}` })))
const rows = computed(() => {
  let list = allRows.value
  if (filterMode.value === 'modified') list = list.filter((r) => isChanged(r))
  else if (filterMode.value === 'fav') list = list.filter((r) => metaOf(r).favorite)
  else if (filterMode.value === 'sensitive') list = list.filter((r) => metaOf(r).sensitive)
  const kw = keyword.value.trim().toLowerCase()
  if (kw) list = list.filter((r) => r.name.toLowerCase().includes(kw) || String(r.value).toLowerCase().includes(kw))
  return [...list].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
})
const selection = computed(() => allRows.value.filter((r) => selectedKeys.value.includes(r.__key)))
const current = computed(() => allRows.value.find((r) => r.__key === currentKey.value) || null)
const isPathVar = computed(() => current.value?.name.toUpperCase() === 'PATH')
const modifiedCount = computed(() => rows.value.filter((r) => isChanged(r)).length)
const hasDeleted = computed(() => allRows.value.some((r) => r._deleted))
const pathextInvalid = computed(() => pathextEntries.value.filter((e) => !/^\.[A-Za-z0-9]{1,8}$/.test(e)))

const columns = [
  { key: 'name', title: '变量名称', width: 260 },
  { key: 'value', title: '变量值', ellipsis: true },
  { key: 'actions', title: '操作', width: 150 }
]

function metaOf(record) {
  return env.meta.vars[`${record.scope}::${String(record.name).toUpperCase()}`] || {}
}
function isChanged(record) {
  if (record._isNew) return true
  return env.changedKeys.has(`${record.scope}::${record.name.toUpperCase()}`) || env.changedKeys.has(`${record.scope}::${record.origName?.toUpperCase?.() || ''}`)
}
function rowClass(record) {
  return record._deleted ? 'bg-red-500/10' : record._isNew ? 'bg-emerald-500/10' : isChanged(record) ? 'bg-amber-500/10' : ''
}
function displayValue(record) {
  const v = String(record.value ?? '')
  if (!v) return '（空）'
  if (record.name.toUpperCase() === 'PATH') return `${v.split(';').filter(Boolean).length} 条路径 · ${v.length} 字符`
  return clip(v, 160)
}
function originalOf(record) {
  const key = record.origName || record.name
  const map = env.original[record.scope] || {}
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined
}
function applyAddTpl(id) {
  const t = TPL_VARS[id]
  if (t?.length) {
    addForm.value.name = t[0].name
    addForm.value.value = t[0].value
  }
}
function focus(record) {
  currentKey.value = record.__key
  draftName.value = record.name
  draftValue.value = String(record.value ?? '')
}
function resetDraft() {
  if (current.value) focus(current.value)
}
function applyDraft() {
  if (!current.value) return
  try {
    if (draftName.value.trim() !== current.value.name) {
      if (isPathVar.value) throw new Error('PATH 变量不支持重命名')
      env.rename(current.value.scope, current.value.name, draftName.value.trim())
      currentKey.value = `${current.value.scope}::${draftName.value.trim()}`
    }
    env.setValue(current.value.scope, draftName.value.trim(), draftValue.value)
    alert('已应用到内存，记得点击「保存写入系统」')
  } catch (err) {
    alert(err.message)
  }
}
async function writeDirectly() {
  if (!current.value) return
  const res = await api.env.writeOne({ name: draftName.value.trim(), value: draftValue.value, scope: current.value.scope })
  if (res.ok) {
    alert('已直接写入系统')
    await env.load()
  } else alert(res.message)
}
function openAdd() {
  addForm.value = { name: '', value: '', scope: scope.value }
  addOpen.value = true
}
function applyAddTplNoop() {}
function submitAdd() {
  const name = addForm.value.name.trim()
  if (!name) return alert('请输入变量名称')
  if (/[=%]/.test(name)) return alert('变量名称不能包含 = 或 %')
  try {
    env.add(addForm.value.scope, name, addForm.value.value)
    addOpen.value = false
    currentKey.value = `${addForm.value.scope}::${name}`
    draftName.value = name
    draftValue.value = addForm.value.value
  } catch (err) {
    alert(err.message)
  }
}
function openRename() {
  const t = selection.value[0]
  if (!t) return
  renameForm.value = { oldName: t.name, newName: t.name }
  renameOpen.value = true
}
function submitRename() {
  const name = renameForm.value.newName.trim()
  if (!name) return alert('请输入新名称')
  try {
    env.rename(selection.value[0].scope, renameForm.value.oldName, name)
    renameOpen.value = false
  } catch (err) {
    alert(err.message)
  }
}
function deleteOne(record) {
  if (record.scope === 'machine' && !env.admin) return alert('普通权限下不能删除系统变量')
  if (!confirm(`确认标记删除「${record.name}」？点击「保存写入系统」后才会真正移除。`)) return
  env.remove(record.scope, [record.name])
  selectedKeys.value = selectedKeys.value.filter((k) => k !== record.__key)
}
function confirmDelete() {
  const targets = selection.value.filter((r) => !r._deleted)
  if (!targets.length) return
  const names = targets.map((t) => `· [${t.scope === 'machine' ? '系统' : '用户'}] ${t.name}`).join('\n')
  if (!confirm(`确认标记删除 ${targets.length} 个变量？\n${names}`)) return
  const byScope = {}
  for (const t of targets) (byScope[t.scope] = byScope[t.scope] || []).push(t.name)
  for (const [scope, names] of Object.entries(byScope)) env.remove(scope, names)
  selectedKeys.value = []
}
function restoreDeleted() {
  for (const scope of ['user', 'machine']) {
    const names = env.working[scope].filter((i) => i._deleted && !i._isNew).map((i) => i.name)
    if (names.length) env.restore(scope, names)
  }
}
async function copy(kind) {
  const targets = selection.value
  if (!targets.length) return
  const text = kind === 'pair' ? targets.map((t) => `${t.name}=${t.value}`).join('\r\n') : targets.map((t) => t.value).join('\r\n')
  await navigator.clipboard.writeText(text)
}
function openProps(record) {
  const m = metaOf(record)
  propsForm.value = {
    scope: record.scope, name: record.name,
    remark: m.remark || '', tagsText: (m.tags || []).join(', '),
    locked: !!m.locked, favorite: !!m.favorite
  }
  propsOpen.value = true
}
async function submitProps() {
  const p = propsForm.value
  const res = await api.meta.set({ scope: p.scope, name: p.name, patch: { remark: p.remark, tags: p.tagsText.split(',').map((t) => t.trim()).filter(Boolean), locked: p.locked, favorite: p.favorite } })
  if (res.ok) {
    const key = `${p.scope}::${String(p.name).toUpperCase()}`
    env.meta.vars[key] = { ...(env.meta.vars[key] || {}), remark: p.remark, tags: p.tagsText.split(',').map((t) => t.trim()).filter(Boolean), locked: p.locked, favorite: p.favorite }
    propsOpen.value = false
  } else alert(res.message)
}
async function openRefs(record) {
  refsName.value = record.name
  const res = await api.analyze.refs({ name: record.name })
  refsList.value = res.ok ? res.data.referencedBy : []
  refsOpen.value = true
}
function submitPaste() {
  const lines = String(pasteText.value || '').split(/\r?\n/)
  let n = 0
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf('=')
    if (idx <= 0) continue
    let name = line.slice(0, idx).trim()
    let value = line.slice(idx + 1)
    if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1)
    if (!name || /[=%]/.test(name)) continue
    try {
      env.add(pasteScope.value, name, value, { source: 'import', originId: 'clipboard', originName: '剪贴板导入' })
      n += 1
    } catch (_) { /* skip */ }
  }
  pasteOpen.value = false
  pasteText.value = ''
  if (n) alert(`已添加 ${n} 条变量到草稿区（来源：批量导入）`)
}
function addPathext() {
  const v = pathextNew.value.trim().toUpperCase()
  if (!/^\.[A-Za-z0-9]{1,8}$/.test(v)) return alert('后缀必须形如 .EXE（1~8 位字母数字）')
  if (pathextEntries.value.some((x) => x.toLowerCase() === v.toLowerCase())) return
  pathextEntries.value.push(v)
  pathextNew.value = ''
}
async function submitPathext() {
  const value = pathextEntries.value.join(';')
  const res = await api.env.validatePathext(value)
  if (!res.ok || !res.data.valid) return alert('校验未通过')
  try {
    if (env.findItem('machine', 'PATHEXT')) env.setValue('machine', 'PATHEXT', value)
    else env.add('machine', 'PATHEXT', value)
    pathextOpen.value = false
  } catch (err) {
    alert(err.message)
  }
}

watch(pathextOpen, (v) => {
  if (v) {
    const hit = env.working.machine.find((i) => i.name.toUpperCase() === 'PATHEXT')
    pathextEntries.value = String(hit ? hit.value : '.COM;.EXE;.BAT;.CMD').split(';').map((s) => s.trim()).filter(Boolean)
  }
})

function elevate() {
  api.tool.elevate().then((res) => {
    if (!res.ok) alert(res.message)
  })
}

// 敏感值自动标记
watch(allRows, (rows) => {
  for (const r of rows) {
    if (detectSensitive(r.name, r.value).length && !metaOf(r).sensitive) {
      const key = `${r.scope}::${String(r.name).toUpperCase()}`
      env.meta.vars[key] = { ...(env.meta.vars[key] || {}), sensitive: true }
    }
  }
}, { immediate: true })
</script>
