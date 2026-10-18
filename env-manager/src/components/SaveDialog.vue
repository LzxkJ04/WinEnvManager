<template>
  <a-modal
    :open="open"
    title="确认写入系统环境变量"
    :width="720"
    :footer="null"
    :mask-closable="false"
    @cancel="onCancel"
  >
    <!-- 顶部红色风险提示条 -->
    <div class="risk-banner">
      <WarningOutlined />
      <span>
        本次操作会修改 Windows 注册表内用户/系统环境变量；系统变量需要管理员权限；
        写入前已自动生成快照，出错可一键回滚。
      </span>
    </div>

    <!-- 区域1：变更来源分组 -->
    <div class="section">
      <div class="section-title">变更来源分组</div>
      <div class="section-desc">可单独取消某一类变更，只提交选中项，未勾选内容保留在草稿区不落地。</div>
      <div class="source-grid">
        <a-checkbox
          v-for="(list, src) in env.changeGroups"
          :key="src"
          :checked="selectedSources.includes(src)"
          @change="(e) => toggleSource(src, e.target.checked)"
        >
          <a-tag :color="sourceColor(src)">{{ sourceLabel(src) }}</a-tag>
          <span class="muted">{{ list.length }} 条</span>
        </a-checkbox>
        <a-empty v-if="!Object.keys(env.changeGroups).length" description="草稿区没有任何变更" :image-style="{ height: '40px' }" />
      </div>
    </div>

    <!-- 区域2：前置校验结果面板 -->
    <div class="section">
      <div class="section-title">前置校验结果</div>
      <div class="valid-block pass" v-if="validation.pass && !validation.warns.length">
        ✅ 校验通过：变量名合法、PATH 长度未超限、无无效 % 变量引用
      </div>
      <div class="valid-block pass" v-else-if="validation.pass">✅ 校验通过（含 {{ validation.warns.length }} 条警告）</div>
      <div class="valid-block fail" v-else>❌ 存在阻断项，必须先回到草稿修正问题后才能写入</div>
      <ul class="valid-list warn" v-if="validation.warns.length">
        <li v-for="(w, i) in dedupe(validation.warns).slice(0, 6)" :key="'w' + i">⚠️ {{ w }}</li>
        <li v-if="validation.warns.length > 6" class="muted">…等 {{ validation.warns.length }} 条警告</li>
      </ul>
      <ul class="valid-list fail" v-if="validation.errors.length">
        <li v-for="(er, i) in dedupe(validation.errors).slice(0, 6)" :key="'e' + i">❌ {{ er }}</li>
        <li v-if="validation.errors.length > 6" class="muted">…等 {{ validation.errors.length }} 条阻断项</li>
      </ul>
    </div>

    <!-- 区域3：变更明细列表 -->
    <div class="section">
      <div class="section-title">
        变更明细（{{ visibleChanges.length }} 条）
        <a-button size="small" type="link" :disabled="!selectedRowKeys.length" @click="cancelSelected">取消选中条目</a-button>
      </div>
      <a-table
        size="small"
        :data-source="visibleChanges"
        :columns="columns"
        :pagination="{ pageSize: 8, size: 'small' }"
        :row-selection="{ selectedRowKeys, onChange: (k) => (selectedRowKeys = k) }"
        :row-class-name="rowClass"
        row-key="key"
        :scroll="{ x: 520, y: 220 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'action'">
            <a-tag :color="{ create: 'green', update: 'orange', delete: 'red' }[record.action]">
              {{ { create: '新增', update: '修改', delete: '删除' }[record.action] }}
            </a-tag>
          </template>
          <template v-else-if="column.key === 'scope'">
            <a-tag :color="record.scope === 'machine' ? 'purple' : 'blue'">
              {{ record.scope === 'machine' ? '系统' : '用户' }}
            </a-tag>
          </template>
          <template v-else-if="column.key === 'source'">
            <a-tag :color="sourceColor(record.source)">{{ sourceLabel(record.source) }}</a-tag>
          </template>
          <template v-else-if="column.key === 'oldValue'">
            <span class="mono old">{{ clip(record.oldValue) }}</span>
          </template>
          <template v-else-if="column.key === 'value'">
            <span class="mono neo">{{ clip(record.value) }}</span>
          </template>
          <template v-else-if="column.key === 'name'">
            <span class="mono name">{{ record.name }}</span>
          </template>
          <template v-else-if="column.key === 'op'">
            <a @click="cancelOne(record)">取消本条</a>
          </template>
        </template>
      </a-table>
    </div>

    <!-- 区域4：附加选项 -->
    <div class="section options">
      <a-checkbox v-model:checked="optRestart">写入完成后自动重启资源管理器，立即刷新环境变量</a-checkbox>
      <a-checkbox :checked="true" disabled>自动生成本次变更快照（默认开启，保障可回滚）</a-checkbox>
      <a-checkbox v-model:checked="optMarkdown">将本次变更导出为 Markdown 变更文档</a-checkbox>
    </div>

    <!-- 区域5：底部操作按钮 -->
    <div class="footer">
      <a-button @click="previewSnapshot">预览快照</a-button>
      <a-button @click="onCancel">保留草稿，取消写入</a-button>
      <div class="spacer"></div>
      <a-button v-if="lastAutoSnapshot" danger @click="rollback">一键回滚至上一快照</a-button>
      <a-button
        type="primary"
        :disabled="!canSubmit"
        :loading="saving"
        @click="submit"
      >
        确认写入系统（{{ selectedChanges.length }}）
      </a-button>
    </div>

    <div class="tip">
      温馨提示：草稿未提交不会修改系统；若写入后程序异常，可在【变量快照】页面一键恢复到写入前状态。
    </div>

    <!-- 草稿快照预览 -->
    <a-modal v-model:open="previewOpen" title="草稿快照预览（提交后系统环境）" :footer="null" width="760px">
      <div class="pv-grid">
        <div>
          <div class="pv-title">用户变量（{{ previewKeys.user.length }}）</div>
          <div class="pv-list mono">
            <div v-for="k in previewKeys.user" :key="k" :class="{ changed: isChangedKey('user', k) }">{{ k }} = {{ clip(preview.user[k], 70) }}</div>
          </div>
        </div>
        <div>
          <div class="pv-title">系统变量（{{ previewKeys.machine.length }}）</div>
          <div class="pv-list mono">
            <div v-for="k in previewKeys.machine" :key="k" :class="{ changed: isChangedKey('machine', k) }">{{ k }} = {{ clip(preview.machine[k], 70) }}</div>
          </div>
        </div>
      </div>
    </a-modal>
  </a-modal>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { message, Modal } from 'ant-design-vue'
