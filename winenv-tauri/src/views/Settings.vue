<template>
  <div class="flex flex-col gap-3.5">
    <!-- 界面与主题 -->
    <Card>
      <div class="border-b border-border p-2.5 text-[13px] font-semibold"><Palette :size="14" class="inline text-primary" /> 界面与主题</div>
      <div class="space-y-2 p-3">
        <Row label="主题模式">
          <div class="flex overflow-hidden rounded-md border border-border text-[12px]">
            <button v-for="t in [['light', '浅色'], ['dark', '深色'], ['system', '跟随系统']]" :key="t[0]" class="px-2.5 py-1" :class="env.config.theme === t[0] ? 'bg-primary text-white' : ''" @click="save({ theme: t[0] })">{{ t[1] }}</button>
          </div>
          <span class="muted">当前实际生效：{{ isDark ? '深色' : '浅色' }}</span>
        </Row>
        <Row label="主色调">
          <div class="flex gap-1.5">
            <button
              v-for="c in ['#165DFF', '#722ED1', '#13C2C2', '#52C41A', '#FA8C16', '#F5222D']" :key="c"
              class="h-5 w-5 rounded-md border-2" :style="{ background: c, borderColor: env.config.primaryColor === c ? 'var(--color-foreground)' : 'transparent' }"
              @click="save({ primaryColor: c })"
            />
          </div>
        </Row>
        <Row label="表格分页大小 / 行高">
          <input type="number" :value="env.config.pageSize || 20" class="h-7 w-16 rounded-md border border-input bg-card px-2 text-[12px]" @change="save({ pageSize: Number($event.target.value) })" />
          <div class="flex overflow-hidden rounded-md border border-border text-[12px]">
            <button v-for="h in [['small', '紧凑'], ['middle', '标准'], ['large', '宽松']]" :key="h[0]" class="px-2 py-1" :class="env.config.rowHeight === h[0] ? 'bg-primary text-white' : ''" @click="save({ rowHeight: h[0] })">{{ h[1] }}</button>
          </div>
        </Row>
      </div>
    </Card>

    <!-- 启动 / 草稿 -->
    <Card>
      <div class="border-b border-border p-2.5 text-[13px] font-semibold"><Rocket :size="14" class="inline text-primary" /> 启动与草稿保存</div>
      <div class="p-3">
        <Row v-for="r in draftRows" :key="r.key" :label="r.label">
          <Switch :model-value="env.config[r.key] !== false && env.config[r.key] !== undefined ? env.config[r.key] !== false : false" @update:model-value="(v) => save({ [r.key]: v })" />
          <span v-if="r.tip" class="muted">{{ r.tip }}</span>
        </Row>
        <Row label="撤销重做栈最大步数">
          <input type="number" :value="env.config.undoMaxSteps || 50" class="h-7 w-16 rounded-md border border-input bg-card px-2 text-[12px]" @change="save({ undoMaxSteps: Number($event.target.value) })" />
        </Row>
      </div>
    </Card>

    <!-- 开发环境配置 -->
    <Card>
      <div class="flex items-center justify-between border-b border-border p-2.5">
        <span class="text-[13px] font-semibold"><CloudDownload :size="14" class="inline text-primary" /> 开发环境配置</span>
        <div class="flex gap-1.5">
          <Button size="sm" variant="outline" @click="api.devenv.cacheStats().then((r) => alert(`缓存目录：${r.data.dir}\n共 ${r.data.count} 个文件，占用 ${fmtBytes(r.data.size)}`))">查看缓存占用</Button>
          <Button size="sm" variant="outline" @click="confirm('清空安装包缓存？') && api.devenv.clearCache().then((n) => alert(`已删除 ${n} 项`))">清空缓存</Button>
        </div>
      </div>
      <div class="p-3">
        <Row label="默认安装根目录">
          <Input :model-value="env.config.devRoot" class="mono !w-72" @update:model-value="(v) => (env.config.devRoot = v)" @change="save({ devRoot: env.config.devRoot })" />
        </Row>
        <Row label="下载源">
          <div class="flex overflow-hidden rounded-md border border-border text-[12px]">
            <button class="px-2.5 py-1" :class="env.config.downloadSource === 'mirror' ? 'bg-primary text-white' : ''" @click="save({ downloadSource: 'mirror' })">国内镜像</button>
            <button class="px-2.5 py-1" :class="env.config.downloadSource === 'official' ? 'bg-primary text-white' : ''" @click="save({ downloadSource: 'official' })">官方源</button>
          </div>
          <span class="muted">最大并发下载：</span>
          <input type="number" :value="env.config.maxConcurrentDownloads || 2" min="1" max="5" class="h-7 w-14 rounded-md border border-input bg-card px-2 text-[12px]" @change="save({ maxConcurrentDownloads: Number($event.target.value) })" />
        </Row>
        <Row v-for="m in mirrorKeys" :key="m.key" :label="m.label">
          <Input :model-value="env.config[m.key]" class="mono !w-96" :placeholder="m.placeholder" @update:model-value="(v) => (env.config[m.key] = v)" @change="save({ [m.key]: v })" />
        </Row>
        <Row label="哈希校验"><Switch :model-value="env.config.verifyHash !== false" @update:model-value="(v) => save({ verifyHash: v })" /></Row>
        <Row label="任务依赖编排"><Switch :model-value="env.config.taskDepends !== false" @update:model-value="(v) => save({ taskDepends: v })" /></Row>
        <Row label="数据库默认注册服务"><Switch :model-value="!!env.config.dbRegisterService" @update:model-value="(v) => save({ dbRegisterService: v })" /></Row>
      </div>
    </Card>

    <!-- 扫描识别 -->
    <Card>
      <div class="flex items-center justify-between border-b border-border p-2.5">
        <span class="text-[13px] font-semibold"><Search :size="14" class="inline text-primary" /> 自动扫描识别</span>
        <div class="flex gap-1.5">
          <Button size="sm" variant="outline" @click="rulesOpen = true">识别规则管理（{{ dev.rules.length }}）</Button>
          <Button size="sm" variant="outline" @click="exportRules">导出规则</Button>
          <Button size="sm" variant="outline" @click="importRules">导入规则</Button>
        </div>
      </div>
      <div class="p-3">
        <Row label="启动时自动扫描"><Switch :model-value="env.config.scanOnStart !== false" @update:model-value="(v) => save({ scanOnStart: v })" /></Row>
        <Row label="进入开发环境页自动轻量扫描"><Switch :model-value="env.config.scanOnEnterPage !== false" @update:model-value="(v) => save({ scanOnEnterPage: v })" /></Row>
        <Row label="深度扫描"><Switch :model-value="!!env.config.deepScan" @update:model-value="(v) => save({ deepScan: v })" /><span class="muted">识别更全，扫描耗时更长</span></Row>
        <Row label="定时自动审计">
          <Select :model-value="String(env.config.auditIntervalHours || 0)" :options="[{ label: '关闭', value: '0' }, { label: '每天', value: '24' }, { label: '每周', value: '168' }]" class="!w-32" @update:model-value="(v) => save({ auditIntervalHours: Number(v) })" />
        </Row>
        <Row label="忽略软件清单">
          <div class="flex flex-wrap gap-1.5">
            <span v-for="(x, i) in env.config.scanIgnoreList || []" :key="i" class="mono inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px]">
              {{ x }}<button class="text-red-500" @click="removeIgnore(x)">×</button>
            </span>
            <span v-if="!(env.config.scanIgnoreList || []).length" class="text-[11.5px] text-muted-foreground">暂无被忽略的软件</span>
          </div>
        </Row>
      </div>
    </Card>

    <!-- 备份快照 -->
    <Card>
      <div class="border-b border-border p-2.5 text-[13px] font-semibold"><Database :size="14" class="inline text-primary" /> 备份与快照</div>
      <div class="p-3">
        <Row label="写入系统前自动快照"><Switch :model-value="env.config.autoSnapshot !== false" @update:model-value="(v) => save({ autoSnapshot: v })" /></Row>
        <Row label="写入系统前自动备份"><Switch :model-value="env.config.autoBackup !== false" @update:model-value="(v) => save({ autoBackup: v })" /></Row>
        <Row label="备份保留数量上限">
          <input type="number" :value="env.config.backupKeep || 20" class="h-7 w-16 rounded-md border border-input bg-card px-2 text-[12px]" @change="save({ backupKeep: Number($event.target.value) })" />
          <span class="muted">快照最大保存数量：</span>
          <input type="number" :value="env.config.snapshotMax || 50" class="h-7 w-16 rounded-md border border-input bg-card px-2 text-[12px]" @change="save({ snapshotMax: Number($event.target.value) })" />
        </Row>
        <Row label="备份存储目录">
          <Input :model-value="paths.backupDir" readonly class="mono !w-96" />
          <Button size="sm" variant="outline" @click="api.tool.openFolder(paths.backupDir)">打开</Button>
        </Row>
      </div>
    </Card>

    <!-- 安全 -->
    <Card>
      <div class="border-b border-border p-2.5 text-[13px] font-semibold"><Lock :size="14" class="inline text-primary" /> 安全设置</div>
      <div class="p-3">
        <Row label="高危操作二次确认"><Switch :model-value="env.config.confirmDanger !== false" @update:model-value="(v) => save({ confirmDanger: v })" /></Row>
        <Row label="变量编辑锁定保护"><Switch :model-value="env.config.lockProtect !== false" @update:model-value="(v) => save({ lockProtect: v })" /></Row>
        <Row label="敏感变量检测"><Switch :model-value="env.config.detectSensitive !== false" @update:model-value="(v) => save({ detectSensitive: v })" /></Row>
        <Row label="敏感变量脱敏导出"><Switch :model-value="!!env.config.desensitizeExport" @update:model-value="(v) => save({ desensitizeExport: v })" /></Row>
        <Row label="杀毒软件拦截提示"><Switch :model-value="env.config.avWarning !== false" @update:model-value="(v) => save({ avWarning: v })" /></Row>
        <Row label="检测外部注册表变更"><Switch :model-value="env.config.detectExternal !== false" @update:model-value="(v) => save({ detectExternal: v })" /></Row>
        <Row label="草稿自动保存"><Switch :model-value="env.config.draftAutoSave !== false" @update:model-value="(v) => save({ draftAutoSave: v })" /></Row>
      </div>
    </Card>

    <!-- 本地存储 -->
    <Card>
      <div class="border-b border-border p-2.5 text-[13px] font-semibold"><FolderOpen :size="14" class="inline text-primary" /> 本地存储位置</div>
      <div class="mono space-y-1 p-3 text-[11.5px]">
        <div>配置：{{ paths.config }}</div>
        <div>快照：{{ paths.snapshots }}</div>
        <div>日志：{{ paths.logs }}</div>
        <div>备份：{{ paths.backupDir }}</div>
        <div>缓存：{{ paths.cacheDir }}</div>
      </div>
    </Card>

    <!-- 规则管理 -->
    <Dialog v-model:open="rulesOpen" title="软件识别规则管理" width="860px">
      <div class="mb-2 flex items-center gap-2 text-[12px]">
        <Button size="sm" @click="addRule"><Plus :size="13" /> 新增规则</Button>
        <span class="muted">规则库版本 {{ dev.ruleVersion }}，共 {{ dev.rules.length }} 条</span>
      </div>
      <DataTable
        :columns="[{ key: 'name', title: '名称', width: 140 }, { key: 'executableName', title: '可执行文件', width: 150 }, { key: 'category', title: '分类', width: 130 }, { key: 'tpl', title: '变量模板', width: 80 }, { key: 'builtin', title: '来源', width: 76 }, { key: 'actions', title: '操作', width: 110 }]"
        :rows="dev.rules" row-key="id" :height="300"
      >
        <template #name="{ row }"><span class="font-semibold">{{ row.name }}</span></template>
        <template #executableName="{ row }"><span class="mono">{{ row.executableName }}</span></template>
        <template #tpl="{ row }">{{ (row.envTemplate || []).length }} 条</template>
        <template #builtin="{ row }"><Badge :tone="row.builtin ? 'default' : 'success'">{{ row.builtin ? '内置' : '自定义' }}</Badge></template>
        <template #actions="{ row }">
          <div class="flex items-center gap-2 text-[11.5px]">
            <button class="text-primary hover:underline" @click="editRule(row)">{{ row.builtin ? '查看' : '编辑' }}</button>
            <button v-if="!row.builtin" class="text-red-500 hover:underline" @click="delRule(row)">删除</button>
          </div>
        </template>
      </DataTable>
    </Dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import {
  Palette, Rocket, CloudDownload, Search, Database, Lock, FolderOpen, Plus
} from 'lucide-vue-next'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'
import Badge from '@/components/ui/Badge.vue'
import Input from '@/components/ui/Input.vue'
import Switch from '@/components/ui/Switch.vue'
import Select from '@/components/ui/Select.vue'
import Checkbox from '@/components/ui/Checkbox.vue'
import Dialog from '@/components/ui/Dialog.vue'
import DataTable from '@/components/ui/DataTable.vue'
import { useEnvStore } from '@/store/env'
import { useDevStore } from '@/store/dev'
import api from '@/api'
import { fmtBytes } from '@/lib/utils'

