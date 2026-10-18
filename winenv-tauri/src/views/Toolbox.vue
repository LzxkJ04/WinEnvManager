<template>
  <div class="flex flex-col gap-3.5">
    <Card>
      <div class="flex items-center gap-1.5 border-b border-border p-2.5 text-[13px] font-semibold"><Wrench :size="14" /> 常用工具</div>
      <div class="grid grid-cols-2 gap-3 p-3 md:grid-cols-3 xl:grid-cols-6">
        <div v-for="t in tools" :key="t.name" class="cursor-pointer rounded-lg border border-border bg-muted/40 p-3 transition-all hover:-translate-y-px hover:border-primary" @click="t.run()">
          <component :is="t.icon" :size="17" class="text-primary" />
          <div class="mt-1.5 text-[12.5px] font-semibold">{{ t.name }}</div>
          <div class="mt-0.5 text-[11px] leading-snug text-muted-foreground">{{ t.desc }}</div>
        </div>
      </div>
    </Card>

    <div class="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
      <Card>
        <div class="border-b border-border p-2.5 text-[13px] font-semibold"><ShieldCheck :size="14" class="inline text-primary" /> 权限检测</div>
        <div class="space-y-2 p-3">
          <div class="flex items-start gap-3 rounded-lg p-3" :class="env.admin ? 'border border-emerald-500/30 bg-emerald-500/10' : 'border border-amber-500/30 bg-amber-500/10'">
            <ShieldCheck :size="18" :class="env.admin ? 'text-emerald-500' : 'text-amber-500'" />
            <div>
              <div class="text-[13px] font-semibold">{{ env.admin ? '当前为管理员权限' : '当前为普通用户权限' }}</div>
              <div class="mt-0.5 text-[11.5px] text-muted-foreground">{{ env.admin ? '用户变量与系统变量均可读写' : '可读取全部变量，但无法写入或删除系统变量' }}</div>
            </div>
          </div>
          <div class="mono space-y-1 text-[11.5px]">
            <div>用户变量：{{ env.counts.user }} 个 · HKCU\Environment</div>
            <div>系统变量：{{ env.counts.machine }} 个 · HKLM\...\Environment</div>
            <div>程序版本：{{ info.version }}（{{ info.platform }}）</div>
          </div>
          <div class="flex gap-2">
            <Button size="sm" :disabled="env.admin" @click="api.tool.elevate().then((r) => !r.ok && alert(r.message))"><Rocket :size="13" /> 提权重启</Button>
            <Button size="sm" variant="outline" @click="env.load()"><RotateCw :size="13" /> 重新检测</Button>
          </div>
        </div>
      </Card>

      <Card>
        <div class="border-b border-border p-2.5 text-[13px] font-semibold"><Code :size="14" class="inline text-primary" /> 变量解析预览</div>
        <div class="space-y-2 p-3">
          <Textarea v-model="expandInput" :rows="3" class="mono" placeholder="%LOCALAPPDATA%\Programs;%USERPROFILE%\go\bin" />
          <div class="flex gap-2">
            <Button size="sm" @click="doExpand">解析</Button>
            <Button size="sm" variant="outline" @click="expandInput = '%SystemRoot%\\system32;%USERPROFILE%'">示例</Button>
          </div>
          <div class="mono min-h-16 rounded-lg border border-border bg-muted/40 p-2.5 leading-relaxed">{{ expandResult || '解析结果会显示在这里' }}</div>
        </div>
      </Card>
    </div>

    <!-- 命令查找模拟 -->
    <Card>
      <div class="flex flex-wrap items-center gap-2 border-b border-border p-2.5">
        <span class="flex items-center gap-1.5 text-[13px] font-semibold"><Zap :size="14" /> CMD / PowerShell 命令查找模拟</span>
        <Input v-model="cmdName" class="mono !w-40" placeholder="命令名，如 node" />
        <Select v-model="simScope" :options="[{ label: '用户 + 系统合并', value: 'merged' }, { label: '使用用户 PATH', value: 'user' }, { label: '使用系统 PATH', value: 'machine' }]" class="!w-44" />
        <Button size="sm" @click="runWhich"><Search :size="13" /> 模拟查找</Button>
      </div>
      <div class="p-3">
        <div v-if="!whichResult" class="py-6 text-center text-[12px] text-muted-foreground">输入命令名后点击「模拟查找」，查看会在哪个目录命中</div>
        <template v-else>
          <div v-if="whichResult.matches.length" class="mb-2 rounded-lg border border-primary/20 bg-primary/5 p-2.5 text-[12px]">
            找到 {{ whichResult.matches.length }} 处匹配，优先命中：<span class="mono">{{ whichResult.matches[0].file }}</span>
          </div>
          <div v-else class="rounded-lg border border-red-500/40 bg-red-500/10 p-2.5 text-[12px] text-red-600">
            在模拟的 PATH 中没有找到 {{ whichResult.name }}，该命令将无法直接执行。
          </div>
          <DataTable :columns="[{ key: 'order', title: '顺序', width: 60 }, { key: 'dir', title: 'PATH 中的目录', ellipsis: true }, { key: 'file', title: '命中文件', ellipsis: true }]" :rows="whichResult.matches" row-key="file">
            <template #dir="{ row }"><span class="mono">{{ row.dir }}</span></template>
            <template #file="{ row }"><span class="mono">{{ row.file }}</span></template>
          </DataTable>
        </template>
      </div>
    </Card>

    <div class="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-[12px] leading-relaxed text-red-600 dark:text-red-400">
      <b>风险提示：</b>注册表编辑器属于高风险工具，手动修改 HKLM 下的键值可能造成系统不稳定。建议优先使用本工具的界面操作，并确保已有可用备份。
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import {
  Wrench, ShieldCheck, Code, Zap, RefreshCcw, FolderOpen, HardDrive, Rocket,
  Search, KeyRound, Unplug, Download, FileText, ArrowLeftRight, TriangleAlert,
  Copy, Settings, Save
} from 'lucide-vue-next'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'
import Badge from '@/components/ui/Badge.vue'
import Input from '@/components/ui/Input.vue'
import Textarea from '@/components/ui/Textarea.vue'
import Select from '@/components/ui/Select.vue'
import DataTable from '@/components/ui/DataTable.vue'
import { useEnvStore } from '@/store/env'
import api from '@/api'
import { buildMarkdownChangelog } from '@/lib/utils'

