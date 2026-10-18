<template>
  <div>
    <Tabs v-model="tab" :tabs="[{ key: 'market', label: '环境市场' }, { key: 'installed', label: '已安装管理' }, { key: 'tasks', label: '任务队列' }, { key: 'audit', label: '环境审计' }]">
      <!-- 环境市场 -->
      <template #market>
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <Input v-model="search" class="!w-52" placeholder="搜索软件名" />
          <Select v-model="category" :options="categoryOptions" class="!w-40" placeholder="全部分类" />
          <div class="flex overflow-hidden rounded-md border border-border text-[12px]">
            <button class="px-2.5 py-1" :class="dlSource === 'mirror' ? 'bg-primary text-white' : ''" @click="dlSource = 'mirror'">国内镜像</button>
            <button class="px-2.5 py-1" :class="dlSource === 'official' ? 'bg-primary text-white' : ''" @click="dlSource = 'official'">官方源</button>
          </div>
          <div class="ml-auto flex gap-1.5">
            <Button size="sm" variant="outline" @click="api.devenv.openDir('dev')"><FolderOpen :size="13" /> 安装根目录</Button>
            <Button size="sm" variant="outline" @click="api.devenv.openDir('cache')"><HardDrive :size="13" /> 安装包缓存</Button>
          </div>
        </div>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <div v-for="it in marketItems" :key="it.id" class="rounded-xl border border-border bg-card p-3.5 transition-all hover:border-primary">
            <div class="flex items-center justify-between">
              <span class="text-[13.5px] font-semibold">{{ it.name }}</span>
              <Badge :tone="installedTone(it)">{{ installedText(it) }}</Badge>
            </div>
            <div class="mt-1.5 min-h-8 text-[11.5px] leading-relaxed text-muted-foreground">{{ it.description }}</div>
            <div class="mt-1 text-[11px] text-muted-foreground">{{ it.category }} · {{ it.sizeHint }} · {{ it.installMode === 'portable' ? '绿色解压' : '静默安装' }}</div>
            <div class="mt-2.5 flex items-center gap-1.5">
              <Select v-model="versionPick[it.id]" :options="(it.versions || []).map((v) => ({ label: v, value: v }))" class="!w-40" placeholder="选择版本" />
              <Button size="sm" @click="openDeploy(it)"><Rocket :size="13" /> 一键部署</Button>
              <Button size="sm" variant="outline" @click="showTemplate(it)">变量模板</Button>
            </div>
          </div>
          <div v-if="!marketItems.length" class="col-span-full py-10 text-center text-[12px] text-muted-foreground">没有匹配的软件</div>
        </div>
      </template>

      <!-- 已安装管理 -->
      <template #installed>
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <Button size="sm" :disabled="scanning" @click="rescan"><Search :size="13" /> {{ scanning ? '扫描中…' : '重新扫描本机环境' }}</Button>
          <Button v-if="scanning" size="sm" variant="destructive" @click="api.devenv.cancelScan()">取消扫描</Button>
          <Button size="sm" variant="outline" :disabled="!selectedDiscovered.length" @click="batchAdopt"><Plus :size="13" /> 批量纳入管理（{{ selectedDiscovered.length }}）</Button>
          <Checkbox v-model:checked="deepScan">深度扫描</Checkbox>
          <span v-if="scanProgress" class="text-[11.5px] text-muted-foreground">{{ scanProgress.message }}</span>
        </div>
        <Progress v-if="scanning" :value="scanProgress?.percent || 0" class="mb-3" />

        <div class="mb-3 flex items-center gap-1.5 text-[13px] font-semibold">
          <CheckCircle2 :size="14" class="text-emerald-500" /> 已纳入管理（{{ managedItems.length }}）
        </div>
        <DataTable
          :columns="managedColumns" :rows="managedItems" row-key="id" :height="220"
          :empty="scanning ? '扫描中…' : '尚未发现已纳管环境'"
        >
          <template #name="{ row }"><span class="font-semibold">{{ row.name }}</span></template>
          <template #version="{ row }"><span class="mono">{{ row.version || '未知' }}</span></template>
          <template #installPath="{ row }"><span class="mono text-muted-foreground">{{ row.installPath }}</span></template>
          <template #sources="{ row }"><Badge v-for="s in row.sources" :key="s" variant="outline" class="mr-1">{{ sourceName(s) }}</Badge></template>
          <template #status="{ row }"><Badge tone="success">正常</Badge></template>
          <template #actions="{ row }">
            <div class="flex items-center gap-2 text-[11.5px]">
              <button class="text-primary hover:underline" @click="validateOne(row)">校验</button>
              <button class="text-primary hover:underline" @click="api.tool.openFolder(row.installPath)">打开目录</button>
              <button class="text-primary hover:underline" @click="adopt(row)">修复环境</button>
              <button class="text-red-500 hover:underline" @click="uninstallItem(row)">卸载</button>
            </div>
          </template>
        </DataTable>

        <div class="mb-3 mt-4 flex items-center gap-1.5 text-[13px] font-semibold">
          <Search :size="14" class="text-primary" /> 自动发现 · 未纳入管理（{{ discoveredItems.length }}）
        </div>
        <DataTable
          :columns="discoveredColumns" :rows="discoveredItems" row-key="id" selectable :height="240"
          :selected-keys="selectedDiscovered" @select="(k) => (selectedDiscovered = k)"
          empty="本机未发现待接管的开发软件"
        >
          <template #name="{ row }"><span class="font-semibold">{{ row.name }}</span></template>
          <template #version="{ row }"><span class="mono">{{ row.version || '未知' }}</span></template>
          <template #installPath="{ row }"><span class="mono text-muted-foreground">{{ row.installPath }}</span></template>
          <template #sources="{ row }"><Badge v-for="s in row.sources" :key="s" variant="outline" class="mr-1">{{ sourceName(s) }}</Badge></template>
          <template #actions="{ row }">
            <div class="flex items-center gap-2 text-[11.5px]">
              <button class="text-primary hover:underline" @click="adopt(row)">纳入管理</button>
              <button class="text-primary hover:underline" @click="validateOne(row)">校验</button>
              <button class="text-red-500 hover:underline" @click="ignoreItem(row)">忽略</button>
            </div>
          </template>
        </DataTable>
      </template>

      <!-- 任务队列 -->
      <template #tasks>
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" @click="dev.loadTasks()"><RotateCw :size="13" /> 刷新</Button>
          <Button size="sm" variant="outline" @click="api.task.pauseAll().then(dev.loadTasks)">全部暂停</Button>
          <Button size="sm" variant="outline" @click="api.task.resumeAll().then(dev.loadTasks)">全部继续</Button>
          <Button size="sm" variant="outline" @click="api.task.clearFinished().then(dev.loadTasks)">清空已完成</Button>
        </div>
        <DataTable :columns="taskColumns" :rows="dev.tasks" row-key="id" :height="420" :row-class="taskRowClass" empty="暂无任务">
          <template #status="{ row }"><Badge :tone="{ queued: 'default', running: 'info', paused: 'warning', success: 'success', failed: 'destructive', cancelled: 'default' }[row.status]">{{ statusText(row.status) }}</Badge></template>
          <template #progress="{ row }">
            <Progress v-if="['running', 'paused'].includes(row.status)" :value="Math.round(row.progress)" />
            <div v-if="row.total" class="mono mt-1 text-[10.5px] text-muted-foreground">
              {{ fmtBytes(row.received) }} / {{ fmtBytes(row.total) }} · {{ fmtSpeed(row.speed) }}
            </div>
          </template>
          <template #createdAt="{ row }"><span class="text-muted-foreground">{{ fmtTime(row.createdAt) }}</span></template>
          <template #actions="{ row }">
            <div class="flex items-center gap-2 text-[11.5px]">
              <button class="text-primary hover:underline" @click="showLogs(row)">日志</button>
              <button v-if="row.status === 'running'" class="text-primary hover:underline" @click="api.task.pause(row.id).then(dev.loadTasks)">暂停</button>
              <button v-if="row.status === 'paused'" class="text-primary hover:underline" @click="api.task.resume(row.id).then(dev.loadTasks)">继续</button>
              <button v-if="['failed', 'cancelled'].includes(row.status)" class="text-primary hover:underline" @click="api.task.retry(row.id).then(dev.loadTasks)">重试</button>
              <button v-if="['queued', 'running', 'paused'].includes(row.status)" class="text-red-500 hover:underline" @click="api.task.cancel(row.id).then(dev.loadTasks)">取消</button>
            </div>
          </template>
        </DataTable>
      </template>

      <!-- 环境审计 -->
      <template #audit>
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <Button size="sm" :disabled="auditing" @click="runAudit"><ShieldCheck :size="13" /> {{ auditing ? '审计中…' : '一键全盘审计' }}</Button>
          <Checkbox v-model:checked="auditDeep">深度扫描</Checkbox>
          <template v-if="audit">
            <Button size="sm" variant="outline" @click="exportReport('md')">导出 Markdown</Button>
            <Button size="sm" variant="outline" @click="exportReport('html')">导出 HTML</Button>
            <Button size="sm" variant="outline" @click="exportReport('csv')">导出 CSV</Button>
          </template>
        </div>
        <div v-if="!audit" class="py-10 text-center text-[12px] text-muted-foreground">一键全盘审计：先扫描识别本机软件，再比对系统真实状态与已纳管环境，输出问题清单与一键修复方案。</div>
        <template v-else>
          <div class="mb-3 grid grid-cols-2 gap-3 md:grid-cols-5">
            <div class="rounded-lg border border-border bg-card p-3"><div class="text-[11px] text-muted-foreground">扫描软件</div><div class="text-[18px] font-semibold">{{ audit.total }}</div></div>
            <div class="rounded-lg border border-border bg-card p-3"><div class="text-[11px] text-muted-foreground">已纳管</div><div class="text-[18px] font-semibold text-emerald-600">{{ audit.managed }}</div></div>
            <div class="rounded-lg border border-border bg-card p-3"><div class="text-[11px] text-muted-foreground">待接管</div><div class="text-[18px] font-semibold text-amber-500">{{ audit.discovered }}</div></div>
            <div class="rounded-lg border border-border bg-card p-3"><div class="text-[11px] text-muted-foreground">异常 ❌</div><div class="text-[18px] font-semibold text-red-500">{{ audit.summary.errors }}</div></div>
            <div class="rounded-lg border border-border bg-card p-3"><div class="text-[11px] text-muted-foreground">警告 ⚠️</div><div class="text-[18px] font-semibold text-amber-500">{{ audit.summary.warns }}</div></div>
          </div>
          <DataTable
            :columns="issueColumns" :rows="audit.issues" row-key="title" :height="300"
            :row-class="(r) => (r.level === 'error' ? 'bg-red-500/10' : 'bg-amber-500/10')" empty="未发现问题 ✅"
          >
            <template #risk="{ row }"><Badge :tone="{ high: 'destructive', medium: 'warning', low: 'info' }[row.risk] || 'default'">{{ { high: '高风险', medium: '中风险', low: '低风险' }[row.risk] || row.risk }}</Badge></template>
            <template #level="{ row }"><Badge :tone="row.level === 'error' ? 'destructive' : 'warning'">{{ row.level === 'error' ? '❌ 异常' : '⚠️ 警告' }}</Badge></template>
            <template #detail="{ row }"><span class="mono">{{ row.detail }}</span></template>
            <template #actions="{ row }">
              <Button size="sm" variant="outline" :disabled="!(row.fix || []).length" @click="fixIssue(row)">一键修复</Button>
            </template>
          </DataTable>
          <div class="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card><div class="border-b border-border p-2.5 text-[12.5px] font-semibold">PATH 无效 / 重复</div><div class="mono p-3 text-[11.5px] text-red-500"><div v-for="p in audit.invalidPaths" :key="p">{{ p }}</div><div v-if="!audit.invalidPaths.length" class="text-muted-foreground">无</div></div></Card>
            <Card><div class="border-b border-border p-2.5 text-[12.5px] font-semibold">多版本共存</div><div class="p-3 text-[11.5px]"><div v-for="c in audit.conflicts" :key="c.ruleId"><b>{{ c.name }}</b>：{{ c.items.map((i) => `${i.version} @ ${i.installPath}`).join('；') }}</div><div v-if="!audit.conflicts.length" class="text-muted-foreground">无</div></div></Card>
          </div>
        </template>
      </template>
    </Tabs>

    <!-- 部署向导 -->
    <Dialog v-model:open="deployOpen" title="一键部署向导" width="680px">
      <div class="space-y-2.5">
        <div class="grid grid-cols-2 gap-2.5">
          <div><div class="mb-1 text-[11.5px] text-muted-foreground">版本</div><Select v-model="deployForm.version" :options="(deployItem?.versions || []).map((v) => ({ label: v, value: v }))" class="!w-full" /></div>
          <div><div class="mb-1 text-[11.5px] text-muted-foreground">安装目录</div><Input v-model="deployForm.installDir" class="mono" /></div>
        </div>
        <div class="flex items-center gap-4 text-[12px]">
          <span>安装模式：</span>
          <label class="flex items-center gap-1"><input v-model="deployForm.mode" type="radio" value="portable" /> 绿色解压</label>
          <label class="flex items-center gap-1"><input v-model="deployForm.mode" type="radio" value="silent" /> 静默安装</label>
          <span class="ml-3">变量写入域：</span>
          <label class="flex items-center gap-1"><input v-model="deployForm.scope" type="radio" value="user" /> 用户变量</label>
          <label class="flex items-center gap-1"><input v-model="deployForm.scope" type="radio" value="system" /> 系统变量</label>
        </div>
        <div class="rounded-lg border border-primary/20 bg-primary/5 p-2.5 text-[12px]">
          所有新增/修改变量仅存入草稿内存区，不会直接写入注册表，等待全局【保存写入系统】。
        </div>
        <DataTable
          :columns="planColumns" :rows="deployPlan" row-key="name" selectable :height="200"
          :selected-keys="planKeys" @select="(k) => (planKeys = k)"
        >
          <template #op="{ row }"><Badge :tone="{ create: 'success', update: 'warning', same: 'default' }[row.op]">{{ { create: '新增', update: '修改', same: '已存在' }[row.op] }}</Badge></template>
          <template #scope="{ row }"><Badge :tone="row.scope === 'machine' ? 'purple' : 'info'">{{ row.scope === 'machine' ? '系统' : '用户' }}</Badge></template>
          <template #name="{ row }"><span class="mono">{{ row.name }}</span></template>
          <template #value="{ row }"><span class="mono">{{ row.value }}</span></template>
        </DataTable>
      </div>
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="outline" @click="deployOpen = false">取消</Button>
        <Button @click="submitDeploy">确认提交，进入任务队列</Button>
      </div>
    </Dialog>

    <!-- 任务日志 -->
    <Dialog v-model:open="logsOpen" :title="`任务日志 · ${logsTask?.name || ''}`" width="760px">
      <div class="mono max-h-80 overflow-auto rounded-lg border border-border bg-muted/40 p-2.5 text-[11px] leading-relaxed">
        <div v-for="(l, i) in logsTask?.logs || []" :key="i" :class="l.level === 'error' ? 'text-red-500' : l.level === 'warn' ? 'text-amber-500' : ''">
          [{{ fmtTime(l.at) }}] {{ l.text }}
        </div>
        <div v-if="!logsTask?.logs?.length" class="py-6 text-center text-muted-foreground">暂无日志</div>
      </div>
    </Dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import {
  FolderOpen, HardDrive, Rocket, Search, Plus, CheckCircle2, RotateCw, ShieldCheck
} from 'lucide-vue-next'
import Tabs from '@/components/ui/Tabs.vue'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'
import Badge from '@/components/ui/Badge.vue'
import Input from '@/components/ui/Input.vue'
import Select from '@/components/ui/Select.vue'
import Checkbox from '@/components/ui/Checkbox.vue'
import Progress from '@/components/ui/Progress.vue'
import Dialog from '@/components/ui/Dialog.vue'
import DataTable from '@/components/ui/DataTable.vue'
import { useDevStore } from '@/store/dev'
import { useEnvStore } from '@/store/env'
import api from '@/api'
import { fmtBytes, fmtSpeed, fmtTime } from '@/lib/utils'

