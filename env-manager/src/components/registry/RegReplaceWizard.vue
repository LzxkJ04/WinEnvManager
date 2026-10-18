<template>
  <a-modal
    v-model:open="open"
    title="批量查找替换"
    width="960px"
    :mask-closable="false"
    :footer="null"
    @cancel="onCancel"
  >
    <a-steps :current="step" size="small" style="margin: 6px 0 14px">
      <a-step title="范围与过滤" />
      <a-step title="查找与替换" />
      <a-step title="扫描预览" />
      <a-step title="确认执行" />
    </a-steps>

    <!-- 1. 范围 -->
    <div v-show="step === 0">
      <a-form layout="vertical">
        <a-form-item label="扫描范围">
          <a-radio-group v-model:value="scopeMode" size="small">
            <a-radio value="current">当前选中分支</a-radio>
            <a-radio value="custom">自定义路径</a-radio>
          </a-radio-group>
          <div class="hint-box" style="margin-top: 8px">
            <InfoCircleOutlined />
            <div class="mono">{{ scopePath || '尚未选中注册表分支' }}</div>
          </div>
          <a-input
            v-if="scopeMode === 'custom'"
            v-model:value="customPath"
            class="mono"
            style="margin-top: 8px"
            placeholder="HKCU\Software"
          />
        </a-form-item>
        <a-form-item label="过滤范围">
          <a-radio-group v-model:value="filter" size="small" button-style="solid">
            <a-radio-button value="both">键名 + 键值</a-radio-button>
            <a-radio-button value="name">仅键名</a-radio-button>
            <a-radio-button value="value">仅键值</a-radio-button>
          </a-radio-group>
          <div class="field-hint">只处理 REG_SZ / REG_EXPAND_SZ 字符串类型，二进制与数值类型会被跳过。</div>
        </a-form-item>
      </a-form>
      <div class="hint-box warn">
        <WarningOutlined />
        <div>范围越大扫描越慢，建议先在小分支上验证规则，确认无误后再对整个分支执行。</div>
      </div>
    </div>

    <!-- 2. 查找替换 -->
    <div v-show="step === 1">
      <a-form layout="vertical">
        <a-form-item label="查找内容" required>
          <a-input v-model:value="find" class="mono" placeholder="例如：C:\old\path" />
        </a-form-item>
        <a-form-item label="替换为">
          <a-input v-model:value="replace" class="mono" placeholder="留空表示删除匹配内容" />
        </a-form-item>
        <a-form-item label="匹配选项">
          <a-space size="middle" wrap>
            <a-checkbox v-model:checked="caseSensitive">区分大小写</a-checkbox>
            <a-checkbox v-model:checked="wholeWord" :disabled="wildcard">整词匹配</a-checkbox>
            <a-checkbox v-model:checked="wildcard">通配符 *</a-checkbox>
          </a-space>
          <div class="field-hint">
            通配符模式下 <span class="mono">*</span> 匹配任意字符（例如 <span class="mono">C:\*\bin</span>）；
            整词匹配仅对非通配符模式生效，按字母数字下划线判定边界。
          </div>
        </a-form-item>
      </a-form>
      <div v-if="find" class="hint-box">
        <InfoCircleOutlined />
        <div>
          替换预览：<span class="mono">{{ find }}</span>
          <span class="text-muted"> → </span>
          <span class="mono">{{ replace || '（空）' }}</span>
        </div>
      </div>
    </div>

    <!-- 3. 扫描预览 -->
    <div v-show="step === 2">
      <div class="stat-grid" style="margin-bottom: 10px">
        <div class="stat-card">
          <div class="stat-label">扫描键值</div>
          <div class="stat-value">{{ scanned }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">匹配</div>
          <div class="stat-value" style="color: #ff7d00">{{ matched }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">勾选待改</div>
          <div class="stat-value" style="color: var(--wem-primary)">{{ selectedKeys.length }}</div>
        </div>
      </div>

      <div v-if="truncated" class="hint-box warn" style="margin-bottom: 10px">
        <WarningOutlined />
        <div>该分支键值过多，扫描结果已截断，建议缩小范围后再执行。</div>
      </div>

      <WemTable
        ref="scanTable"
        table-id="reg-replace-scan"
        row-key="__key"
        :rows="scanRows"
        :columns="scanColumns"
        :page-size="8"
        :capabilities="scanCaps"
        :row-class="scanRowClass"
        empty-text="没有匹配内容"
        @selection-change="(keys) => (selectedKeys = keys)"
      >
        <template #cell="{ row, column }">
          <template v-if="column.key === 'path'">
            <span class="mono cell-path" :title="row.path">{{ row.path }}</span>
          </template>
          <template v-else-if="column.key === 'name'">
            <span class="mono">{{ row.name || '(默认)' }}</span>
            <a-tag v-if="row.nameChanged" color="orange" style="margin-left: 6px">改名</a-tag>
          </template>
          <template v-else-if="column.key === 'before'">
            <span class="mono cell-path" :title="row.before">{{ clip(row.before) }}</span>
          </template>
          <template v-else-if="column.key === 'after'">
            <span class="mono cell-path" :title="row.after" style="color: var(--wem-success)">{{ clip(row.after) }}</span>
          </template>
          <template v-else-if="column.key === 'willChange'">
            <a-tag :color="row.willChange ? 'orange' : 'default'">{{ row.willChange ? '待改' : '无变化' }}</a-tag>
          </template>
        </template>
      </WemTable>
    </div>

    <!-- 4. 确认 -->
    <div v-show="step === 3">
      <div class="hint-box danger" style="margin-bottom: 12px">
        <WarningOutlined />
        <div>
          即将在 <b>{{ uniquePathCount }}</b> 个注册表项中修改 <b>{{ pickedRows.length }}</b> 条键值。
          执行前会自动备份这些路径的当前值，但注册表修改仍不可忽视，建议额外创建分支备份。
        </div>
      </div>
      <div class="kv-list">
        <span class="kv-key">扫描范围</span><span class="kv-val mono">{{ effectivePath }}</span>
        <span class="kv-key">查找内容</span><span class="kv-val mono">{{ find }}</span>
        <span class="kv-key">替换为</span><span class="kv-val mono">{{ replace || '（空）' }}</span>
        <span class="kv-key">待修改条数</span><span class="kv-val">{{ pickedRows.length }}</span>
      </div>
      <a-collapse ghost style="margin-top: 8px">
        <a-collapse-panel key="paths" :header="`查看受影响路径（${uniquePathCount}）`">
          <div class="path-list mono">
            <div v-for="p in uniquePaths" :key="p">{{ p }}</div>
          </div>
        </a-collapse-panel>
      </a-collapse>
    </div>

    <div class="wiz-foot">
      <a-button :disabled="step === 0 || scanning || applying" @click="step -= 1">上一步</a-button>
      <a-button v-if="step === 0" type="primary" :disabled="!effectivePath" @click="step = 1">下一步</a-button>
      <a-button v-else-if="step === 1" type="primary" :loading="scanning" @click="runScan">下一步：扫描</a-button>
      <a-button v-else-if="step === 2" type="primary" :disabled="!pickedRows.length" @click="step = 3">
        下一步：确认
      </a-button>
      <a-button v-else type="primary" danger :loading="applying" :disabled="!pickedRows.length" @click="doApply">
        确认替换 {{ pickedRows.length }} 条
      </a-button>
      <a-button v-if="step < 3" @click="onCancel">取消</a-button>
    </div>
  </a-modal>
</template>

<script setup>
import { computed, nextTick, ref } from 'vue'
import { message } from 'ant-design-vue'
import { InfoCircleOutlined, WarningOutlined } from '@ant-design/icons-vue'
import api from '@/api'
import WemTable from '@/components/wem-table/WemTable.vue'
import { confirmDanger } from '@/components/registry/confirmDanger'
import { useUiStore } from '@/store/ui'

const props = defineProps({
  scopePath: { type: String, default: '' }
})

const emit = defineEmits(['done'])
const ui = useUiStore()

const open = ref(false)
const step = ref(0)
const scopeMode = ref('current')
const customPath = ref('')
const filter = ref('both')
const find = ref('')
const replace = ref('')
const caseSensitive = ref(false)
const wholeWord = ref(false)
const wildcard = ref(false)

const scanning = ref(false)
const applying = ref(false)
const scanTable = ref(null)
const scanned = ref(0)
const matched = ref(0)
const truncated = ref(false)
const rows = ref([])
const selectedKeys = ref([])

const scanCaps = {
  inline: false,
  drag: false,
  sort: false,
  summary: false,
  batchDelete: false,
  batchTag: false,
  batchEnable: false,
  contextMenu: false,
  export: false
}

const scanColumns = [
  { title: '注册表路径', key: 'path', dataIndex: 'path', ellipsis: true },
  { title: '键名', key: 'name', dataIndex: 'name', width: 170, ellipsis: true },
  { title: '原值', key: 'before', dataIndex: 'before', ellipsis: true },
  { title: '替换后值', key: 'after', dataIndex: 'after', ellipsis: true },
  { title: '类型', key: 'type', dataIndex: 'type', width: 130 },
  { title: '状态', key: 'willChange', dataIndex: 'willChange', width: 90 }
]

const effectivePath = computed(() => (scopeMode.value === 'custom' ? customPath.value.trim() : props.scopePath))

const scanRows = computed(() => rows.value.map((row, i) => ({ ...row, __key: `rp-${i}` })))
const pickedRows = computed(() => rows.value.filter((row, i) => selectedKeys.value.includes(`rp-${i}`)))
const uniquePaths = computed(() => [...new Set(pickedRows.value.map((r) => r.path))])
const uniquePathCount = computed(() => uniquePaths.value.length)

function clip(text) {
  const s = String(text == null ? '' : text)
  return s.length > 80 ? `${s.slice(0, 80)}…` : (s || '—')
}

function scanRowClass(row) {
  return row.willChange ? 'row-modified' : ''
}

function reset() {
  step.value = 0
  scopeMode.value = 'current'
  customPath.value = ''
  filter.value = 'both'
  find.value = ''
  replace.value = ''
  caseSensitive.value = false
  wholeWord.value = false
  wildcard.value = false
  scanned.value = 0
  matched.value = 0
  truncated.value = false
  rows.value = []
  selectedKeys.value = []
}

function openWizard() {
  reset()
  open.value = true
}

async function runScan() {
  const path = effectivePath.value
  if (!path) {
    message.warning('请先选择或填写注册表路径')
    return
  }
  if (!find.value) {
    message.warning('请输入查找内容')
    return
  }
  scanning.value = true
  try {
    const res = await api.regReplace.scan({
      path,
      find: find.value,
      replace: replace.value,
      scope: filter.value,
      caseSensitive: caseSensitive.value,
      wholeWord: wholeWord.value,
      wildcard: wildcard.value
    })
    if (!res.ok) {
      message.error(res.message)
      return
    }
    const data = res.data || {}
    rows.value = (data.rows || []).map((row) => ({
      path: row.path,
      name: row.name,
      oldName: row.oldName,
      type: row.type,
      before: row.before,
      after: row.after,
      renamed: row.renamed,
      nameChanged: row.nameChanged,
      valueChanged: row.valueChanged,
      willChange: row.willChange !== false
    }))
    scanned.value = Number(data.scanned) || 0
    matched.value = Number(data.matched) || rows.value.length
    truncated.value = !!data.truncated
    step.value = 2
    // 先带原始下标映射再过滤，否则勾选键会和行错位
    const keys = rows.value.map((r, i) => (r.willChange ? `rp-${i}` : '')).filter(Boolean)
    selectedKeys.value = keys
    await nextTick()
    scanTable.value?.setSelection(keys)
    if (!rows.value.length) message.info('没有匹配内容')
  } finally {
    scanning.value = false
  }
}

async function doApply() {
  const list = pickedRows.value
  if (!list.length) {
    message.warning('请勾选要替换的条目')
    return
  }
  const ok = await confirmDanger({
    title: '⚠️ 注册表修改高危警告',
    warning:
      '修改 Windows 注册表可能造成程序异常、系统无法启动等严重问题，' +
      '强烈建议在修改前先对该注册表分支创建注册表备份。',
    content: `即将把 ${list.length} 条键值中的「${find.value}」替换为「${replace.value || '（空）'}」，` +
      `涉及 ${uniquePathCount.value} 个注册表项。执行前会自动备份这些路径的当前值。`,
    hint: '批量替换不可撤销，仅能依靠执行前自动备份与手动创建的注册表备份回滚。',
    rows: list.slice(0, 200).map((row) => ({
      路径: row.path,
      键名: row.name || '(默认)',
      原值: row.before,
      替换后: row.after
    })),
    columns: [
      { title: '路径', dataIndex: '路径', key: '路径', ellipsis: true },
      { title: '键名', dataIndex: '键名', key: '键名', width: 150, ellipsis: true },
      { title: '原值', dataIndex: '原值', key: '原值', ellipsis: true },
      { title: '替换后', dataIndex: '替换后', key: '替换后', ellipsis: true }
    ]
  })
  if (!ok) return

  applying.value = true
  try {
    const res = await api.regReplace.apply({
      rows: list,
      find: find.value,
      replace: replace.value
    })
    if (!res.ok) {
      message.error(res.message)
      return
    }
    const d = res.data || {}
    const skipped = (d.skipped || []).length
    message.success(`替换完成：已修改 ${d.applied || 0} 条${skipped ? `，跳过 ${skipped} 条` : ''}`)
    if (d.backupFile) ui.tip(`批量替换完成，修改前备份：${d.backupFile}`, 'success')
    open.value = false
    emit('done', d)
  } finally {
    applying.value = false
  }
}

function onCancel() {
  open.value = false
}

defineExpose({ openWizard })
</script>

<style scoped>
.field-hint {
  font-size: 11.5px;
  color: var(--wem-text-3);
  margin-top: 4px;
  line-height: 1.5;
}

.path-list {
  max-height: 220px;
  overflow: auto;
  font-size: 11.5px;
  line-height: 1.9;
  word-break: break-all;
}

.wiz-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
