<template>
  <div class="flex flex-col gap-3.5">
    <div class="rounded-lg border border-primary/20 bg-primary/5 p-2.5 text-[12px] text-muted-foreground">
      配置集用于保存多套完整环境变量配置并一键切换，适合区分开发 / 测试 / 项目独立环境。<b class="text-foreground">加载后所有变量变更加入草稿区</b>，确认后统一【保存写入系统】。
    </div>

    <div class="flex flex-wrap items-center gap-1.5">
      <Button size="sm" @click="openCreate"><Plus :size="13" /> 新建配置集</Button>
      <Button size="sm" variant="outline" @click="openImport"><Upload :size="13" /> 导入配置集</Button>
      <Button size="sm" variant="outline" @click="mutexOpen = true"><Ban :size="13" /> 互斥组管理（{{ setStore.mutex.length }}）</Button>
      <Button size="sm" variant="outline" @click="setStore.load()"><RotateCw :size="13" /> 刷新</Button>
    </div>

    <Card>
      <div class="p-2">
        <DataTable :columns="setColumns" :rows="setStore.sets" row-key="id" :height="380" empty="还没有配置集，点击「新建配置集」创建">
          <template #name="{ row }">
            <span class="font-semibold">{{ row.name }}</span>
            <Badge v-if="row.type === 'project'" tone="cyan" class="ml-1">项目</Badge>
            <Badge v-if="row.readOnly" tone="gold" class="ml-1">只读</Badge>
            <Badge v-if="isLoaded(row.id)" tone="success" class="ml-1">已加载</Badge>
          </template>
          <template #type="{ row }"><Badge :tone="row.type === 'project' ? 'cyan' : 'info'">{{ row.type === 'project' ? '项目配置集' : '全局配置集' }}</Badge></template>
          <template #mutex="{ row }">
            <Badge v-if="row.mutexId" tone="warning">{{ mutexName(row.mutexId) }}</Badge>
            <span v-else class="text-muted-foreground">—</span>
          </template>
          <template #vars="{ row }">
            <span class="mono">{{ (row.variables || []).length }} 个变量</span>
            <span v-if="row.projectDir" class="text-muted-foreground"> · {{ row.projectDir }}</span>
          </template>
          <template #actions="{ row }">
            <div class="flex items-center gap-2 text-[11.5px]">
              <button class="text-primary hover:underline" @click="loadOne(row)">加载</button>
              <button v-if="isLoaded(row.id)" class="text-primary hover:underline" @click="unloadOne(row)">卸载草稿</button>
              <button class="text-primary hover:underline" @click="editSet(row)">编辑</button>
              <button class="text-primary hover:underline" @click="launchTerminal(row)">临时终端</button>
              <button class="text-primary hover:underline" @click="exportSet(row)">导出</button>
              <button class="text-red-500 hover:underline" @click="deleteSet(row)">删除</button>
            </div>
          </template>
        </DataTable>
      </div>
    </Card>

    <!-- 编辑 -->
    <Dialog v-model:open="editOpen" :title="form.id ? '编辑配置集' : '新建配置集'" width="720px">
      <div class="space-y-2.5">
        <div class="grid grid-cols-2 gap-2.5">
          <div><div class="mb-1 text-[11.5px] text-muted-foreground">配置集名称</div><Input v-model="form.name" /></div>
          <div>
            <div class="mb-1 text-[11.5px] text-muted-foreground">类型</div>
            <div class="flex overflow-hidden rounded-md border border-border text-[12px]">
              <button class="px-2.5 py-1" :class="form.type === 'global' ? 'bg-primary text-white' : ''" @click="form.type = 'global'">全局配置集</button>
              <button class="px-2.5 py-1" :class="form.type === 'project' ? 'bg-primary text-white' : ''" @click="form.type = 'project'">项目独立环境</button>
            </div>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-2.5">
          <div><div class="mb-1 text-[11.5px] text-muted-foreground">分组</div><Input v-model="form.group" placeholder="例如 Java / 前端" /></div>
          <div>
            <div class="mb-1 text-[11.5px] text-muted-foreground">互斥组</div>
            <Select v-model="form.mutexId" :options="setStore.mutex.map((m) => ({ label: m.name, value: m.id }))" class="!w-full" placeholder="不加入互斥组" />
          </div>
        </div>
        <div><div class="mb-1 text-[11.5px] text-muted-foreground">备注</div><Input v-model="form.comment" /></div>
        <template v-if="form.type === 'project'">
          <div>
            <div class="mb-1 text-[11.5px] text-muted-foreground">绑定项目目录</div>
            <div class="flex gap-2"><Input v-model="form.projectDir" class="mono flex-1" /><Button size="sm" variant="outline" @click="pickDir">浏览</Button></div>
          </div>
          <Checkbox v-model:checked="form.folderWatch">开启文件夹监听（进入项目目录时提醒加载本套环境）</Checkbox>
        </template>
        <div class="flex items-center gap-2">
          <span class="text-[12px] font-semibold">变量（{{ form.variables.length }}）</span>
          <Button size="sm" variant="outline" @click="form.variables.push({ scope: 'user', key: '', value: '', remark: '' })"><Plus :size="13" /> 新增</Button>
          <Select v-model="tplPick" :options="setStore.templates.map((t) => ({ label: `${t.name}（${t.desc}）`, value: t.id }))" class="!w-56" placeholder="从模板库导入" @update:model-value="importTemplate" />
        </div>
        <div class="max-h-52 space-y-1.5 overflow-auto rounded-lg border border-border bg-muted/40 p-2">
          <div v-for="(v, i) in form.variables" :key="i" class="flex items-center gap-1.5">
            <select v-model="v.scope" class="h-7 rounded-md border border-input bg-card px-1.5 text-[11.5px]">
              <option value="user">用户</option><option value="system">系统</option>
            </select>
            <Input v-model="v.key" class="mono !w-40" placeholder="变量名" />
            <Input v-model="v.value" class="mono flex-1" placeholder="变量值" />
            <Input v-model="v.remark" class="!w-32" placeholder="备注" />
            <button class="text-red-500 hover:underline" @click="form.variables.splice(i, 1)">×</button>
          </div>
          <div v-if="!form.variables.length" class="py-4 text-center text-[11.5px] text-muted-foreground">还没有变量，新增或从模板导入</div>
        </div>
      </div>
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="outline" @click="editOpen = false">取消</Button>
        <Button @click="submitSet">保存</Button>
      </div>
    </Dialog>

    <!-- 互斥组 -->
    <Dialog v-model:open="mutexOpen" title="互斥组管理" width="820px">
      <div class="mb-2.5 flex items-center gap-2 text-[12px]">
        <Button size="sm" @click="createMutex"><Plus :size="13" /> 新建互斥组</Button>
        <span class="text-muted-foreground">同一互斥组内最多只能有 1 套配置集处于「已加载（草稿待提交）」状态</span>
      </div>
      <div v-for="g in setStore.mutex" :key="g.id" class="mb-2.5 rounded-xl border border-border bg-card p-3">
        <div class="mb-2.5 flex items-start justify-between">
          <div>
            <b class="text-[13px]">{{ g.name }}</b>
            <Badge v-if="g.autoClean" tone="success" class="ml-1.5">自动清理旧草稿</Badge>
            <Badge v-if="g.forceBlock" tone="destructive" class="ml-1">强制阻断</Badge>
            <Badge v-if="g.snapshotBefore" tone="info" class="ml-1">切换前置快照</Badge>
          </div>
          <Button size="sm" variant="destructive" @click="removeMutex(g)">删除互斥组</Button>
        </div>
        <div class="grid grid-cols-2 gap-2.5">
          <div class="max-h-40 overflow-auto rounded-lg border border-border p-2">
            <div class="mb-1.5 text-[11.5px] font-semibold text-muted-foreground">可选配置集</div>
            <div v-for="s in availableFor(g)" :key="s.id" class="cursor-pointer rounded-md px-2 py-1 text-[12px] hover:bg-primary/10" @click="addToMutex(g, s)">+ {{ s.name }}</div>
            <div v-if="!availableFor(g).length" class="py-3 text-center text-[11.5px] text-muted-foreground">全部已加入互斥组</div>
          </div>
          <div class="max-h-40 overflow-auto rounded-lg border border-border p-2">
            <div class="mb-1.5 text-[11.5px] font-semibold text-muted-foreground">组内成员（{{ membersOf(g).length }}）</div>
            <div v-for="s in membersOf(g)" :key="s.id" class="flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-[12px] hover:bg-primary/10" @click="removeFromMutex(g, s)">
              × {{ s.name }} <Badge v-if="isLoaded(s.id)" tone="success" class="ml-auto">已加载</Badge>
            </div>
            <div v-if="!membersOf(g).length" class="py-3 text-center text-[11.5px] text-muted-foreground">暂无成员</div>
          </div>
        </div>
      </div>
      <div v-if="!setStore.mutex.length" class="py-8 text-center text-[12px] text-muted-foreground">还没有互斥组</div>
    </Dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { Plus, Upload, RotateCw, Ban } from 'lucide-vue-next'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'
