<template>
  <div class="flex flex-col gap-3.5">
    <Card>
      <div class="flex items-center gap-2 border-b border-border p-2.5">
        <img src="/icon.png" class="h-14 w-14 rounded-xl" alt="logo" />
        <div>
          <h2 class="text-[17px] font-semibold">WinEnv管家</h2>
          <p class="text-[12px] text-muted-foreground">v{{ info.version }} · Tauri 2 + Vue3 + shadcn-vue · 仅支持 Windows</p>
        </div>
      </div>
      <div class="flex flex-wrap gap-1.5 p-3">
        <Button size="sm" variant="outline" @click="openDataDir"><Database :size="13" /> 打开数据目录</Button>
        <Button size="sm" variant="outline" @click="openLogDir"><FileText :size="13" /> 查看日志目录</Button>
        <Button size="sm" variant="outline" @click="checkDeps"><ShieldCheck :size="13" /> 检查运行依赖</Button>
        <Button size="sm" variant="outline" @click="showStorage"><PieChart :size="13" /> 存储占用</Button>
        <Button size="sm" variant="outline" @click="showRules"><LayoutGrid :size="13" /> 识别规则（{{ rulesCount }}）</Button>
      </div>
    </Card>

    <div class="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
      <Card>
        <div class="border-b border-border p-2.5 text-[13px] font-semibold"><Info :size="14" class="inline text-primary" /> 版本信息</div>
        <div class="mono space-y-1 p-3 text-[11.5px]">
          <div>程序版本：{{ info.version }}</div>
          <div>框架：{{ info.electron }}（WebView2）</div>
          <div>运行平台：{{ info.platform }}</div>
          <div>程序路径：{{ info.exe }}</div>
        </div>
      </Card>
      <Card>
        <div class="border-b border-border p-2.5 text-[13px] font-semibold"><LayoutGrid :size="14" class="inline text-primary" /> 功能一览</div>
        <div class="grid grid-cols-2 gap-2 p-3 text-[12px]">
          <div v-for="f in features" :key="f.t"><b>{{ f.t }}</b> — {{ f.d }}</div>
        </div>
      </Card>
    </div>

    <Card>
      <div class="border-b border-border p-2.5 text-[13px] font-semibold"><FileBadge :size="14" class="inline text-primary" /> 开源声明与许可</div>
      <div class="p-3">
        <div class="mb-2.5 flex flex-wrap gap-1.5">
          <Badge v-for="l in licenses" :key="l.n" variant="outline">{{ l.n }}（{{ l.l }}）</Badge>
        </div>
        <div class="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-[12px] leading-relaxed">
          本程序通过系统 <span class="mono">reg.exe</span> 与 <span class="mono">PowerShell</span> 读写 Windows 注册表。
          修改环境变量会直接影响系统行为，请务必在操作前确认已有可用备份。程序作者不对因使用本工具造成的任何损失承担责任。
        </div>
      </div>
    </Card>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { Database, FileText, ShieldCheck, PieChart, LayoutGrid, Info, FileBadge } from 'lucide-vue-next'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'
import Badge from '@/components/ui/Badge.vue'
import { useEnvStore } from '@/store/env'
import { useDevStore } from '@/store/dev'
import api from '@/api'
import { fmtBytes } from '@/lib/utils'

const env = useEnvStore()
const dev = useDevStore()
const info = ref({ version: '—', electron: '—', platform: '—', exe: '—' })
const rulesCount = computed(() => dev.rules.length)

const features = [
  { t: '环境变量总览', d: '用户/系统变量统一视图' },
  { t: 'PATH 专项管理', d: '排序/去重/有效性校验' },
  { t: '快照与差异对比', d: '变更可视化，选择性还原' },
  { t: '备份与还原', d: 'reg/json/txt，支持增量加密' },
  { t: '开发环境管理', d: '环境市场/自动扫描/任务队列/审计' },
  { t: '环境配置集', d: '多套环境一键切换 + 互斥组' }
]
const licenses = [
  { n: 'Tauri 2', l: 'MIT/Apache-2.0' }, { n: 'Vue.js 3', l: 'MIT' },
  { n: 'shadcn-vue / reka-ui', l: 'MIT' }, { n: 'TailwindCSS 4', l: 'MIT' },
  { n: 'Pinia', l: 'MIT' }, { n: 'Vue Router', l: 'MIT' }, { n: 'lucide-vue-next', l: 'ISC' }
]

function openDataDir() {
  api.tool.openFolder('')
}
function openLogDir() {
  api.log.openDir()
}
function checkDeps() {
  alert([
    `✅ Tauri 运行时 — ${info.value.electron}`,
    '✅ WebView2 渲染内核（系统组件）',
    `✅ PowerShell 5.1+（注册表读写）`,
    '✅ reg.exe（注册表导出）',
    '⚠️ Rust 工具链（仅开发构建需要，运行不需要）'
  ].join('\n'))
}
function showStorage() {
  api.analyze.storage().then((res) => {
    if (!res.ok) return
    const d = res.data
    alert([
      `配置与元数据：${fmtBytes(d.config.size)}（${d.config.files} 个文件）`,
      `快照：${fmtBytes(d.snapshots.size)}`,
      `日志：${fmtBytes(d.logs.size)}`,
      `安装包缓存：${fmtBytes(d.cache.size)}`,
      `备份：${fmtBytes(d.backups.size)}`
    ].join('\n'))
  })
}
function showRules() {
  const list = dev.rules
  alert(`识别规则库 v${dev.ruleVersion}：共 ${list.length} 条（内置 ${list.filter((r) => r.builtin).length}，自定义 ${list.filter((r) => !r.builtin).length}）\n\n` + list.slice(0, 20).map((r) => `· ${r.name}（${r.executableName}）`).join('\n'))
}
onMounted(async () => {
  dev.loadRules()
  const res = await api.app.getInfo()
  if (res.ok) info.value = res.data
})
</script>