import { WarningOutlined } from '@ant-design/icons-vue'
import { useEnvStore } from '@/store/env'
import { useUiStore } from '@/store/ui'
import api from '@/api'
import { validateDraft, sourceLabel, sourceColor, clipText, buildMarkdownChangelog, maskSensitiveExport } from '@/lib/helpers'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['close', 'saved'])

const env = useEnvStore()
const ui = useUiStore()

const selectedSources = ref([])
const selectedRowKeys = ref([])
const optRestart = ref(false)
const optMarkdown = ref(false)
const saving = ref(false)
const previewOpen = ref(false)
const lastAutoSnapshot = ref(null)

const columns = [
  { title: '变更', key: 'action', width: 68 },
  { title: '归属', key: 'scope', width: 66 },
  { title: '变量名', key: 'name', width: 168, ellipsis: true },
  { title: '旧值', key: 'oldValue', ellipsis: true },
  { title: '新值', key: 'value', ellipsis: true },
  { title: '来源', key: 'source', width: 96 },
  { title: '操作', key: 'op', width: 82 }
]

const validation = computed(() =>
  validateDraft(env.changes, env.original, {
    validatePath: env.config.saveValidatePath !== false,
    detectSensitive: env.config.detectSensitive !== false
  })
)

const visibleChanges = computed(() => env.changes)
const selectedChanges = computed(() =>
  env.submittedChanges(selectedSources.value).filter((c) => !selectedRowKeys.value.includes(c.key))
)

