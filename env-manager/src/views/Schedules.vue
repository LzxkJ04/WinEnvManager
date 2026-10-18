<template>
  <div>
    <!-- ==================== 任务列表 ==================== -->
    <div class="wem-card">
      <div class="wem-card-head">
        <div class="wem-card-title">
          <CalendarOutlined /> 定时任务
          <span class="text-muted" style="font-weight: 400">共 {{ rows.length }} 个，启用 {{ enabledCount }} 个</span>
        </div>
        <div class="toolbar">
          <a-button size="small" :loading="loading" @click="load">
            <template #icon><ReloadOutlined /></template>
            刷新
          </a-button>
          <a-button size="small" :disabled="!selectedIds.length" @click="batchEnable(true)">批量启用</a-button>
          <a-button size="small" :disabled="!selectedIds.length" @click="batchEnable(false)">批量禁用</a-button>
          <a-button size="small" :disabled="!selectedIds.length" @click="batchRunNow">立即运行选中</a-button>
          <a-button size="small" danger :disabled="!selectedIds.length" @click="batchRemove">删除选中</a-button>
          <a-button type="primary" size="small" @click="openWizard(null)">
            <template #icon><PlusOutlined /></template>
            新建任务
          </a-button>
        </div>
      </div>
      <div class="wem-card-body tight">
        <WemTable
          table-id="schedules-list"
          row-key="id"
          :rows="rows"
          :columns="columns"
          :loading="loading"
          :page-size="20"
          :capabilities="caps"
          :row-class="rowClass"
          empty-text="还没有定时任务，点右上角「新建任务」创建一条只读备份任务"
          @selection-change="onSelectionChange"
        >
          <template #cell="{ row, column }">
            <template v-if="column.key === 'name'">
              <span class="cell-name">{{ row.name }}</span>
            </template>
            <template v-else-if="column.key === 'type'">
              <a-tag :color="row.typeColor">{{ row.typeText }}</a-tag>
            </template>
            <template v-else-if="column.key === 'schedule'">
              <span>{{ row.scheduleText }}</span>
            </template>
            <template v-else-if="column.key === 'target'">
              <span class="cell-path mono" :title="row.target">{{ row.target }}</span>
            </template>
            <template v-else-if="column.key === 'lastRun'">
              <div>{{ row.lastRunText }}</div>
              <div v-if="row.lastResultText" class="last-result" :class="row.lastResultOk ? 'ok' : 'bad'">
                {{ row.lastResultText }}
              </div>
            </template>
            <template v-else-if="column.key === 'nextRun'">
              <span>{{ row.nextRunText }}</span>
            </template>
            <template v-else-if="column.key === 'status'">
              <a-tooltip>
                <template #title>{{ row.statusTip }}</template>
                <a-tag :color="row.statusColor">{{ row.statusText }}</a-tag>
              </a-tooltip>
            </template>
            <template v-else-if="column.key === 'actions'">
              <a-space size="small" @click.stop>
                <a @click.stop="runNow(row)">立即运行</a>
                <a @click.stop="toggleEnabled(row)">{{ row.enabled ? '禁用' : '启用' }}</a>
                <a @click.stop="openWizard(row)">编辑</a>
                <a class="danger-link" @click.stop="removeOne(row)">删除</a>
              </a-space>
            </template>
          </template>
        </WemTable>
      </div>
    </div>

    <!-- ==================== 说明 ==================== -->
    <div class="wem-card">
      <div class="wem-card-head">
        <div class="wem-card-title"><InfoCircleOutlined /> 关于定时任务</div>
      </div>
      <div class="wem-card-body">
        <div class="hint-box warn" style="margin-bottom: 10px">
          <ExclamationCircleOutlined />
          <div>
            <b>定时任务只允许只读 / 备份类操作</b>：系统环境快照、注册表分支备份、审计日志导出、环境健康诊断。
            任何修改环境变量或注册表的操作都不允许定时执行，后端会直接拒绝。
          </div>
        </div>
        <ul class="note-list">
          <li>任务由 Windows 任务计划程序在到点后启动本程序，带 <span class="mono">--scheduled-run &lt;任务ID&gt;</span> 参数执行。</li>
          <li>关闭「注册到计划程序」时只在本地保存任务定义（dry-run），不会真正写入系统计划任务。</li>
          <li>程序升级或移动安装目录后，已注册任务的路径会失效，列表里标红为「失效」，请编辑后重新保存即可重建。</li>
          <li>「立即运行」在本进程内异步执行，提示已开始后请稍等几秒刷新查看上次执行结果。</li>
        </ul>
      </div>
    </div>

    <!-- ==================== 五步向导 ==================== -->
    <a-modal
      v-model:open="wizardOpen"
      :title="form.id ? `编辑定时任务 · ${form.name || '未命名'}` : '新建定时任务'"
      width="820px"
      :mask-closable="false"
      :footer="null"
    >
      <a-steps :current="step" size="small" class="wizard-steps">
        <a-step title="任务类型" />
        <a-step title="执行计划" />
        <a-step title="任务参数" />
        <a-step title="执行选项" />
        <a-step title="预览保存" />
      </a-steps>

      <!-- 步骤 1 -->
      <div v-show="step === 0" class="step-body">
        <div class="hint-box" style="margin-bottom: 12px">
          <InfoCircleOutlined />
          <div>只能选择只读 / 备份类任务。创建后系统会自动按计划执行，不会改动任何环境变量。</div>
        </div>
        <div class="type-grid">
          <div
            v-for="t in typeOptions"
            :key="t.key"
            class="type-card"
            :class="{ active: form.type === t.key }"
            @click="pickType(t.key)"
          >
            <div class="type-head">
              <component :is="t.icon" class="type-icon" />
              <span>{{ t.label }}</span>
            </div>
            <div class="type-desc">{{ t.desc }}</div>
            <a-tag color="green" style="margin-top: 8px">只读 / 备份</a-tag>
          </div>
        </div>
        <a-form layout="vertical" style="margin-top: 14px">
          <a-form-item label="任务名称" required>
            <a-input v-model:value="form.name" size="small" :placeholder="defaultName" :maxlength="60" />
          </a-form-item>
        </a-form>
      </div>

      <!-- 步骤 2 -->
      <div v-show="step === 1" class="step-body">
        <a-form layout="vertical">
          <a-row :gutter="12">
            <a-col :span="12">
              <a-form-item label="频率">
                <a-radio-group v-model:value="form.frequency" size="small" button-style="solid">
                  <a-radio-button value="daily">每日</a-radio-button>
                  <a-radio-button value="weekly">每周</a-radio-button>
                  <a-radio-button value="monthly">每月</a-radio-button>
                </a-radio-group>
              </a-form-item>
            </a-col>
            <a-col :span="12">
              <a-form-item label="执行时间（时:分，24 小时制）">
                <a-input v-model:value="form.time" size="small" class="mono" style="width: 120px" placeholder="03:00" />
              </a-form-item>
            </a-col>
          </a-row>

          <a-form-item v-if="form.frequency === 'weekly'" label="每周执行日（可多选）">
            <a-checkbox-group v-model:value="form.weekdays">
              <a-checkbox v-for="d in weekdays" :key="d.value" :value="d.value">{{ d.label }}</a-checkbox>
            </a-checkbox-group>
          </a-form-item>

          <a-form-item v-if="form.frequency === 'monthly'" label="每月执行日（可多选）">
            <a-checkbox-group v-model:value="form.monthdays" class="monthday-group">
              <a-checkbox v-for="d in 31" :key="d" :value="d">{{ d }}</a-checkbox>
            </a-checkbox-group>
            <div class="text-muted" style="font-size: 12px; margin-top: 4px">29 / 30 / 31 日在没有该日期的月份会跳过。</div>
          </a-form-item>

          <a-divider style="margin: 8px 0 14px" />
          <a-row :gutter="12">
            <a-col :span="12">
              <a-form-item label="仅在空闲时运行">
                <a-switch v-model:checked="form.onlyIdle" />
                <span class="text-muted" style="margin-left: 8px; font-size: 12px">本机空闲时才启动，避免影响前台工作</span>
              </a-form-item>
            </a-col>
            <a-col :span="12">
              <a-form-item label="错过补执行">
                <a-switch v-model:checked="form.catchUp" />
                <span class="text-muted" style="margin-left: 8px; font-size: 12px">计划时间点机器关机时，开机后补一次</span>
              </a-form-item>
            </a-col>
          </a-row>

          <div class="hint-box" style="margin-top: 4px">
            <InfoCircleOutlined />
            <div>计划预览：<b>{{ scheduleText }}</b></div>
          </div>
        </a-form>
      </div>

      <!-- 步骤 3 -->
      <div v-show="step === 2" class="step-body">
        <!-- 快照 -->
        <a-form v-if="form.type === 'snapshot'" layout="vertical">
          <a-form-item label="保存目录">
            <div class="pick-row">
              <a-input v-model:value="form.params.dir" size="small" class="mono" placeholder="留空使用软件默认快照目录" />
              <a-button size="small" @click="pickFolder('dir')">浏览…</a-button>
            </div>
          </a-form-item>
          <a-row :gutter="12">
            <a-col :span="12">
              <a-form-item label="标记为受保护快照">
                <a-switch v-model:checked="form.params.protect" />
                <span class="text-muted" style="margin-left: 8px; font-size: 12px">受保护快照不会被自动清理</span>
              </a-form-item>
            </a-col>
            <a-col :span="12">
              <a-form-item label="保留数量">
                <a-input-number v-model:value="form.params.keep" size="small" :min="1" :max="500" />
                <span class="text-muted" style="margin-left: 8px; font-size: 12px">超出后清理最早自动快照</span>
              </a-form-item>
            </a-col>
          </a-row>
        </a-form>

        <!-- 注册表备份 -->
        <a-form v-else-if="form.type === 'registry-backup'" layout="vertical">
          <a-form-item label="注册表分支路径（每行一个）" required>
            <a-textarea
              v-model:value="form.branchText"
              :rows="4"
              class="mono"
              placeholder="HKCU\Environment&#10;HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment"
            />
            <div class="text-muted" style="font-size: 12px; margin-top: 4px">
              支持 HKCU / HKLM / HKCR / HKU / HKCC 根项；留空则备份用户与系统两个环境变量分支。
            </div>
          </a-form-item>
          <a-row :gutter="12">
            <a-col :span="12">
              <a-form-item label="备份格式">
                <a-radio-group v-model:value="form.params.format" size="small">
                  <a-radio-button value="json">JSON（结构化，可对比）</a-radio-button>
                  <a-radio-button value="reg">REG（可双击导入）</a-radio-button>
                </a-radio-group>
              </a-form-item>
            </a-col>
            <a-col :span="12">
              <a-form-item label="保存目录">
                <div class="pick-row">
                  <a-input v-model:value="form.params.dir" size="small" class="mono" placeholder="留空使用注册表备份目录" />
                  <a-button size="small" @click="pickFolder('dir')">浏览…</a-button>
                </div>
              </a-form-item>
            </a-col>
          </a-row>
        </a-form>

        <!-- 审计导出 -->
        <a-form v-else-if="form.type === 'audit-export'" layout="vertical">
          <a-form-item label="导出目录">
            <div class="pick-row">
              <a-input v-model:value="form.params.dir" size="small" class="mono" placeholder="留空使用软件默认导出目录" />
              <a-button size="small" @click="pickFolder('dir')">浏览…</a-button>
            </div>
          </a-form-item>
          <a-form-item label="导出格式">
            <a-radio-group v-model:value="form.params.format" size="small">
              <a-radio-button value="jsonl">JSONL（原始审计流水）</a-radio-button>
              <a-radio-button value="csv">CSV（表格可读）</a-radio-button>
            </a-radio-group>
          </a-form-item>
        </a-form>

        <!-- 健康诊断 -->
        <a-form v-else layout="vertical">
          <a-form-item label="报告保存目录">
            <div class="pick-row">
              <a-input v-model:value="form.params.dir" size="small" class="mono" placeholder="留空使用软件诊断目录" />
              <a-button size="small" @click="pickFolder('dir')">浏览…</a-button>
            </div>
          </a-form-item>
          <a-form-item label="报告格式">
            <a-radio-group v-model:value="form.params.format" size="small">
              <a-radio-button value="markdown">Markdown</a-radio-button>
              <a-radio-button value="html">HTML</a-radio-button>
            </a-radio-group>
          </a-form-item>
        </a-form>
      </div>

      <!-- 步骤 4 -->
      <div v-show="step === 3" class="step-body">
        <a-form layout="vertical">
          <a-form-item label="后台静默执行">
            <a-switch v-model:checked="form.runHidden" />
            <span class="text-muted" style="margin-left: 8px; font-size: 12px">执行时不弹出主窗口，只在后台完成</span>
          </a-form-item>
          <a-form-item label="失败时桌面通知">
            <a-switch v-model:checked="form.notifyOnFail" />
            <span class="text-muted" style="margin-left: 8px; font-size: 12px">任务失败时弹出系统通知，便于及时发现</span>
          </a-form-item>
          <a-form-item label="注册到 Windows 任务计划程序">
            <a-switch v-model:checked="form.register" />
            <span class="text-muted" style="margin-left: 8px; font-size: 12px">
              关闭则只保存任务定义（不写入系统计划任务），可稍后再开启
            </span>
          </a-form-item>
        </a-form>
        <div class="hint-box" style="margin-top: 10px">
          <InfoCircleOutlined />
          <div>
            静默执行仅适用于备份类只读操作。修改环境变量、恢复备份、导入注册表等操作禁止定时执行，
            避免在无人值守时改坏系统环境。
          </div>
        </div>
      </div>

      <!-- 步骤 5 -->
      <div v-show="step === 4" class="step-body">
        <div class="kv-list">
          <span class="kv-key">任务名称</span><span class="kv-val">{{ form.name || defaultName }}</span>
          <span class="kv-key">任务类型</span>
          <span class="kv-val">{{ typeTextOf(form.type) }}<a-tag color="green" style="margin-left: 8px">只读 / 备份</a-tag></span>
          <span class="kv-key">执行计划</span><span class="kv-val">{{ scheduleText }}</span>
          <span class="kv-key">下次执行</span><span class="kv-val">{{ previewNextText || localNextText }}</span>
          <span class="kv-key">任务参数</span><span class="kv-val mono param-text">{{ paramsSummary }}</span>
          <span class="kv-key">执行选项</span>
          <span class="kv-val">
            {{ form.runHidden ? '后台静默' : '显示窗口' }} ·
            {{ form.notifyOnFail ? '失败通知' : '不通知' }} ·
            {{ form.register ? '注册到计划程序' : '仅本地保存（dry-run）' }} ·
            {{ form.onlyIdle ? '仅空闲时运行' : '不限制空闲' }} ·
            {{ form.catchUp ? '错过补执行' : '不补执行' }}
          </span>
        </div>
        <div v-if="previewCommand" class="cmd-box">
          <div class="cmd-title">将写入计划程序的命令</div>
          <pre class="cmd-text">{{ previewCommand }}</pre>
        </div>
        <div v-if="previewNote" class="text-muted" style="font-size: 12px; margin-top: 6px">{{ previewNote }}</div>
      </div>

      <div class="wizard-foot">
        <span class="text-muted step-hint">第 {{ step + 1 }} / 5 步</span>
        <div class="wizard-btns">
          <a-button @click="wizardOpen = false">取消</a-button>
          <a-button :disabled="step === 0" @click="step -= 1">上一步</a-button>
          <a-button v-if="step < 4" type="primary" @click="nextStep">下一步</a-button>
          <a-button v-else type="primary" :loading="saving" @click="save">保存任务</a-button>
        </div>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import {
  CalendarOutlined, ReloadOutlined, PlusOutlined, InfoCircleOutlined, ExclamationCircleOutlined,
  HistoryOutlined, DatabaseOutlined, FileTextOutlined, SafetyCertificateOutlined
} from '@ant-design/icons-vue'
import api from '@/api'
import WemTable from '@/components/wem-table/WemTable.vue'
import { confirm, danger } from '@/components/dialogs/dialogService'
import { formatTime } from '@/lib/helpers'