const dev = useDevStore()
const env = useEnvStore()

const tab = ref('market')
const search = ref('')
const category = ref(undefined)
const dlSource = ref('mirror')
const versionPick = ref({})
const deepScan = ref(false)
const auditDeep = ref(false)
const scanning = computed(() => dev.scanning)
const scanProgress = computed(() => dev.scanProgress)
const auditing = computed(() => dev.auditing)
const audit = computed(() => dev.audit)

const selectedDiscovered = ref([])
const deployOpen = ref(false)
const deployItem = ref(null)
const deployForm = ref({ version: '', installDir: '', mode: 'portable', scope: 'user' })
const deployPlan = ref([])
const planKeys = ref([])
const logsOpen = ref(false)
const logsTask = ref(null)

const SOURCE_MAP = { registry: '注册表', 'path-scan': 'PATH 扫描', 'dir-scan': '目录扫描', 'home-var': 'HOME 变量' }
function sourceName(s) {
  return SOURCE_MAP[s] || s
}

const marketItems = computed(() => {
  let list = dev.catalog
  if (category.value) list = list.filter((i) => i.category === category.value)
  const kw = search.value.trim().toLowerCase()
  if (kw) list = list.filter((i) => i.name.toLowerCase().includes(kw) || i.id.toLowerCase().includes(kw))
  return list
})
const categoryOptions = computed(() => [...new Set(dev.catalog.map((i) => i.category))].map((c) => ({ label: c, value: c })))
const managedItems = computed(() => dev.scanResult?.items.filter((i) => i.managed && !i.ignored) || [])
const discoveredItems = computed(() => dev.scanResult?.items.filter((i) => !i.managed && !i.ignored) || [])
const selectedDiscoveredRows = computed(() => discoveredItems.value.filter((i) => selectedDiscovered.value.includes(i.id)))