import Badge from '@/components/ui/Badge.vue'
import Input from '@/components/ui/Input.vue'
import Select from '@/components/ui/Select.vue'
import Checkbox from '@/components/ui/Checkbox.vue'
import Dialog from '@/components/ui/Dialog.vue'
import DataTable from '@/components/ui/DataTable.vue'
import { useSetStore } from '@/store/dev'
import { useEnvStore } from '@/store/env'
import api from '@/api'

const setStore = useSetStore()
const env = useEnvStore()

const editOpen = ref(false)
const mutexOpen = ref(false)
const tplPick = ref(undefined)
const form = reactive({ id: '', name: '', type: 'global', comment: '', group: '', mutexId: '', projectDir: '', folderWatch: false, variables: [] })

const setColumns = [
  { key: 'name', title: '配置集', width: 230 },
  { key: 'type', title: '类型', width: 110 },
  { key: 'mutex', title: '互斥组', width: 160 },
  { key: 'vars', title: '内容', ellipsis: true },
  { key: 'actions', title: '操作', width: 250 }
]

function mutexName(id) {
  return setStore.mutex.find((m) => m.id === id)?.name || id
}
function isLoaded(id) {
  return setStore.loadedSets.includes(id)
}

function openCreate() {
  Object.assign(form, { id: '', name: '新配置集', type: 'global', comment: '', group: '', mutexId: '', projectDir: '', folderWatch: false, variables: [] })
  editOpen.value = true
}
function editSet(row) {
  if (row.readOnly) return alert('该配置集已锁定为只读基线')
  Object.assign(form, JSON.parse(JSON.stringify(row)))
  editOpen.value = true
}
async function pickDir() {
  const res = await api.fs.selectFolder({ title: '选择项目根目录' })
  if (res.ok && !res.data.canceled) form.projectDir = res.data.path
}
async function importTemplate(id) {
  if (!id) return
  const res = await api.envset.getTemplate(id)
  if (res.ok && Array.isArray(res.data)) {
    for (const v of res.data) form.variables.push({ ...v, scope: v.scope || 'user' })
  }
  tplPick.value = undefined
}
async function submitSet() {
  if (!form.name.trim()) return alert('请输入配置集名称')
  const payload = { ...form, name: form.name.trim(), variables: form.variables.filter((v) => v.key.trim()) }
  try {
    if (form.id) {
      const res = await api.envset.update({ id: form.id, patch: payload })
      if (!res.ok) throw new Error(res.message)
      if (payload.type === 'project' && payload.folderWatch && payload.projectDir) await api.envset.startWatch({ setId: form.id, dir: payload.projectDir })
      alert('配置集已更新')
    } else {
      const res = await api.envset.create(payload)
      if (!res.ok) throw new Error(res.message)
      if (payload.type === 'project' && payload.folderWatch && payload.projectDir) await api.envset.startWatch({ setId: res.data.id, dir: payload.projectDir })
      alert('配置集已创建')
    }
    editOpen.value = false
    await setStore.load()
  } catch (err) {
    alert(err.message)
  }
}
function deleteSet(row) {
  if (!confirm(`删除配置集「${row.name}」？`)) return
  api.envset.remove(row.id).then(() => {
    setStore.unloadSet(row.id)
    setStore.load()
  })
}
function exportSet(row) {
  api.envset.exportToFile({ id: row.id, desensitize: false }).then((res) => {
    if (res.ok && !res.data.canceled) alert(`已导出：${res.data.file}`)
    else if (!res.ok) alert(res.message)
  })
}