const TYPE_META = {
  snapshot: { text: '系统环境快照', color: 'blue', icon: HistoryOutlined, desc: '按计划抓取当前全部用户变量与系统变量，生成可回滚的快照文件。' },
  'registry-backup': { text: '注册表分支备份', color: 'purple', icon: DatabaseOutlined, desc: '备份指定的注册表分支（默认环境变量分支），支持 JSON / REG 两种格式。' },
  'audit-export': { text: '审计日志导出', color: 'cyan', icon: FileTextOutlined, desc: '把审计流水打包导出到指定目录，便于外部归档与合规检查。' },
  'health-scan': { text: '环境健康诊断', color: 'green', icon: SafetyCertificateOutlined, desc: '执行一次完整健康诊断并把报告保存到磁盘，不改动任何配置。' }
}

const typeOptions = Object.keys(TYPE_META).map((key) => ({
  key,
  label: TYPE_META[key].text,
  desc: TYPE_META[key].desc,
  icon: TYPE_META[key].icon
}))

const weekdays = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 7, label: '周日' }
]
const WEEK_LABEL = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日' }

const loading = ref(false)
const saving = ref(false)
const tasks = ref([])
const selectedIds = ref([])

const wizardOpen = ref(false)
const step = ref(0)
const previewNextText = ref('')
const previewCommand = ref('')
const previewNote = ref('')

