<template>
  <div class="flex flex-col gap-3.5">
    <!-- 一键备份 -->
    <Card>
      <div class="flex items-center justify-between border-b border-border p-2.5">
        <span class="flex items-center gap-1.5 text-[13px] font-semibold"><CloudDownload :size="14" /> 一键完整备份</span>
        <span class="text-[11.5px] text-muted-foreground">备份内容包含全部用户变量与系统变量</span>
      </div>
      <div class="space-y-2.5 p-3">
        <div class="flex flex-wrap items-center gap-2">
          <div class="flex overflow-hidden rounded-md border border-border text-[12px]">
            <button v-for="f in ['reg', 'json', 'txt']" :key="f" class="px-2.5 py-1" :class="format === f ? 'bg-primary text-white' : ''" @click="format = f">
              .{{ f }}
            </button>
          </div>
          <template v-if="format === 'json'">
            <div class="flex overflow-hidden rounded-md border border-border text-[12px]">
              <button class="px-2.5 py-1" :class="backupType === 'full' ? 'bg-primary text-white' : ''" @click="backupType = 'full'">全量</button>
              <button class="px-2.5 py-1" :class="backupType === 'increment' ? 'bg-primary text-white' : ''" @click="backupType = 'increment'">增量</button>
            </div>
            <Input v-model="backupPassword" type="password" class="!w-44" placeholder="加密密码（留空不加密）" />
            <Input v-model="backupComment" class="!w-48" placeholder="备份备注" />
          </template>
        </div>
        <div class="rounded-lg border border-border bg-muted/40 p-2.5 text-[12px] text-muted-foreground">
          <template v-if="format === 'reg'">Windows 原生注册表格式，双击即可导入系统。</template>
          <template v-else-if="format === 'json'">本工具专用格式（v2），支持增量备份与 AES-256-GCM 密码加密，还原时支持逐项勾选。</template>
          <template v-else>纯文本格式，方便人工查看与跨机编辑后重新导入。</template>
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
          <Button size="sm" :loading="exporting" @click="doExport"><Save :size="13" /> 立即备份</Button>
          <Button size="sm" variant="outline" @click="openBackupDir"><FolderOpen :size="13" /> 打开备份文件夹</Button>
          <Button size="sm" variant="outline" :disabled="!files.length" @click="syncRemote"><CloudUpload :size="13" /> 同步到远端目录</Button>
          <span class="muted text-[11.5px]">目录：<span class="mono">{{ backupDir }}</span></span>
        </div>
      </div>
    </Card>

    <!-- 还原向导 -->
    <Card>
      <div class="flex items-center justify-between border-b border-border p-2.5">
        <span class="flex items-center gap-1.5 text-[13px] font-semibold"><CloudUpload :size="14" /> 还原向导</span>
        <div class="flex gap-1.5">
          <Button size="sm" variant="outline" @click="pickBackupFile"><FolderOpen :size="13" /> 选择备份文件</Button>
          <Button size="sm" :disabled="!preview" @click="doRestore">执行还原（{{ selectedKeys.length }} 项）</Button>
        </div>
      </div>
      <div class="p-3">
        <div v-if="!preview" class="py-8 text-center text-[12px] text-muted-foreground">
          支持 .reg / .json / .txt 三种备份文件，选择后自动解析并与当前环境对比，列出所有变更项供勾选。
        </div>
        <template v-else>
          <div class="mono mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-[12px]">{{ preview.file }}</div>
          <div class="mb-2 flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="outline" @click="selectAll(true)">全选可还原项</Button>
            <Button size="sm" variant="outline" @click="selectAll(false)">全不选</Button>
            <div class="flex overflow-hidden rounded-md border border-border text-[11.5px]">
              <button v-for="f in ['all', 'user', 'machine']" :key="f" class="px-2 py-0.5" :class="scopeFilter === f ? 'bg-primary text-white' : ''" @click="scopeFilter = f">
                {{ f === 'all' ? '全部' : f === 'user' ? '仅用户' : '仅系统' }}
              </button>
            </div>
            <Badge v-if="!preview.checksumOk" tone="destructive">⚠ 校验值不匹配，文件可能损坏</Badge>
          </div>
          <DataTable
            :columns="previewColumns" :rows="previewRows" row-key="__key" selectable :height="320"
            :selected-keys="selectedKeys" @select="(k) => (selectedKeys = k)" :row-class="rowClass"
          >
            <template #action="{ row }">
              <Badge :tone="{ create: 'success', update: 'warning', same: 'default' }[row.action]">
                {{ { create: '新增', update: '覆盖', same: '相同' }[row.action] }}
              </Badge>
            </template>
            <template #scope="{ row }"><Badge :tone="row.scope === 'machine' ? 'purple' : 'info'">{{ row.scope === 'machine' ? '系统' : '用户' }}</Badge></template>
            <template #name="{ row }"><span class="mono">{{ row.name }}</span></template>
            <template #current="{ row }"><span class="mono text-red-500">{{ row.currentValue === null ? '（不存在）' : clip(row.currentValue) }}</span></template>
            <template #backup="{ row }"><span class="mono text-emerald-600">{{ clip(row.value) }}</span></template>
          </DataTable>
        </template>
      </div>
    </Card>

    <!-- 备份文件管理 -->
    <Card>
      <div class="flex items-center justify-between border-b border-border p-2.5">
        <span class="flex items-center gap-1.5 text-[13px] font-semibold"><Database :size="14" /> 备份文件管理（{{ files.length }}）</span>
        <div class="flex gap-1.5">
          <Button size="sm" variant="outline" @click="refreshList"><RotateCw :size="13" /> 刷新</Button>
          <Button size="sm" variant="outline" @click="openBackupDir"><FolderOpen :size="13" /> 打开</Button>
        </div>
      </div>
      <div class="p-2">
        <DataTable :columns="fileColumns" :rows="files" row-key="file" :height="240" empty="暂无备份文件">
          <template #format="{ row }"><Badge :tone="{ reg: 'purple', json: 'info', txt: 'default' }[row.format]">{{ row.format }}</Badge></template>
          <template #name="{ row }"><span class="mono">{{ row.name }}</span></template>
          <template #size="{ row }"><span class="text-muted-foreground">{{ fmtBytes(row.size) }}</span></template>
          <template #time="{ row }"><span class="text-muted-foreground">{{ fmtTime(row.mtime) }}</span></template>
          <template #actions="{ row }">
            <div class="flex items-center gap-2 text-[11.5px]">
              <button class="text-primary hover:underline" @click="loadFromFile(row.file)">预览还原</button>
              <button class="text-muted-foreground hover:underline" @click="api.tool.showInFolder(row.file)">定位</button>
              <button class="text-red-500 hover:underline" @click="removeFile(row)">删除</button>
            </div>
          </template>
        </DataTable>
      </div>
    </Card>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import {
  CloudDownload, CloudUpload, Database, Save, FolderOpen, RotateCw
} from 'lucide-vue-next'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'
import Badge from '@/components/ui/Badge.vue'
import Input from '@/components/ui/Input.vue'
import DataTable from '@/components/ui/DataTable.vue'
import { useEnvStore } from '@/store/env'
import api from '@/api'
import { clip, fmtBytes, fmtTime } from '@/lib/utils'