async function loadOne(row) {
  try {
    const res = await setStore.loadSet(row.id)
    if (res.blocked) return alert(res.message)
    if (res.pendingMutex) {
      const info = res.pendingMutex
      if (!confirm(`⚠️ 互斥组「${info.group.name}」已有【${info.loadedNames.join('、')}】的草稿变更，加载【${info.setName}】将移除上述配置集的所有草稿变量。确认切换？`)) return
      const r = await setStore.confirmMutexSwitch(info)
      alert(`切换完成：清理 ${r.removed} 条旧草稿，新增 ${r.added.length} 条变量`)
      return
    }
    alert(`已加载「${row.name}」，${res.added.length} 条变量进入草稿区`)
  } catch (err) {
    alert(err.message)
  }
}
function unloadOne(row) {
  const n = setStore.unloadSet(row.id)
  alert(`已从草稿区移除「${row.name}」的 ${n} 条变更`)
}
function createMutex() {
  api.envset.createMutex({ name: '新互斥组' }).then(() => setStore.load())
}
function removeMutex(g) {
  if (!confirm(`删除互斥组「${g.name}」？仅解除绑定，不删除配置集。`)) return
  api.envset.deleteMutex(g.id).then(() => setStore.load())
}
function membersOf(g) {
  return setStore.sets.filter((s) => s.mutexId === g.id)
}
function availableFor(g) {
  return setStore.sets.filter((s) => !s.mutexId || s.mutexId === g.id)
}
function addToMutex(g, s) {
  api.envset.assignMutex({ setId: s.id, mutexId: g.id }).then((res) => {
    if (res.ok) setStore.load()
    else alert(res.message)
  })
}
function removeFromMutex(g, s) {
  api.envset.assignMutex({ setId: s.id, mutexId: '' }).then(() => setStore.load())
}
function openImport() {
  api.fs.selectFile({ title: '选择配置集文件', filters: [{ name: 'JSON', extensions: ['json'] }] }).then(async (picked) => {
    if (!picked.ok || picked.data.canceled) return
    const read = await api.fs.readTextFile(picked.data.path)
    if (!read.ok) return alert(read.message)
    const res = await api.envset.importSet(read.data)
    if (res.ok) {
      alert('配置集已导入')
      setStore.load()
    } else alert(res.message)
  })
}
function launchTerminal(row) {
  const vars = {}
  for (const v of row.variables || []) vars[v.key] = v.value
  api.envset.launchTerminal({ shell: 'cmd', cwd: row.projectDir || '', env: vars, injectDraft: true, draftChanges: env.changes, title: `WinEnv · ${row.name}` }).then((res) => {
    if (res.ok) alert(`终端已启动（PID ${res.data.pid}），注入 ${res.data.injected} 个变量，仅当前窗口生效`)
    else alert(res.message)
  })
}
onMounted(() => setStore.load())
</script>