const form = reactive({
  id: '',
  name: '',
  type: 'snapshot',
  frequency: 'daily',
  time: '03:00',
  weekdays: [1, 2, 3, 4, 5],
  monthdays: [1],
  onlyIdle: false,
  catchUp: false,
  runHidden: true,
  notifyOnFail: true,
  register: true,
  params: { dir: '', protect: false, keep: 30, format: 'json' },
  branchText: ''
})

const caps = {
  inline: false,
  drag: false,
  export: false,
  format: false,
  presets: false,
  summary: false,
  contextMenu: false,
  expand: false,
  batchCopy: false,
  batchExport: false,
  batchTag: false,
  batchEnable: false,
  batchDelete: false
}

const columns = [
  { title: '任务名称', key: 'name', dataIndex: 'name', width: 190, ellipsis: true },
  {
    title: '类型',
    key: 'type',
    dataIndex: 'type',
    type: 'enum',
    width: 140,
    enumOptions: Object.keys(TYPE_META).map((key) => ({ value: key, label: TYPE_META[key].text }))
  },
  { title: '执行计划', key: 'schedule', dataIndex: 'scheduleText', width: 200 },
  { title: '目标路径', key: 'target', dataIndex: 'target', ellipsis: true },
  { title: '上次执行', key: 'lastRun', dataIndex: 'lastRunAt', type: 'date', width: 175 },
  { title: '下次执行', key: 'nextRun', dataIndex: 'nextRunAt', type: 'date', width: 165 },
  {
    title: '状态',
    key: 'status',
    dataIndex: 'statusKey',
    type: 'enum',
    width: 100,
    enumOptions: [
      { value: 'on', label: '启用' },
      { value: 'off', label: '禁用' },
      { value: 'stale', label: '失效' }
    ]
  },
  { title: '操作', key: 'actions', width: 230, fixed: 'right', sortable: false, filterable: false }
]

