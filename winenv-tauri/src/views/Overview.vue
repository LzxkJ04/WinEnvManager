<template>
  <div class="flex flex-col gap-3.5">
    <div class="grid grid-cols-2 gap-3 md:grid-cols-5">
      <div v-for="s in stats" :key="s.label" class="rounded-xl border border-border bg-card p-3.5 shadow-sm transition-all hover:-translate-y-px hover:border-primary">
        <div class="flex items-center gap-1.5 text-[12px] text-muted-foreground">{{ s.label }}</div>
        <div class="mt-1.5 text-[22px] font-semibold tabular-nums" :style="{ color: s.color }">{{ s.value }}</div>
        <div class="mt-0.5 text-[11px] text-muted-foreground">{{ s.extra }}</div>
      </div>
    </div>

    <Card>
      <div class="flex flex-wrap items-center gap-2 border-b border-border p-2.5">
        <span class="flex items-center gap-1.5 text-[13px] font-semibold"><Zap :size="14" /> 快捷操作</span>
        <div class="ml-auto flex flex-wrap gap-1.5">
          <Button size="sm" :loading="env.loading" @click="reload"><RotateCw :size="13" /> 重新读取</Button>
          <Button size="sm" variant="outline" @click="quickSnapshot"><Camera :size="13" /> 创建快照</Button>
          <Button size="sm" variant="outline" @click="quickBackup"><Save :size="13" /> 一键备份</Button>
          <Button size="sm" variant="outline" @click="restartExplorer"><RefreshCcw :size="13" /> 重启资源管理器</Button>
          <Button size="sm" variant="outline" @click="$router.push('/path')"><Route :size="13" /> PATH 管理</Button>
          <Button size="sm" variant="outline" @click="scanSensitive"><KeyRound :size="13" /> 敏感值检测</Button>
          <Button size="sm" variant="outline" @click="scanBroken"><Unplug :size="13" /> 断裂引用检测</Button>
          <Button v-if="!env.admin" size="sm" variant="secondary" @click="elevate"><Rocket :size="13" /> 提权重启</Button>
        </div>
      </div>
      <div class="p-3 text-[12px] leading-relaxed text-muted-foreground">
        <b class="text-foreground">使用须知：</b>修改系统变量后已运行程序不会自动感知，需重启程序或资源管理器；
        系统 PATH 注册表建议不超过 2047 字符；重命名变量等价于「删除 + 新建」；所有写入前都会自动生成快照与备份。
      </div>
    </Card>

    <div class="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
      <Card v-for="scope in ['user', 'machine']" :key="scope">
        <div class="flex items-center justify-between border-b border-border p-2.5">
          <span class="flex items-center gap-1.5 text-[13px] font-semibold">
            <component :is="scope === 'user' ? User : Network" :size="14" />
            {{ scope === 'user' ? '用户' : '系统' }}变量
            <span class="text-[11.5px] font-normal text-muted-foreground">共 {{ env.counts[scope] }} 个</span>
          </span>
          <div class="flex items-center gap-2">
            <div class="flex overflow-hidden rounded-md border border-border text-[11.5px]">
              <button class="px-2 py-0.5" :class="filter === 'all' ? 'bg-primary text-white' : ''" @click="filter = 'all'">全部</button>
              <button class="px-2 py-0.5" :class="filter === 'fav' ? 'bg-primary text-white' : ''" @click="filter = 'fav'">收藏</button>
              <button class="px-2 py-0.5" :class="filter === 'sensitive' ? 'bg-primary text-white' : ''" @click="filter = 'sensitive'">敏感</button>
            </div>
            <button class="text-[11.5px] text-primary hover:underline" @click="$router.push(scope === 'user' ? '/user' : '/system')">管理 →</button>
          </div>
        </div>
        <div class="max-h-64 overflow-auto">
          <table class="w-full text-[12px]">
            <tbody>
              <tr v-for="row in preview(scope)" :key="row.name" class="border-b border-border last:border-0 hover:bg-primary/5">
                <td class="w-40 truncate px-2.5 py-1.5 font-semibold">{{ row.name }}</td>
                <td class="mono truncate px-2.5 py-1.5 text-muted-foreground">{{ clip(row.value, 100) }}</td>
                <td class="w-20 px-2.5 py-1.5">
                  <Badge v-if="metaOf(row.name).favorite" tone="pink">收藏</Badge>
                  <Badge v-if="metaOf(row.name).sensitive" tone="volcano">敏感</Badge>
                </td>
              </tr>
              <tr v-if="!preview(scope).length"><td colspan="3" class="px-3 py-8 text-center text-muted-foreground">没有匹配的变量</td></tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { User, Network, Zap, RotateCw, Camera, Save, RefreshCcw, Route, KeyRound, Unplug, Rocket } from 'lucide-vue-next'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'