const env = useEnvStore()
const dev = useDevStore()
const paths = ref({})
const rulesOpen = ref(false)

const isDark = computed(() => (env.config.theme || 'light') === 'dark')
const mirrorKeys = [
  { key: 'mirrorNode', label: 'Node.js', placeholder: 'https://npmmirror.com/mirrors/node' },
  { key: 'mirrorPython', label: 'Python', placeholder: 'https://npmmirror.com/mirrors/python' },
  { key: 'mirrorGo', label: 'Go', placeholder: 'https://mirrors.aliyun.com/golang' },
  { key: 'mirrorJdk', label: 'JDK', placeholder: 'https://mirrors.tuna.tsinghua.edu.cn/Adoptium' },
  { key: 'mirrorMaven', label: 'Maven', placeholder: 'https://mirrors.tuna.tsinghua.edu.cn/apache/maven' },
  { key: 'mirrorGradle', label: 'Gradle', placeholder: 'https://mirrors.cloud.tencent.com/gradle' },
  { key: 'mirrorGithub', label: 'GitHub', placeholder: 'https://ghfast.top/https://github.com' }
]
const draftRows = [
  { key: 'loadOnStart', label: '启动时自动加载变量' },
  { key: 'startMinimized', label: '启动时最小化到托盘' },
  { key: 'autoSnapshot', label: '保存前自动创建快照', tip: '每次保存前抓取一份环境快照便于回滚' },
  { key: 'saveValidatePath', label: '保存前强制校验 PATH 长度' },
  { key: 'autoRestartExplorerAfterSave', label: '保存完成后自动重启资源管理器' },
  { key: 'confirmBeforeSave', label: '保存前二次确认弹窗' }
]