/* ------------------------------ 列表 ------------------------------ */

function typeTextOf(type) {
  return (TYPE_META[type] && TYPE_META[type].text) || type || '未知'
}

function scheduleTextOf(schedule) {
  const s = schedule || {}
  const time = s.time || '09:00'
  if (s.frequency === 'weekly') {
    const days = (s.weekdays || []).map((d) => WEEK_LABEL[Number(d)] || `周${d}`).join('、')
    return `每周 ${days || '（未选择）'} ${time}`
  }
  if (s.frequency === 'monthly') {
    const days = (s.monthdays || []).map((d) => `${d} 日`).join('、')
    return `每月 ${days || '（未选择）'} ${time}`
  }
  return `每天 ${time}`
}

function targetOf(task) {
  const p = task.params || {}
  if (task.type === 'registry-backup') {
    const list = Array.isArray(p.paths) && p.paths.length ? p.paths : ['HKCU\\Environment', 'HKLM\\…\\Environment']
    return list.join('；')
  }
  if (p.dir) return p.dir
  if (task.type === 'snapshot') return '默认快照目录'
  if (task.type === 'audit-export') return '默认导出目录'
  if (task.type === 'health-scan') return '默认诊断目录'
  return '—'
}

const rows = computed(() => (tasks.value || []).map((task) => {
  const meta = TYPE_META[task.type] || { text: task.type, color: 'default' }
  const stale = !!task.stale
  const statusKey = stale ? 'stale' : (task.enabled ? 'on' : 'off')
  const last = task.lastResult || null
  return {
    ...task,
    typeText: meta.text,
    typeColor: meta.color,
    scheduleText: scheduleTextOf(task.schedule),
    target: targetOf(task),
    lastRunAt: task.lastRunAt || null,
    lastRunText: task.lastRunAt ? formatTime(task.lastRunAt) : '从未执行',
    lastResultOk: !!(last && last.ok),
    lastResultText: last ? (last.ok ? '成功' : `失败：${last.message || '未知原因'}`) : '',
    nextRunAt: task.enabled && !stale && task.nextRunAt ? task.nextRunAt : null,
    nextRunText: task.enabled && !stale && task.nextRunAt ? formatTime(task.nextRunAt) : '—',
    statusKey,
    statusText: { on: '启用', off: '禁用', stale: '失效' }[statusKey],
    statusColor: { on: 'green', off: 'default', stale: 'red' }[statusKey],
    statusTip: stale
      ? '程序路径已变更，请重建任务'
      : (task.registered ? '已注册到 Windows 任务计划程序' : '未注册到计划程序（仅本地保存）')
  }
}))