const env = useEnvStore()
const format = ref('json')
const backupType = ref('full')
const backupPassword = ref('')
const backupComment = ref('')
const exporting = ref(false)
const preview = ref(null)
const selectedKeys = ref([])
const scopeFilter = ref('all')
const files = ref([])
const backupDir = ref('')

const previewColumns = [
  { key: 'action', title: '动作', width: 70 },
  { key: 'scope', title: '归属', width: 66 },
  { key: 'name', title: '变量名', width: 190, ellipsis: true },
  { key: 'current', title: '当前值', ellipsis: true },
  { key: 'backup', title: '备份值', ellipsis: true }
]
const fileColumns = [
  { key: 'name', title: '文件名', ellipsis: true },
  { key: 'format', title: '格式', width: 70 },
  { key: 'size', title: '大小', width: 90 },
  { key: 'time', title: '生成时间', width: 160 },
  { key: 'actions', title: '操作', width: 190 }
]

const previewRows = computed(() =>
  (preview.value?.entries || [])
    .filter((i) => scopeFilter.value === 'all' || i.scope === scopeFilter.value)
    .map((i, idx) => {
      const cur = env.original[i.scope]?.[i.name]
      const has = Object.prototype.hasOwnProperty.call(env.original[i.scope] || {}, i.name)
      return {
        __key: `${i.scope}::${i.name}::${idx}`,
        scope: i.scope, name: i.name, value: i.value,
        currentValue: has ? cur : null,
        action: !has ? 'create' : cur === i.value ? 'same' : 'update'
      }
    })
)
const selectedForRestore = computed(() => previewRows.value.filter((r) => selectedKeys.value.includes(r.__key)))