async function save(patch) {
  Object.assign(env.config, patch)
  const res = await api.config.set(patch)
  if (res.ok) {
    const cfg = await api.config.get()
    if (cfg.ok) {
      env.config = { ...env.config, ...cfg.data.config }
      paths.value = cfg.data.paths
    }
  } else alert(res.message)
}
async function removeIgnore(key) {
  await api.devenv.removeIgnore(key)
  await save({ scanIgnoreList: (env.config.scanIgnoreList || []).filter((x) => x !== key) })
}
async function exportRules() {
  const res = await api.rules.exportAll()
  if (!res.ok) return alert(res.message)
  const saved = await api.fs.saveFile({ title: '导出识别规则', defaultPath: 'wem-rules.json' })
  if (!saved.ok || saved.data.canceled) return
  await api.fs.writeTextFile({ file: saved.data.path, content: res.data })
  alert('规则已导出')
}
function importRules() {
  api.fs.selectFile({ title: '选择规则文件', filters: [{ name: 'JSON', extensions: ['json'] }] }).then(async (picked) => {
    if (!picked.ok || picked.data.canceled) return
    const read = await api.fs.readTextFile(picked.data.path)
    if (!read.ok) return alert(read.message)
    const res = await api.rules.importAll(read.data)
    if (res.ok) {
      alert(`导入 ${res.data.imported} 条，跳过 ${res.data.skipped.length} 条`)
      dev.loadRules()
    } else alert(res.message)
  })
}
function addRule() {
  const name = prompt('软件名称：')
  if (!name) return
  const exe = prompt('可执行文件名（如 mytool.exe）：')
  if (!exe) return
  api.rules.save({ id: '', name, category: '自定义工具', executableName: exe, versionCmd: '--version', versionRegex: '(\\d+\\.\\d+)', envTemplate: [], enable: true, scanSource: ['path-scan'], installPathExtract: { mode: 'self', level: 0 }, alias: [], dependRuleIds: [], ignoreIfExists: false, customCheckScript: '', tags: ['custom'] }).then((res) => {
    if (res.ok) dev.loadRules()
    else alert(res.message)
  })
}
function delRule(row) {
  if (!confirm(`删除规则「${row.name}」？`)) return
  api.rules.remove(row.id).then(() => dev.loadRules())
}
function editRule(row) {
  if (row.builtin) return alert('内置规则不可修改，可导出后修改 ID 再导入为自定义规则')
  const newExe = prompt('可执行文件名：', row.executableName)
  if (!newExe) return
  api.rules.save({ ...row, executableName: newExe }).then((res) => {
    if (res.ok) dev.loadRules()
    else alert(res.message)
  })
}
onMounted(async () => {
  const cfg = await api.config.get()
  if (cfg.ok) {
    env.config = { ...env.config, ...cfg.data.config }
    paths.value = cfg.data.paths
  }
  dev.loadRules()
})
</script>