const enabledCount = computed(() => rows.value.filter((row) => row.enabled && !row.stale).length)

function rowClass(record) {
  return record.statusKey === 'stale' ? 'row-removed' : ''
}

function onSelectionChange(keys) {
  selectedIds.value = Array.isArray(keys) ? keys : []
}

async function load() {
  loading.value = true
  try {
    const res = await api.schedule.list()
    if (!res.ok) {
      message.error(res.message)
      return
    }
    tasks.value = (res.data && res.data.tasks) || []
  } finally {
    loading.value = false
  }
}

/* ------------------------------ 行操作 ------------------------------ */

async function runNow(task) {
  const res = await api.schedule.runNow({ id: task.id })
  if (!res.ok) {
    message.error(res.message)
    return
  }
  message.success(`任务「${task.name}」已开始执行，请稍后刷新查看结果`)
}

async function setEnabled(ids, enabled) {
  const res = await api.schedule.setEnabled({ ids, enabled })
  if (!res.ok) {
    message.error(res.message)
    return false
  }
  const failed = (res.data && res.data.failed) || []
  if (failed.length) {
    message.warning(`本地状态已更新，但有 ${failed.length} 个任务变更计划程序状态失败：${failed[0].message}`)
  } else {
    message.success(enabled ? '已启用所选任务' : '已禁用所选任务')
  }
  await load()
  return true
}

