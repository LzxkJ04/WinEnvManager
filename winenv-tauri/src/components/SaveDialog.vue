<script setup>
/**
 * 保存写入系统确认弹窗（来源分组 / 前置校验 / 变更明细 / 附加选项）
 */
import { computed, ref, watch } from 'vue'
import { TriangleAlert, CheckCircle2, XCircle, TriangleAlertIcon } from 'lucide-vue-next'
import Dialog from '@/components/ui/Dialog.vue'
import Button from '@/components/ui/Button.vue'
import Checkbox from '@/components/ui/Checkbox.vue'
import Badge from '@/components/ui/Badge.vue'
import DataTable from '@/components/ui/DataTable.vue'
import { useEnvStore } from '@/store/env'
import api from '@/api'
import { validateDraft, sourceLabel, sourceClass, clip, buildMarkdownChangelog } from '@/lib/utils'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['update:open', 'saved'])
const env = useEnvStore()

const selectedSources = ref([])
const excludedKeys = ref([])
const optRestart = ref(false)
const optMarkdown = ref(false)
const saving = ref(false)
const previewOpen = ref(false)

const columns = [
  { key: 'action', title: '变更', width: 62 },
  { key: 'scope', title: '归属', width: 58 },
  { key: 'name', title: '变量名', width: 180, ellipsis: true },
  { key: 'oldValue', title: '旧值', ellipsis: true },
  { key: 'value', title: '新值', ellipsis: true },
  { key: 'source', title: '来源', width: 92 },
  { key: 'op', title: '', width: 74 }
]

const validation = computed(() => validateDraft(env.changes, env.original, { validatePath: env.config.saveValidatePath !== false }))
const selectedChanges = computed(() => env.submittedChanges(selectedSources.value).filter((c) => !excludedKeys.value.includes(c.key)))
const canSubmit = computed(() => validation.value.pass && selectedChanges.value.length > 0 && !saving.value)
const preview = computed(() => env.draftPreview(selectedSources.value))
const previewKeys = computed(() => ({
  user: Object.keys(preview.value.user).sort(),
  machine: Object.keys(preview.value.machine).sort()
}))
const changedKeys = computed(() => new Set(env.changes.map((c) => `${c.scope}::${c.name.toUpperCase()}`)))

function toggleSource(src, checked) {
  selectedSources.value = checked ? [...selectedSources.value, src] : selectedSources.value.filter((s) => s !== src)
}
function rowClass(row) {
  return row.action === 'create' ? 'bg-emerald-500/10' : row.action === 'delete' ? 'bg-red-500/10' : 'bg-amber-500/10'
}
function cancelOne(row) {
  env.revertChange(row)
  excludedKeys.value = excludedKeys.value.filter((k) => k !== row.key)
}
function dedupe(list) {
  return [...new Set(list)]
}

watch(
  () => props.open,
  (v) => {
    if (v) {
      selectedSources.value = Object.keys(env.changeGroups)
      excludedKeys.value = []
      optRestart.value = env.config.autoRestartExplorerAfterSave === true
      optMarkdown.value = false
    }
  }
)