function installedTone(item) {
  const hit = dev.scanResult?.items.find((x) => x.ruleId === item.ruleId)
  return hit ? (hit.managed ? 'success' : 'info') : 'default'
}
function installedText(item) {
  const hit = dev.scanResult?.items.find((x) => x.ruleId === item.ruleId)
  return hit ? (hit.managed ? '已安装' : '可安装') : '未扫描'
}

const managedColumns = [
  { key: 'name', title: '软件', width: 140 },
  { key: 'version', title: '版本', width: 110 },
  { key: 'installPath', title: '安装路径', ellipsis: true },
  { key: 'sources', title: '识别来源', width: 170 },
  { key: 'status', title: '状态', width: 70 },
  { key: 'actions', title: '操作', width: 230 }
]
const discoveredColumns = [
  { key: 'name', title: '软件', width: 140 },
  { key: 'version', title: '版本', width: 110 },
  { key: 'installPath', title: '安装路径', ellipsis: true },
  { key: 'sources', title: '识别来源', width: 160 },
  { key: 'actions', title: '操作', width: 170 }
]
const taskColumns = [
  { key: 'name', title: '任务名称', width: 220, ellipsis: true },
  { key: 'status', title: '状态', width: 84 },
  { key: 'progress', title: '进度', width: 240 },
  { key: 'createdAt', title: '创建时间', width: 150 },
  { key: 'actions', title: '操作', width: 170 }
]
const issueColumns = [
  { key: 'risk', title: '风险', width: 80 },
  { key: 'level', title: '级别', width: 86 },
  { key: 'title', title: '问题', width: 250 },
  { key: 'detail', title: '详情', ellipsis: true },
  { key: 'actions', title: '操作', width: 96 }
]
const planColumns = [
  { key: 'op', title: '状态', width: 74 },
  { key: 'scope', title: '归属', width: 66 },
  { key: 'name', title: '变量名', width: 170 },
  { key: 'value', title: '值', ellipsis: true }
]