function toggleEnabled(task) {
  return setEnabled([task.id], !task.enabled)
}

async function batchEnable(enabled) {
  if (!selectedIds.value.length) return
  await setEnabled(selectedIds.value.slice(), enabled)
}

async function batchRunNow() {
  const ids = selectedIds.value.slice()
  if (!ids.length) return
  let ok = 0
  for (const id of ids) {
    const res = await api.schedule.runNow({ id })
    if (res.ok) ok += 1
    else message.error(res.message)
  }
  if (ok) message.success(`已开始执行 ${ok} 个任务，请稍后刷新查看结果`)
}

async function removeTasks(ids) {
  const res = await api.schedule.remove({ ids })
  if (!res.ok) {
    message.error(res.message)
    return
  }
  const failures = (res.data && res.data.failures) || []
  if (failures.length) {
    message.warning(`本地任务已删除，但 ${failures.length} 个计划任务清理失败：${failures[0].message}`)
  } else {
    message.success(`已删除 ${(res.data && res.data.removed) || ids.length} 个任务`)
  }
  selectedIds.value = []
  await load()
}

async function removeOne(task) {
  const ok = await danger({
    title: `删除定时任务「${task.name}」？`,
    warning: '任务会从 Windows 任务计划程序中一并删除，之后不再自动执行。该操作不可撤销。',
    columns: [
      { title: '任务类型', dataIndex: 'typeText', key: 'typeText', width: 160 },
      { title: '执行计划', dataIndex: 'scheduleText', key: 'scheduleText', ellipsis: true }
    ],
    rows: [{ key: task.id, typeText: task.typeText, scheduleText: task.scheduleText }],
    hint: '已生成的历史快照、备份与报告文件不会被删除。'
  })
  if (!ok) return
  await removeTasks([task.id])
}

async function batchRemove() {
  const ids = selectedIds.value.slice()
  if (!ids.length) return
  const ok = await confirm({
    title: `删除选中的 ${ids.length} 个定时任务？`,
    content: '这些任务会同时从 Windows 任务计划程序中删除，之后不再自动执行。已生成的历史文件不受影响。'
  })
  if (!ok) return
  await removeTasks(ids)
}

/* ------------------------------ 向导 ------------------------------ */

const defaultName = computed(() => {
  const base = typeTextOf(form.type)
  return `自动${base}`
})

const scheduleText = computed(() => {
  if (form.frequency === 'weekly') {
    const days = (form.weekdays || []).slice().sort((a, b) => a - b).map((d) => WEEK_LABEL[d]).join('、')
    return `每周 ${days || '（未选择）'} ${form.time || '--:--'}`
  }
  if (form.frequency === 'monthly') {
    const days = (form.monthdays || []).slice().sort((a, b) => a - b).map((d) => `${d} 日`).join('、')
    return `每月 ${days || '（未选择）'} ${form.time || '--:--'}`
  }
  return `每天 ${form.time || '--:--'}`
})

const localNextText = computed(() => {
  const next = computeNext()
  return next ? formatTime(next) : '无法估算'
})

const paramsSummary = computed(() => {
  const p = form.params || {}
  const bits = []
  if (form.type === 'registry-backup') {
    const list = branchList()
    bits.push(`分支：${list.length ? list.join('、') : '默认用户 + 系统环境变量'}`)
    bits.push(`格式：${p.format === 'reg' ? 'REG' : 'JSON'}`)
  } else if (form.type === 'snapshot') {
    bits.push(`目录：${p.dir || '默认快照目录'}`)
    bits.push(p.protect ? '受保护' : '普通快照')
    bits.push(`保留 ${p.keep || 30} 份`)
  } else if (form.type === 'audit-export') {
    bits.push(`目录：${p.dir || '默认导出目录'}`)
    bits.push(`格式：${String(p.format || 'jsonl').toUpperCase()}`)
  } else {
    bits.push(`目录：${p.dir || '默认诊断目录'}`)
    bits.push(`格式：${p.format === 'html' ? 'HTML' : 'Markdown'}`)
  }
  return bits.join(' · ')
})