const env = useEnvStore()
const info = ref({ version: '—', electron: '—', platform: '—' })
const expandInput = ref('%LOCALAPPDATA%\\Programs;%USERPROFILE%\\go\\bin')
const expandResult = ref('')
const cmdName = ref('node')
const simScope = ref('merged')
const whichResult = ref(null)

const tools = [
  { name: '重启资源管理器', desc: '让新环境变量立即生效', icon: RefreshCcw, run: () => confirm('确认重启资源管理器？') && api.tool.restartExplorer().then((r) => r.ok && alert('资源管理器已重启')) },
  { name: '原生环境变量面板', desc: '调用 Windows 环境变量对话框', icon: Settings, run: () => api.tool.openNativeEnvPanel('simple') },
  { name: '系统属性 · 高级', desc: '系统属性高级选项卡', icon: Settings, run: () => api.tool.openNativeEnvPanel('advanced') },
  { name: '注册表（系统变量）', desc: '跳转 HKLM 环境变量键', icon: Code, run: () => confirm('注册表编辑器允许直接修改系统配置，误操作可能导致系统异常。已备份？') && api.tool.openRegEnv('machine') },
  { name: '注册表（用户变量）', desc: '跳转 HKCU\\Environment', icon: Code, run: () => api.tool.openRegEnv('user') },
  { name: '广播环境变更', desc: '通知已运行程序重新读取', icon: Zap, run: () => api.tool.broadcastChange().then((r) => r.ok && alert('已广播环境变量变更消息')) },
  { name: '导出 .env 文件', desc: '从当前草稿变量生成', icon: Download, run: exportEnv },
  { name: 'Markdown 变更说明', desc: '导出草稿变更文档', icon: FileText, run: exportChangelog },
  { name: '断裂引用检测', desc: '扫描无效 %xxx% 引用', icon: Unplug, run: brokenRefs },
  { name: '敏感值检测', desc: '扫描密钥 / 口令类变量', icon: KeyRound, run: scanSensitive },
  { name: 'PATH 性能检测', desc: '分析 PATH 对终端速度影响', icon: Zap, run: pathPerf },
  { name: '注册表权限诊断', desc: '检测注册表项读写权限', icon: ShieldCheck, run: registryAcl },
  { name: '终端环境对比', desc: '对比进程环境与注册表', icon: Copy, run: () => alert('请通过「启动临时终端」注入草稿后，在新终端中执行 set 对比') },
  { name: '重置用户变量', desc: '恢复系统默认（高危）', icon: TriangleAlert, run: resetEnv, danger: true }
]