const canSubmit = computed(
  () => validation.value.pass && selectedChanges.value.length > 0 && !saving.value
)

const preview = computed(() => env.draftPreview(selectedSources.value))
const previewKeys = computed(() => ({
  user: Object.keys(preview.value.user).sort((a, b) => a.localeCompare(b)),
  machine: Object.keys(preview.value.machine).sort((a, b) => a.localeCompare(b))
}))

function dedupe(list) {
  return [...new Set(list)]
}

function isChangedKey(scope, key) {
  const c = env.changes.find((x) => x.scope === scope && x.name.toUpperCase() === key.toUpperCase())
  return !!c
}

function toggleSource(src, checked) {
  selectedSources.value = checked
    ? [...selectedSources.value, src]
    : selectedSources.value.filter((s) => s !== src)
}

function rowClass(record) {
  return record.action === 'create' ? 'row-added' : record.action === 'delete' ? 'row-removed' : 'row-modified'
}

function cancelOne(record) {
  env.revertChange(record)
  selectedRowKeys.value = selectedRowKeys.value.filter((k) => k !== record.key)
  message.success(`已取消 ${record.name} 的变更`)
}

function cancelSelected() {
  const targets = env.changes.filter((c) => selectedRowKeys.value.includes(c.key))
  for (const t of targets) env.revertChange(t)
  selectedRowKeys.value = []
  message.success(`已取消 ${targets.length} 条变更`)
}

function clip(v) {
  return clipText(v, 90)
}

function previewSnapshot() {
  previewOpen.value = true
}

function onCancel() {
  emit('close')
}

async function loadLastAutoSnapshot() {
  const res = await api.snapshot.list()
  if (res.ok) {
    const auto = res.data.filter((s) => s.auto).sort((a, b) => b.createdAt - a.createdAt)[0]
    lastAutoSnapshot.value = auto || null
  }
}

watch(
  () => props.open,
  (v) => {
    if (v) {
      // 默认全部勾选
      selectedSources.value = Object.keys(env.changeGroups)
      selectedRowKeys.value = []
      optRestart.value = env.config.autoRestartExplorerAfterSave === true
      optMarkdown.value = false
      loadLastAutoSnapshot()
    }
  }
)

function previewSnapshotAfter() {
  /* 预留：跳转到快照对比页面 */
  previewOpen.value = false
}