function computeNext() {
  const m = String(form.time || '').match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return 0
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (hh > 23 || mm > 59) return 0
  const now = Date.now()
  for (let i = 0; i < 400; i += 1) {
    const base = new Date(now)
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i, hh, mm, 0, 0)
    if (d.getTime() <= now) continue
    if (form.frequency === 'weekly' && (form.weekdays || []).length && !form.weekdays.includes(((d.getDay() + 6) % 7) + 1)) continue
    if (form.frequency === 'monthly' && (form.monthdays || []).length && !form.monthdays.includes(d.getDate())) continue
    return d.getTime()
  }
  return 0
}

function branchList() {
  return String(form.branchText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function resetForm() {
  Object.assign(form, {
    id: '',
    name: '',
    type: 'snapshot',
    frequency: 'daily',
    time: '03:00',
    weekdays: [1, 2, 3, 4, 5],
    monthdays: [1],
    onlyIdle: false,
    catchUp: false,
    runHidden: true,
    notifyOnFail: true,
    register: true,
    params: { dir: '', protect: false, keep: 30, format: 'json' },
    branchText: ''
  })
}

function openWizard(task) {
  resetForm()
  step.value = 0
  previewNextText.value = ''
  previewCommand.value = ''
  previewNote.value = ''
  if (task) {
    Object.assign(form, {
      id: task.id,
      name: task.name || '',
      type: task.type || 'snapshot',
      frequency: (task.schedule && task.schedule.frequency) || 'daily',
      time: (task.schedule && task.schedule.time) || '03:00',
      weekdays: (task.schedule && task.schedule.weekdays && task.schedule.weekdays.length) ? task.schedule.weekdays.slice() : [1, 2, 3, 4, 5],
      monthdays: (task.schedule && task.schedule.monthdays && task.schedule.monthdays.length) ? task.schedule.monthdays.slice() : [1],
      onlyIdle: !!(task.params && task.params.onlyIdle),
      catchUp: !!(task.params && task.params.catchUp),
      runHidden: task.runHidden !== false,
      notifyOnFail: task.notifyOnFail !== false,
      register: !!task.registered,
      params: {
        dir: (task.params && task.params.dir) || '',
        protect: !!(task.params && task.params.protect),
        keep: Number(task.params && task.params.keep) || 30,
        format: (task.params && task.params.format) || (task.type === 'audit-export' ? 'jsonl' : task.type === 'health-scan' ? 'markdown' : 'json')
      },
      branchText: Array.isArray(task.params && task.params.paths) ? task.params.paths.join('\n') : ''
    })
    if (form.type === 'health-scan' && form.params.format === 'json') form.params.format = 'markdown'
  }
  wizardOpen.value = true
}

function pickType(type) {
  if (form.type === type) return
  form.type = type
  form.params = {
    dir: '',
    protect: false,
    keep: 30,
    format: type === 'audit-export' ? 'jsonl' : type === 'health-scan' ? 'markdown' : 'json'
  }
  if (type === 'registry-backup' && !form.branchText) {
    form.branchText = 'HKCU\\Environment\nHKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'
  }
  if (!form.name) form.name = `自动${typeTextOf(type)}`
}

async function pickFolder(field) {
  const picked = await api.fs.selectFolder({ title: '选择保存目录' })
  if (!picked.ok) {
    message.error(picked.message)
    return
  }
  if (picked.data && !picked.data.canceled) form.params[field] = picked.data.path
}

function validateStep() {
  if (step.value === 1) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(form.time || ''))) {
      message.error('执行时间格式应为 HH:mm（24 小时制），例如 03:00')
      return false
    }
    if (form.frequency === 'weekly' && !(form.weekdays || []).length) {
      message.error('每周任务至少选择一天')
      return false
    }
    if (form.frequency === 'monthly' && !(form.monthdays || []).length) {
      message.error('每月任务至少选择一个日期')
      return false
    }
  }
  if (step.value === 2 && form.type === 'registry-backup') {
    const list = branchList()
    const bad = list.find((p) => !/^(HKCU|HKLM|HKCR|HKU|HKCC)\\/i.test(p))
    if (bad) {
      message.error(`注册表路径不合法：${bad}（应以 HKCU\\ / HKLM\\ 等根项开头）`)
      return false
    }
  }
  return true
}