import Badge from '@/components/ui/Badge.vue'
import { useEnvStore } from '@/store/env'
import api from '@/api'
import { clip } from '@/lib/utils'

const env = useEnvStore()
const filter = ref('all')

function metaOf(name) {
  return env.meta.vars[`user::${String(name).toUpperCase()}`] || env.meta.vars[`machine::${String(name).toUpperCase()}`] || {}
}
function preview(scope) {
  let list = env.working[scope].filter((i) => !i._deleted)
  if (filter.value === 'fav') list = list.filter((i) => metaOf(i.name).favorite)
  if (filter.value === 'sensitive') list = list.filter((i) => metaOf(i.name).sensitive)
  return list.slice(0, 100)
}
const stats = computed(() => [
  { label: '用户变量', value: env.counts.user, color: 'var(--color-primary)', extra: 'HKCU\\Environment' },
  { label: '系统变量', value: env.counts.machine, color: '#a855f7', extra: 'HKLM Session Manager' },
  { label: '未保存修改', value: env.pendingCount, color: env.dirty ? 'var(--color-destructive)' : 'var(--color-success)', extra: env.dirty ? '点击「保存写入系统」提交' : '内存与系统一致' },
  { label: '收藏 / 敏感', value: `${favCount.value} / ${sensitiveCount.value}`, color: 'var(--color-foreground)', extra: '变量标记统计' },
  { label: '当前权限', value: env.admin ? '管理员' : '普通用户', color: env.admin ? 'var(--color-success)' : 'var(--color-warning)', extra: env.admin ? '可读写系统变量' : '系统变量只读' }
])
const favCount = computed(() => Object.values(env.meta.vars).filter((m) => m.favorite).length)
const sensitiveCount = computed(() => Object.values(env.meta.vars).filter((m) => m.sensitive).length)

async function reload() {
  await env.load()
}
function quickSnapshot() {
  api.snapshot.create({ name: `手动快照 ${new Date().toLocaleString('zh-CN')}` }).then((r) => r.ok && alert('快照已创建'))
}
function quickBackup() {
  api.backup.export({ format: 'json' }).then((r) => r.ok && alert(`备份已导出：${r.data.file}`))
}
function restartExplorer() {
  if (!confirm('确认重启资源管理器？任务栏会短暂消失约 1~2 秒。')) return
  api.tool.restartExplorer().then((r) => r.ok && alert('资源管理器已重启'))
}
function scanSensitive() {
  api.analyze.sensitiveScan().then((res) => {
    if (!res.ok) return
    alert(res.data.total ? `检测到 ${res.data.total} 条疑似敏感变量：\n${res.data.items.map((i) => `${i.name}（${i.labels.join('、')}）`).join('\n')}` : '未检测到疑似密钥/口令类变量')
  })
}
function scanBroken() {
  api.analyze.brokenRefs().then((res) => {
    if (!res.ok) return
    alert(res.data.total ? `检测到 ${res.data.total} 处断裂引用：\n${res.data.items.map((i) => `${i.name} 引用了未定义的 %${i.ref}%`).join('\n')}` : '未发现断裂引用')
  })
}
function elevate() {
  api.tool.elevate().then((r) => !r.ok && alert(r.message))
}
</script>