async function submit() {
  if (!canSubmit.value) return
  saving.value = true
  try {
    // 写入前自动快照
    await api.snapshot.create({ name: `写入前快照 ${new Date().toLocaleString('zh-CN')}`, auto: true })

    const res = await env.save(selectedSources.value)
    if (res.empty) {
      message.info('没有需要写入的变更')
      emit('close')
      return
    }

    if (optMarkdown.value) {
      const rows = env.lastSaveResult?.results || []
      const changes = env.config.desensitizeExport === true
        ? rows.map((c) => ({ ...c, value: maskSensitiveExport(c.name, c.value) }))
        : rows
      const md = buildMarkdownChangelog(changes, { note: '保存写入系统' })
      const saved = await api.fs.saveFile({
        title: '保存变更说明文档',
        defaultPath: `环境变量变更说明-${Date.now()}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      })
      if (saved.ok && !saved.data.canceled) {
        await api.fs.writeTextFile({ file: saved.data.path, content: md })
        message.success('Markdown 变更文档已导出')
      }
    }

    emit('close')
    emit('saved', { count: res.count, needExplorerRestart: res.needExplorerRestart, restart: optRestart.value })
  } catch (err) {
    Modal.error({ title: '写入失败', content: err.message })
  } finally {
    saving.value = false
  }
}

async function rollback() {
  if (!lastAutoSnapshot.value) return
  Modal.confirm({
    title: '一键回滚至上一快照？',
    content: `将把系统环境恢复到「${lastAutoSnapshot.value.name}」的状态（${lastAutoSnapshot.value.createdAtText}）。`,
    okText: '确认回滚',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      const res = await api.snapshot.prepareRestore({ snapshotId: lastAutoSnapshot.value.id, items: [] })
      if (!res.ok) return message.error(res.message)
      // 全量回滚：以快照为准构建变更
      const snap = await api.snapshot.get(lastAutoSnapshot.value.id)
      if (!snap.ok) return message.error(snap.message)
      const plan = []
      for (const scope of ['user', 'machine']) {
        const cur = env.original[scope] || {}
        const target = snap.data[scope] || {}
        for (const k of Object.keys(target)) {
          if (cur[k] !== target[k]) plan.push({ action: cur[k] === undefined ? 'create' : 'update', scope, name: k, value: target[k] })
        }
        for (const k of Object.keys(cur)) {
          if (!(k in target)) plan.push({ action: 'delete', scope, name: k })
        }
      }
      const w = await api.env.applyChanges(plan)
      if (!w.ok) return message.error(w.message)
      message.success(`已回滚 ${plan.length} 项`)
      await env.load()
      emit('close')
    }
  })
}
</script>

<style scoped>
.risk-banner {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  background: rgba(245, 63, 63, 0.1);
  border: 1px solid rgba(245, 63, 63, 0.35);
  color: #cf1322;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 12.5px;
  line-height: 1.6;
  margin-bottom: 14px;
}

.section {
  margin-bottom: 14px;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.section-desc {
  font-size: 11.5px;
  color: var(--wem-text-3);
  margin-bottom: 8px;
}

.source-grid {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
  padding: 8px 10px;
  border: 1px solid var(--wem-border);
  border-radius: 8px;
  background: var(--wem-card-alt);
}

.valid-block {
  border-radius: 8px;
  padding: 9px 12px;
  font-size: 12.5px;
  margin-bottom: 6px;
}

.valid-block.pass {
  background: rgba(0, 180, 42, 0.1);
  color: #0f8a25;
  border: 1px solid rgba(0, 180, 42, 0.3);
}

.valid-block.fail {
  background: rgba(245, 63, 63, 0.1);
  color: #cf1322;
  border: 1px solid rgba(245, 63, 63, 0.3);
}

.valid-list {
  margin: 4px 0 0;
  padding-left: 20px;
  font-size: 12px;
  line-height: 1.8;
}

.valid-list.warn {
  color: #d46b08;
}

.valid-list.fail {
  color: #cf1322;
}

.options {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--wem-border);
  border-radius: 8px;
  background: var(--wem-card-alt);
  font-size: 12.5px;
}

.footer {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 14px;
}

.footer .spacer {
  flex: 1;
}

.tip {
  margin-top: 10px;
  font-size: 11.5px;
  color: var(--wem-text-3);
  text-align: center;
}

.mono {
  font-family: var(--wem-mono);
  font-size: 11.5px;
  word-break: break-all;
}

.mono.old {
  color: var(--wem-danger);
}

.mono.neo {
  color: var(--wem-success);
}

.mono.name {
  font-weight: 600;
}

.muted {
  color: var(--wem-text-3);
}

.pv-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

.pv-title {
  font-size: 12.5px;
  font-weight: 600;
  margin-bottom: 6px;
}

.pv-list {
  max-height: 320px;
  overflow: auto;
  font-size: 11.5px;
  line-height: 1.7;
  padding: 8px 10px;
  border: 1px solid var(--wem-border);
  border-radius: 8px;
  background: var(--wem-card-alt);
  word-break: break-all;
}

.pv-list .changed {
  background: var(--wem-mark-modified);
}
</style>