function rowClass(record) {
  return record.action === 'create' ? 'bg-emerald-500/10' : record.action === 'update' ? 'bg-amber-500/10' : ''
}
function selectAll(v) {
  selectedKeys.value = v ? previewRows.value.filter((r) => r.action !== 'same').map((r) => r.__key) : []
}

async function doExport() {
  exporting.value = true
  try {
    const res = await api.backup.exportV2({ format: format.value, backupType: format.value === 'json' ? backupType.value : 'full', password: backupPassword.value, comment: backupComment.value })
    if (!res.ok) throw new Error(res.message)
    if (res.data.canceled) return
    alert(res.data.empty ? '与上一份备份相比没有变更' : `备份已生成（${res.data.type === 'increment' ? '增量' : '全量'}）：${res.data.file}`)
    await refreshList()
  } catch (err) {
    alert(`备份失败：${err.message}`)
  } finally {
    exporting.value = false
  }
}
async function refreshList() {
  const res = await api.backup.list()
  if (res.ok) {
    files.value = res.data.files
    backupDir.value = res.data.dir
  }
  const keep = Number(env.config.backupKeep) || 20
  await api.backup.prune(keep)
}
function openBackupDir() {
  api.tool.openFolder(backupDir.value)
}
async function syncRemote() {
  const picked = await api.fs.selectFolder({ title: '选择远端备份目录（本地 / 网络共享路径）' })
  if (!picked.ok || picked.data.canceled) return
  let n = 0
  for (const f of files.value) {
    const r = await api.backup.copyToRemote({ file: f.file, remoteDir: picked.data.path })
    if (r.ok) n += 1
  }
  alert(`已同步 ${n} 份备份到 ${picked.data.path}`)
}
function removeFile(row) {
  if (!confirm(`删除备份文件 ${row.name}？`)) return
  api.backup.remove(row.file).then(refreshList)
}
async function pickBackupFile() {
  const picked = await api.fs.selectFile({ title: '选择备份文件', filters: [{ name: '备份', extensions: ['reg', 'json', 'txt'] }] })
  if (!picked.ok || picked.data.canceled) return
  loadFromFile(picked.data.path)
}
async function loadFromFile(file) {
  const read = await api.backup.readV2({ file, password: backupPassword.value })
  if (!read.ok) return alert(read.message)
  preview.value = { file, ...read.data }
  selectedKeys.value = read.data.entries
    .filter((i) => !(i.scope === 'machine' && !env.admin))
    .map((i, idx) => `${i.scope}::${i.name}::${idx}`)
  if (read.data.encrypted && !backupPassword.value) alert('该备份已加密，请在上方输入密码后重新选择文件')
}
async function doRestore() {
  const targets = selectedForRestore.value
  if (!targets.length) return alert('请先勾选要还原的变量')
  if (!confirm(`确认还原 ${targets.length} 项？执行前会自动生成当前状态备份。`)) return
  await api.backup.exportV2({ format: 'json', prefix: 'BeforeRestore', backupType: 'full' })
  const changes = targets.map((t) => ({ action: t.action === 'create' ? 'create' : 'update', scope: t.scope, name: t.name, value: t.value }))
  const res = await api.env.applyChanges(changes)
  if (res.ok) {
    alert(`已还原 ${changes.length} 项`)
    preview.value = null
    selectedKeys.value = []
    await env.load()
  } else alert(res.message)
}
onMounted(refreshList)
</script>