async function exportEnv() {
  const vars = env.working.user.filter((i) => !i._deleted)
  const saved = await api.fs.saveFile({ title: '导出 .env', defaultPath: '.env' })
  if (!saved.ok || saved.data.canceled) return
  await api.fs.writeTextFile({ file: saved.data.path, content: vars.map((v) => `${v.name.toUpperCase()}="${v.value}"`).join('\r\n') })
  alert(`已导出 ${vars.length} 个变量`)
}
async function exportChangelog() {
  if (!env.changes.length) return alert('草稿区没有变更')
  const saved = await api.fs.saveFile({ title: '保存变更说明', defaultPath: '环境变量变更说明.md' })
  if (!saved.ok || saved.data.canceled) return
  await api.fs.writeTextFile({ file: saved.data.path, content: buildMarkdownChangelog(env.changes) })
  alert('Markdown 变更说明已导出')
}
function brokenRefs() {
  api.analyze.brokenRefs().then((res) => {
    if (!res.ok) return
    alert(res.data.total ? `检测到 ${res.data.total} 处断裂引用：\n${res.data.items.map((i) => `${i.name} → %${i.ref}%`).join('\n')}` : '未发现断裂引用')
  })
}
function scanSensitive() {
  api.analyze.sensitiveScan().then((res) => {
    if (!res.ok) return
    alert(res.data.total ? `检测到 ${res.data.total} 条疑似敏感变量：\n${res.data.items.map((i) => `${i.name}（${i.labels.join('、')}）`).join('\n')}` : '未检测到疑似密钥/口令类变量')
  })
}
function pathPerf() {
  api.analyze.pathPerf().then((res) => {
    if (!res.ok) return
    alert(`共 ${res.data.total} 条 / ${res.data.totalLen} 字符 / ${res.data.invalid} 条无效。\n\n${res.data.advice.join('\n')}`)
  })
}
function registryAcl() {
  api.analyze.registryAcl().then((res) => {
    if (!res.ok) return
    alert(res.data.results.map((r) => `${r.target}：${r.message}`).join('\n'))
  })
}
function resetEnv() {
  if (!confirm('⚠️ 系统环境重置（高危）：将删除当前作用域全部环境变量并恢复 Windows 默认值。执行前会自动生成快照与备份。确定继续？')) return
  if (!confirm('第二次确认：真的要重置吗？')) return
  api.tool.resetEnvDefaults({ scope: env.admin ? 'machine' : 'user' }).then(async (res) => {
    if (res.ok) {
      alert(`已重置（清理 ${res.data.removed} 条，恢复 ${res.data.restored} 条）`)
      await env.load()
    } else alert(res.message)
  })
}
async function doExpand() {
  const res = await api.env.expandString(expandInput.value)
  expandResult.value = res.ok ? res.data : `解析失败：${res.message}`
}
async function runWhich() {
  if (!cmdName.value.trim()) return alert('请输入命令名')
  const dirs = simScope.value === 'user'
    ? env.pathItems.user.filter((i) => !i.disabled).map((i) => i.path)
    : simScope.value === 'machine'
      ? env.pathItems.machine.filter((i) => !i.disabled).map((i) => i.path)
      : [...env.pathItems.user, ...env.pathItems.machine].filter((i) => !i.disabled).map((i) => i.path)
  const res = await api.tool.whichCommand({ name: cmdName.value.trim(), dirs })
  whichResult.value = res.ok ? res.data : { name: cmdName.value, matches: [] }
}
onMounted(async () => {
  const res = await api.app.getInfo()
  if (res.ok) info.value = res.data
})
</script>