function nextStep() {
  if (!validateStep()) return
  step.value += 1
  if (step.value === 4) loadPreview()
}

async function loadPreview() {
  previewNextText.value = ''
  previewCommand.value = ''
  previewNote.value = ''
  const res = await api.schedule.preview({ schedule: { frequency: form.frequency, time: form.time, weekdays: form.weekdays, monthdays: form.monthdays } })
  if (!res.ok) {
    previewNote.value = res.message || ''
    return
  }
  previewNextText.value = res.data.nextRunText || ''
  previewCommand.value = res.data.commandTemplate || ''
  previewNote.value = res.data.note || ''
}

function buildParams() {
  const p = { ...form.params }
  p.onlyIdle = !!form.onlyIdle
  p.catchUp = !!form.catchUp
  if (form.type === 'registry-backup') {
    p.paths = branchList()
  }
  if (form.type === 'snapshot' && p.format !== undefined) delete p.format
  if (form.type === 'registry-backup' && p.format !== 'reg') p.format = 'json'
  return p
}

async function save() {
  if (!form.type) {
    message.error('请选择任务类型')
    return
  }
  saving.value = true
  try {
    const payload = {
      name: String(form.name || '').trim() || defaultName.value,
      type: form.type,
      schedule: {
        frequency: form.frequency,
        time: form.time,
        weekdays: form.weekdays,
        monthdays: form.monthdays
      },
      params: buildParams(),
      runHidden: form.runHidden,
      notifyOnFail: form.notifyOnFail,
      dryRun: !form.register
    }
    const res = form.id
      ? await api.schedule.update({ id: form.id, ...payload })
      : await api.schedule.create(payload)
    if (!res.ok) {
      message.error(res.message)
      return
    }
    const data = res.data || {}
    if (form.register && data.registered === false) {
      message.warning(`任务已保存，但注册到任务计划程序失败：${data.registerError || '未知原因'}`)
    } else if (!form.register || data.dryRun === true) {
      message.success('任务已保存（仅本地，未注册到任务计划程序）')
    } else {
      message.success(form.id ? '任务已更新并重新注册' : '任务已创建并注册')
    }
    wizardOpen.value = false
    await load()
  } finally {
    saving.value = false
  }
}

watch(() => form.type, (type) => {
  if (type === 'health-scan' && !['markdown', 'html'].includes(form.params.format)) form.params.format = 'markdown'
  if (type === 'audit-export' && !['jsonl', 'csv'].includes(form.params.format)) form.params.format = 'jsonl'
  if (type === 'snapshot') form.params.format = 'json'
})

onMounted(load)
</script>

<style scoped>
.note-list {
  margin: 0;
  padding-left: 20px;
  font-size: var(--wem-fs);
  line-height: 1.9;
  color: var(--wem-text-2);
}

.last-result {
  font-size: 11.5px;
  margin-top: 2px;
}

.last-result.ok {
  color: var(--wem-success);
}

.last-result.bad {
  color: var(--wem-danger);
}

.danger-link {
  color: var(--wem-danger);
}

.wizard-steps {
  margin-bottom: 16px;
}

.step-body {
  min-height: 240px;
}

.type-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}

.type-card {
  border: 1px solid var(--wem-border);
  border-radius: 10px;
  background: var(--wem-card-alt);
  padding: 12px;
  cursor: pointer;
  transition: all 0.14s ease;
}

.type-card:hover {
  border-color: var(--wem-primary);
  box-shadow: var(--wem-shadow-sm);
}

.type-card.active {
  border-color: var(--wem-primary);
  box-shadow: 0 0 0 2px rgba(22, 93, 255, 0.14);
  background: var(--wem-card);
}

.type-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: 13px;
}

.type-icon {
  color: var(--wem-primary);
  font-size: 15px;
}

.type-desc {
  font-size: 12px;
  color: var(--wem-text-3);
  line-height: 1.65;
  margin-top: 6px;
}

.pick-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.monthday-group {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
}

.param-text {
  word-break: break-all;
}

.cmd-box {
  margin-top: 12px;
  border: 1px solid var(--wem-border);
  border-radius: 8px;
  background: var(--wem-card-alt);
  padding: 10px 12px;
}

.cmd-title {
  font-size: 12px;
  color: var(--wem-text-3);
  margin-bottom: 6px;
}

.cmd-text {
  margin: 0;
  font-family: var(--wem-mono);
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--wem-text-2);
  white-space: pre-wrap;
  word-break: break-all;
}

.wizard-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--wem-border);
}

.step-hint {
  font-size: 12px;
}

.wizard-btns {
  display: flex;
  gap: 8px;
}
</style>