async function submit() {
  if (!canSubmit.value) return
  saving.value = true
  try {
    await api.snapshot.create({ name: `写入前快照 ${new Date().toLocaleString('zh-CN')}`, auto: true })
    const res = await env.save(selectedSources.value)
    if (res.empty) return
    if (optMarkdown.value) {
      const md = buildMarkdownChangelog(env.changes)
      const saved = await api.fs.saveFile({ title: '保存变更说明文档', defaultPath: '环境变量变更说明.md', filters: [{ name: 'Markdown', extensions: ['md'] }] })
      if (saved.ok && !saved.data.canceled) await api.fs.writeTextFile({ file: saved.data.path, content: md })
    }
    emit('update:open', false)
    emit('saved', { count: res.count, needExplorerRestart: res.needExplorerRestart, restart: optRestart.value })
  } catch (err) {
    alert(`写入失败：${err.message}`)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Dialog :open="open" title="确认写入系统环境变量" width="720px" @update:open="emit('update:open', $event)">
    <div class="mb-3.5 flex gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-2.5 text-[12px] leading-relaxed text-red-600 dark:text-red-400">
      <TriangleAlert :size="15" class="mt-0.5 flex-none" />
      <span>本次操作会修改 Windows 注册表内用户/系统环境变量；系统变量需要管理员权限；写入前已自动生成快照，出错可一键回滚。</span>
    </div>

    <div class="mb-3">
      <div class="mb-1 text-[13px] font-semibold">变更来源分组</div>
      <div class="mb-2 text-[11.5px] text-muted-foreground">可单独取消某一类变更，只提交选中项，未勾选内容保留在草稿区不落地。</div>
      <div class="flex flex-wrap gap-4 rounded-lg border border-border bg-muted/40 p-2.5">
        <Checkbox
          v-for="(list, src) in env.changeGroups"
          :key="src"
          :model-value="selectedSources.includes(src)"
          @update:model-value="(v) => toggleSource(src, v)"
        >
          <span :class="['rounded px-1.5 py-0.5 text-[11px] font-medium', sourceClass(src)]">{{ sourceLabel(src) }}</span>
          <span class="muted ml-1 text-[11px]">{{ list.length }} 条</span>
        </Checkbox>
        <span v-if="!Object.keys(env.changeGroups).length" class="text-[12px] text-muted-foreground">草稿区没有任何变更</span>
      </div>
    </div>

    <div class="mb-3">
      <div class="mb-1 text-[13px] font-semibold">前置校验结果</div>
      <div
        v-if="validation.pass"
        class="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-[12px] text-emerald-600 dark:text-emerald-400"
      >
        ✅ 校验通过{{ validation.warns.length ? `（含 ${validation.warns.length} 条警告）` : '：变量名合法、PATH 长度未超限、无无效 % 变量引用' }}
      </div>
      <div v-else class="rounded-lg border border-red-500/40 bg-red-500/10 p-2.5 text-[12px] text-red-600 dark:text-red-400">
        ❌ 存在阻断项，必须先回到草稿修正问题后才能写入
      </div>
      <ul v-if="validation.warns.length" class="mt-1.5 list-inside list-disc text-[11.5px] text-amber-600 dark:text-amber-400">
        <li v-for="(w, i) in dedupe(validation.warns).slice(0, 5)" :key="'w' + i">{{ w }}</li>
      </ul>
      <ul v-if="validation.errors.length" class="mt-1 list-inside list-disc text-[11.5px] text-red-600 dark:text-red-400">
        <li v-for="(e, i) in dedupe(validation.errors).slice(0, 5)" :key="'e' + i">{{ e }}</li>
      </ul>
    </div>

    <div class="mb-3">
      <div class="mb-1 flex items-center justify-between text-[13px] font-semibold">
        <span>变更明细（{{ selectedChanges.length }} 条）</span>
      </div>
      <DataTable
        :columns="columns" :rows="env.changes" row-key="key" :height="210"
        :row-class="rowClass" empty="没有变更"
      >
        <template #action="{ row }">
          <Badge :tone="{ create: 'success', update: 'warning', delete: 'destructive' }[row.action]">
            {{ { create: '新增', update: '修改', delete: '删除' }[row.action] }}
          </Badge>
        </template>
        <template #scope="{ row }">
          <Badge :tone="row.scope === 'machine' ? 'purple' : 'info'">{{ row.scope === 'machine' ? '系统' : '用户' }}</Badge>
        </template>
        <template #name="{ row }"><span class="mono">{{ row.name }}</span></template>
        <template #oldValue="{ row }"><span class="mono text-red-500">{{ clip(row.oldValue) }}</span></template>
        <template #value="{ row }"><span class="mono text-emerald-600 dark:text-emerald-400">{{ clip(row.value) }}</span></template>
        <template #source="{ row }">
          <span :class="['rounded px-1.5 py-0.5 text-[11px]', sourceClass(row.source)]">{{ sourceLabel(row.source) }}</span>
        </template>
        <template #op="{ row }">
          <button class="text-[11.5px] text-primary hover:underline" @click="cancelOne(row)">取消本条</button>
        </template>
      </DataTable>
    </div>

    <div class="mb-3 flex flex-col gap-1.5 rounded-lg border border-border bg-muted/40 p-2.5 text-[12px]">
      <Checkbox v-model:checked="optRestart">写入完成后自动重启资源管理器，立即刷新环境变量</Checkbox>
      <Checkbox :model-value="true" :disabled="true">自动生成本次变更快照（默认开启，保障可回滚）</Checkbox>
      <Checkbox v-model:checked="optMarkdown">将本次变更导出为 Markdown 变更文档</Checkbox>
    </div>

    <div class="flex items-center gap-2">
      <Button variant="outline" @click="previewOpen = true">预览快照</Button>
      <Button variant="outline" @click="emit('update:open', false)">保留草稿，取消写入</Button>
      <div class="flex-1"></div>
      <Button :disabled="!canSubmit" @click="submit">确认写入系统（{{ selectedChanges.length }}）</Button>
    </div>
    <div class="mt-2.5 text-center text-[11px] text-muted-foreground">
      温馨提示：草稿未提交不会修改系统；若写入后程序异常，可在【变量快照】页面一键恢复到写入前状态。
    </div>

    <Dialog :open="previewOpen" title="草稿快照预览（提交后系统环境）" width="760px" @update:open="previewOpen = $event">
      <div class="grid grid-cols-2 gap-3.5">
        <div v-for="scope in ['user', 'machine']" :key="scope">
          <div class="mb-1.5 text-[12.5px] font-semibold">
            {{ scope === 'user' ? '用户' : '系统' }}变量（{{ previewKeys[scope].length }}）
          </div>
          <div class="mono max-h-80 overflow-auto rounded-lg border border-border bg-muted/40 p-2.5 text-[11px] leading-relaxed">
            <div
              v-for="k in previewKeys[scope]"
              :key="k"
              :class="changedKeys.has(`${scope}::${k.toUpperCase()}`) ? 'bg-amber-500/15' : ''"
            >{{ k }} = {{ clip(preview[scope][k], 70) }}</div>
          </div>
        </div>
      </div>
    </Dialog>
  </Dialog>
</template>