function statusText(s) {
  return { queued: '排队', running: '执行中', paused: '已暂停', success: '成功', failed: '失败', cancelled: '已取消' }[s] || s
}
function taskRowClass(row) {
  return row.status === 'failed' ? 'bg-red-500/10' : ''
}
function showLogs(task) {
  logsTask.value = task
  logsOpen.value = true
}

async function rescan() {
  const res = await dev.scan({ deep: deepScan.value })
  if (res.ok) alert(res.data.cancelled ? '扫描已取消' : `扫描完成，发现 ${res.data.items.length} 项`)
  else alert(res.message)
}
async function validateOne(row) {
  const res = await api.devenv.validateItem(row)
  if (res.ok) alert(res.data.ok ? `校验通过：${row.name} ${res.data.version}` : `校验未通过：执行 ${res.data.cmd} 未取得版本输出`)
  else alert(res.message)
}
function adopt(row) {
  const plan = (row.variables || []).filter((v) => v.op !== 'same')
  const r = env.applyTemplateVars(plan, { source: 'env-market', originId: row.id, originName: `${row.name} 纳入管理` })
  alert(`已提交 ${r.added.length} 条变量到草稿区，等待【保存写入系统】`)
}
async function batchAdopt() {
  let total = 0
  for (const t of selectedDiscoveredRows.value) {
    const plan = (t.variables || []).filter((v) => v.op !== 'same')
    const r = env.applyTemplateVars(plan, { source: 'env-market', originId: t.id, originName: `${t.name} 纳入管理` })
    total += r.added.length
  }
  selectedDiscovered.value = []
  alert(`已批量提交 ${total} 条变量到草稿区`)
}
async function ignoreItem(row) {
  await api.devenv.addIgnore(`${row.ruleId}::${row.installPath}`)
  if (dev.scanResult) dev.scanResult.items = dev.scanResult.items.map((i) => (i.id === row.id ? { ...i, ignored: true } : i))
}
function uninstallItem(row) {
  if (!confirm(`确认卸载 ${row.name}？绿色版将删除目录，安装版调用自带卸载程序。`)) return
  api.devenv.uninstall({ name: row.name, installPath: row.installPath, uninstallCmd: row.uninstall, mode: row.uninstall ? 'installer' : 'portable' }).then((r) => {
    if (r.ok) {
      const vars = (row.variables || []).filter((v) => v.op === 'same').map((v) => ({ ...v, op: 'delete' }))
      env.applyTemplateVars(vars, { source: 'env-market', originId: `uninstall-${row.id}`, originName: `卸载 ${row.name}` })
      alert('卸载任务已创建，关联变量已标记待删除')
      dev.loadTasks()
    } else alert(r.message)
  })
}
function openDeploy(item) {
  deployItem.value = item
  deployForm.value = {
    version: versionPick.value[item.id] || item.versions[0],
    installDir: `${env.config.devRoot || 'C:\\dev\\soft'}\\${item.id}`,
    mode: item.installMode, scope: 'user'
  }
  deployOpen.value = true
  api.devenv.buildPlan({ ruleId: item.ruleId, installPath: deployForm.value.installDir }).then((res) => {
    if (res.ok) {
      deployPlan.value = res.data.plan
      planKeys.value = res.data.plan.filter((p) => p.op !== 'same').map((p) => p.name)
    }
  })
}
function showTemplate(item) {
  api.devenv.buildPlan({ ruleId: item.ruleId, installPath: `${env.config.devRoot || 'C:\\dev\\soft'}\\${item.id}` }).then((res) => {
    if (res.ok) {
      deployItem.value = item
      deployPlan.value = res.data.plan
      planKeys.value = []
      deployOpen.value = true
    }
  })
}
function submitDeploy() {
  api.devenv.deploy({
    itemId: deployItem.value.id,
    version: deployForm.value.version,
    installDir: deployForm.value.installDir,
    mode: deployForm.value.mode,
    source: dlSource.value,
    scope: deployForm.value.scope
  }).then((res) => {
    if (res.ok) {
      alert(`任务已加入队列：${res.data.name}`)
      deployOpen.value = false
      dev.loadTasks()
    } else alert(res.message)
  })
}
async function runAudit() {
  const res = await dev.runAudit({ deep: auditDeep.value })
  if (res.ok) alert(`审计完成：${res.data.summary.errors} 异常 / ${res.data.summary.warns} 警告`)
  else alert(res.message)
}
function fixIssue(issue) {
  const r = dev.applyFix(issue)
  alert(r.errors.length ? r.errors.join('；') : `已将 ${r.added.length} 条修复方案写入草稿区`)
}
async function exportReport(format) {
  const res = await api.devenv.exportReport({ format, report: audit.value })
  if (res.ok && !res.data.canceled) alert(`报告已导出：${res.data.file}`)
}

onMounted(() => {
  dev.loadCatalog()
  dev.loadTasks()
  dev.loadRules()
})
</script>
