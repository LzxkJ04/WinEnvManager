<template>
  <div>
    <!-- 快照操作 -->
    <div class="wem-card">
      <div class="wem-card-head">
        <div class="wem-card-title">
          <CameraOutlined />
          <span>环境变量快照</span>
          <a-tag color="blue">{{ snapshots.length }} 个</a-tag>
        </div>
        <div class="toolbar">
          <a-button type="primary" size="small" @click="openCreate">
            <template #icon><PlusOutlined /></template>
            新建快照
          </a-button>
          <a-button size="small" @click="loadList">
            <template #icon><ReloadOutlined /></template>
            刷新列表
          </a-button>
          <a-button size="small" @click="openSnapshotDir">
            <template #icon><FolderOpenOutlined /></template>
            打开快照目录
          </a-button>
          <a-button size="small" @click="showPrunePreview">
            <template #icon><EyeOutlined /></template>
            清理预览
          </a-button>
        </div>
      </div>

      <div class="wem-card-body tight">
        <div class="toolbar" style="margin-bottom: 8px; flex-wrap: wrap">
          <a-tag color="blue"><ClockCircleOutlined /> 自动快照策略：{{ snapshotPolicyText }}</a-tag>
          <a-tag v-if="env.config.snapshotPaused" color="red">已暂停</a-tag>
          <a-tag v-if="snapshotProtectedCount" color="purple">{{ snapshotProtectedCount }} 个受保护</a-tag>
          <a-tag color="green">写入系统前始终自动快照</a-tag>
          <span class="text-muted">暂停自动快照</span>
          <a-switch
            size="small"
            :checked="!!env.config.snapshotPaused"
            @change="(v) => toggleSnapshotPause(v)"
          />
          <span class="text-muted">上限 {{ env.config.snapshotMax || 50 }} 个，超出自动清理最早的自动快照</span>
        </div>
        <WemTable
          table-id="snapshot-list"
          row-key="id"
          :rows="snapshotRows"
          :columns="snapshotColumns"
          :page-size="8"
          :capabilities="snapCaps"
          empty-text="还没有任何快照，点击「新建快照」抓取当前环境"
          empty-action-label="新建快照"
          @empty-action="openCreate"
        >
          <template #cell="{ row, column }">
            <template v-if="column.key === 'name'">
              <span class="cell-name">{{ row.name }}</span>
              <a-tag v-if="row.auto" color="orange" style="margin-left: 6px">自动</a-tag>
              <a-tag v-if="isBaseline(row.id)" color="gold" style="margin-left: 6px">基线</a-tag>
              <a-tag v-if="row.protected" color="green" style="margin-left: 6px">受保护</a-tag>
            </template>
            <template v-else-if="column.key === 'note'">
              <span class="text-muted">{{ row.note || '—' }}</span>
            </template>
            <template v-else-if="column.key === 'counts'">
              <span class="mono">用户 {{ row.counts.user }} · 系统 {{ row.counts.machine }}</span>
            </template>
            <template v-else-if="column.key === 'time'">
              <span class="text-muted">{{ row.createdAtText }}</span>
            </template>
            <template v-else-if="column.key === 'actions'">
              <a-space size="small">
                <a @click.stop="compareWithCurrent(row)">与当前对比</a>
                <a @click.stop="restoreFrom(row)">选择性恢复</a>
                <a @click.stop="markBaseline(row)">{{ isBaseline(row.id) ? '取消基线' : '标记基线' }}</a>
                <a @click.stop="toggleProtect(row)">{{ row.protected ? '取消保护' : '保护' }}</a>
                <a @click.stop="exportSnapshot(row)">导出备份</a>
                <a class="danger-link" @click.stop="removeSnapshot(row)">删除</a>
              </a-space>
            </template>
          </template>
        </WemTable>
      </div>
    </div>

    <!-- 对比模式 -->
    <div class="wem-card">
      <div class="wem-card-head">
        <div class="wem-card-title"><DiffOutlined /> 差异对比</div>
        <span class="text-muted">绿色＝新增，红色＝删除，黄色＝修改</span>
      </div>
      <div class="wem-card-body">
        <div class="toolbar" style="margin-bottom: 12px">
          <a-radio-group v-model:value="compareMode" button-style="solid" size="small">
            <a-radio-button value="current">当前环境 VS 快照</a-radio-button>
            <a-radio-button value="two">快照 A VS 快照 B</a-radio-button>
          </a-radio-group>

          <template v-if="compareMode === 'current'">
            <a-select v-model:value="snapshotId" size="small" style="width: 280px" placeholder="选择快照">
              <a-select-option v-for="s in snapshots" :key="s.id" :value="s.id">
                {{ s.name }}（{{ s.createdAtText }}）
              </a-select-option>
            </a-select>
            <span class="text-muted">→</span>
            <a-tag color="blue">当前环境 {{ nowText }}</a-tag>
          </template>

          <template v-else>
            <a-select v-model:value="leftId" size="small" style="width: 240px" placeholder="快照 A">
              <a-select-option v-for="s in snapshots" :key="s.id" :value="s.id">{{ s.name }}</a-select-option>
            </a-select>
            <span class="text-muted">VS</span>
            <a-select v-model:value="rightId" size="small" style="width: 240px" placeholder="快照 B">
              <a-select-option v-for="s in snapshots" :key="s.id" :value="s.id">{{ s.name }}</a-select-option>
            </a-select>
          </template>

          <a-button type="primary" size="small" :loading="comparing" @click="runCompare">
            <template #icon><DiffOutlined /></template>
            开始对比
          </a-button>
          <a-button v-if="diff" size="small" @click="diff = null">清除结果</a-button>
        </div>

        <div v-if="!diff" class="empty-block">
          选择对比对象后点击「开始对比」，即可查看两个时点之间的全部环境变化。
        </div>

        <template v-else>
          <div class="stat-grid" style="margin-bottom: 12px">
            <div class="stat-card">
              <div class="stat-label">差异总数</div>
              <div class="stat-value" style="color: #165dff">{{ diff.summary.total }}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">新增</div>
              <div class="stat-value" style="color: #00b42a">{{ diff.summary.added }}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">删除</div>
              <div class="stat-value" style="color: #f53f3f">{{ diff.summary.removed }}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">修改</div>
              <div class="stat-value" style="color: #ff7d00">{{ diff.summary.changed }}</div>
            </div>
          </div>

          <DiffCard
            title="用户变量差异"
            scope="user"
            :diff="diff.user"
            selectable
            @select="(rows) => (pickedUser = rows)"
          />
          <DiffCard
            title="系统变量差异"
            scope="machine"
            :diff="diff.machine"
            selectable
            @select="(rows) => (pickedMachine = rows)"
          />

          <div class="wem-card" style="margin-top: 14px">
            <div class="wem-card-body">
              <div class="toolbar">
                <a-button
                  type="primary"
                  :disabled="!pickedUser.length && !pickedMachine.length"
                  :loading="restoring"
                  @click="restorePicked"
                >
                  <template #icon><RollbackOutlined /></template>
                  将勾选项还原为「{{ diff.restoreLabel }}」
                </a-button>
                <span class="text-muted">
                  已勾选 {{ pickedUser.length + pickedMachine.length }} 项。
                  会先校验快照，并生成恢复前临时快照；写入失败自动回滚。
                </span>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- 新建快照 -->
    <a-modal v-model:open="createOpen" title="新建环境变量快照" ok-text="创建" cancel-text="取消" @ok="submitCreate">
      <a-form layout="vertical" style="margin-top: 8px">
        <a-form-item label="快照名称" required>
          <a-input v-model:value="createForm.name" placeholder="例如：安装 Java 前" />
        </a-form-item>
        <a-form-item label="备注">
          <a-textarea v-model:value="createForm.note" :rows="3" placeholder="可选，记录这次快照的背景" />
        </a-form-item>
      </a-form>
      <div class="hint-box">
        <InfoCircleOutlined />
        <div>将抓取当前全部用户变量与系统变量，保存到
          <span class="mono">%APPDATA%\win-env-manager\snapshots\</span>
        </div>
      </div>
    </a-modal>

    <!-- 选择性恢复 -->
    <a-modal v-model:open="restoreOpen" title="选择性恢复快照" width="860px" :force-render="true" ok-text="执行恢复" cancel-text="取消" @ok="doRestoreFromSnapshot">
      <div v-if="restoreTarget" class="hint-box warn" style="margin-bottom: 12px">
        <WarningOutlined />
        <div>
          正在预览快照「{{ restoreTarget.name }}」（{{ restoreTarget.createdAtText }}）。
          勾选需要还原的变量，未勾选的保持现状。{{ restoreNote }}
        </div>
      </div>
      <WemTable
        ref="restoreTable"
        table-id="snapshot-restore"
        row-key="__key"
        :rows="restoreItems"
        :columns="restoreColumns"
        :capabilities="restoreCaps"
        empty-text="这份快照和当前环境没有差异"
        @selection-change="(keys) => (restoreKeys = keys)"
      >
        <template #cell="{ row, column }">
          <template v-if="column.key === 'scope'">
            <a-tag :color="row.scope === 'machine' ? 'purple' : 'blue'">
              {{ row.scopeLabel }}
            </a-tag>
          </template>
          <template v-else-if="column.key === 'name'"><span class="mono">{{ row.name }}</span></template>
          <template v-else-if="column.key === 'current'">
            <span class="diff-value-old">{{ row.currentText }}</span>
          </template>
          <template v-else-if="column.key === 'snap'">
            <span class="diff-value-new">{{ row.snapText }}</span>
          </template>
        </template>
      </WemTable>
    </a-modal>
  </div>
</template>

<script setup>
import { computed, h, nextTick, onMounted, reactive, ref } from 'vue'
import { Modal, message } from 'ant-design-vue'
import {
  CameraOutlined, PlusOutlined, ReloadOutlined, FolderOpenOutlined, DiffOutlined,
  RollbackOutlined, InfoCircleOutlined, WarningOutlined, EyeOutlined, ClockCircleOutlined
} from '@ant-design/icons-vue'
import DiffCard from '@/components/DiffCard.vue'
import { useEnvStore } from '@/store/env'
import { useUiStore } from '@/store/ui'
import api from '@/api'
import WemTable from '@/components/wem-table/WemTable.vue'

const env = useEnvStore()
const ui = useUiStore()

const snapshotPolicyText = computed(() => ({
  start: '软件启动时',
  quit: '软件关闭时',
  off: '已关闭'
}[env.config.snapshotTrigger] || '软件关闭时'))
const snapshotProtectedCount = computed(() => snapshots.value.filter((s) => s.protected).length)

function skipSnapshotHash() {
  try {
    const raw = localStorage.getItem('wem-snapshot-settings')
    if (!raw) return false
    const data = JSON.parse(raw)
    return !!data && Object.prototype.hasOwnProperty.call(data, 'hashCheck') && data.hashCheck === false
  } catch {
    return false
  }
}

async function toggleSnapshotPause(v) {
  env.config = { ...env.config, snapshotPaused: v }
  const res = await api.config.set({ snapshotPaused: v })
  if (res.ok) {
    message.success(v ? '自动快照已暂停（写入系统前的快照不受影响）' : '自动快照已恢复')
  } else {
    message.error(res.message)
  }
}

const snapshots = ref([])
const comparing = ref(false)
const restoring = ref(false)

const compareMode = ref('current')
const snapshotId = ref(undefined)
const leftId = ref(undefined)
const rightId = ref(undefined)
const diff = ref(null)
const pickedUser = ref([])
const pickedMachine = ref([])

const createOpen = ref(false)
const createForm = reactive({ name: '', note: '' })

const restoreOpen = ref(false)
const restoreTarget = ref(null)
const restoreItems = ref([])
const restoreKeys = ref([])

const snapCaps = {
  inline: false,
  drag: false,
  batchDelete: false,
  batchTag: false,
  batchEnable: false,
  expand: false,
  summary: false
}
const snapshotColumns = [
  { title: '快照名称', key: 'name', dataIndex: 'name', width: 240, ellipsis: true },
  { title: '备注', key: 'note', dataIndex: 'note', ellipsis: true },
  { title: '包含变量', key: 'counts', dataIndex: 'countText', width: 200, sortable: false },
  { title: '创建时间', key: 'time', dataIndex: 'createdAtText', width: 170 },
  { title: '操作', key: 'actions', width: 360, sortable: false, filterable: false, fixed: 'right' }
]
const snapshotRows = computed(() =>
  (snapshots.value || []).map((item) => ({
    ...item,
    countText: `用户 ${item.counts?.user || 0} · 系统 ${item.counts?.machine || 0}`
  }))
)

const restoreTable = ref(null)
const restoreNote = ref('')
const restoreCaps = {
  inline: false,
  drag: false,
  batchDelete: false,
  batchTag: false,
  batchEnable: false,
  expand: false,
  summary: false,
  contextMenu: false
}
const restoreColumns = [
  { title: '归属', key: 'scope', dataIndex: 'scopeLabel', width: 90 },
  { title: '变量名', key: 'name', dataIndex: 'name', width: 200, ellipsis: true },
  { title: '当前值', key: 'current', dataIndex: 'currentText', ellipsis: true },
  { title: '快照值', key: 'snap', dataIndex: 'snapText', ellipsis: true }
]

const nowText = computed(() => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
})

function clip(v) {
  const s = String(v ?? '')
  return s.length > 70 ? s.slice(0, 70) + '…' : s || '（空）'
}

async function loadList() {
  const res = await api.snapshot.list()
  if (res.ok) {
    snapshots.value = res.data
    if (!snapshotId.value && res.data.length) snapshotId.value = res.data[0].id
    if (!leftId.value && res.data.length) leftId.value = res.data[0].id
    if (!rightId.value && res.data.length > 1) rightId.value = res.data[1].id
  } else {
    message.error(res.message)
  }
  const base = await api.snapshot.getBaseline()
  baselineId.value = base.ok ? base.data : ''
}

const baselineId = ref('')

function isBaseline(id) {
  return baselineId.value === id
}

async function toggleProtect(record) {
  const next = !record.protected
  const res = await api.snapshot.setProtected({ id: record.id, protected: next })
  if (res.ok) {
    record.protected = next
    message.success(next ? '已标记为受保护快照，不会被自动清理' : '已取消保护')
  } else {
    message.error(res.message)
  }
}

async function showPrunePreview() {
  const res = await api.snapshot.previewPrune()
  if (!res.ok) return message.error(res.message)
  const d = res.data || {}
  Modal.info({
    title: '自动清理预览',
    width: 560,
    content: h('div', null, [
      h('p', null, `当前共 ${d.total} 个快照，上限 ${d.limit} 个，其中受保护 ${d.protectedCount} 个。`),
      h('p', null, d.willRemove && d.willRemove.length
        ? `超过上限时将按「自动快照优先」删除：${d.willRemove.map((s) => s.name).join('、')}`
        : '当前没有会被自动清理的快照。')
    ]),
    okText: '知道了'
  })
}

async function markBaseline(record) {
  if (isBaseline(record.id)) {
    baselineId.value = ''
    await api.snapshot.setBaseline('')
    message.success('已取消基线标记')
    return
  }
  const res = await api.snapshot.setBaseline(record.id)
  if (res.ok) {
    baselineId.value = record.id
    message.success(`已将「${record.name}」标记为基线快照，可快速对比当前环境与基线差异`)
  } else message.error(res.message)
}

async function exportSnapshot(record) {
  const detail = await api.snapshot.get(record.id)
  if (!detail.ok) return message.error(detail.message)
  const saved = await api.fs.saveFile({
    title: '将快照导出为独立备份文件',
    defaultPath: `${record.name}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (!saved.ok || saved.data.canceled) return
  const body = {
    kind: 'win-env-manager-backup',
    backupMeta: {
      backupId: record.id, backupName: record.name, comment: record.note || '',
      backupType: 'full', createTime: record.createdAtText, encrypt: false, checksum: '', softwareVersion: 'WinEnv管家 v2.0'
    },
    envData: {
      userVariables: detail.data.userEnv || [],
      systemVariables: detail.data.systemEnv || [],
      pathext: detail.data.pathext || { value: '', locked: false }
    },
    user: detail.data.user || {},
    machine: detail.data.machine || {}
  }
  const w = await api.fs.writeTextFile({ file: saved.data.path, content: JSON.stringify(body, null, 2) })
  if (w.ok) {
    message.success('快照已导出为独立备份文件，可用于跨机迁移')
    ui.tip(`快照已导出：${saved.data.path}`, 'success')
  }
}

function openCreate() {
  createForm.name = `快照 ${new Date().toLocaleString('zh-CN')}`
  createForm.note = ''
  createOpen.value = true
}

async function submitCreate() {
  if (!createForm.name.trim()) return message.error('请输入快照名称')
  const res = await api.snapshot.create({ name: createForm.name.trim(), note: createForm.note })
  if (res.ok) {
    createOpen.value = false
    message.success('快照已创建')
    ui.tip(`快照「${res.data.name}」已保存`, 'success')
    await loadList()
  } else {
    message.error(res.message)
  }
}

function removeSnapshot(record) {
  Modal.confirm({
    title: '确认删除该快照？',
    content: `${record.name}（${record.createdAtText}）`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      const res = await api.snapshot.remove(record.id)
      if (res.ok) {
        message.success('快照已删除')
        await loadList()
      } else {
        message.error(res.message)
      }
    }
  })
}

async function openSnapshotDir() {
  const res = await api.tool.envSummary()
  if (res.ok) await api.tool.openFolder(res.data.paths.snapshots)
}

async function runCompare() {
  let payload
  let restoreSnapshotId = ''
  let restoreLabel = ''
  if (compareMode.value === 'current') {
    if (!snapshotId.value) return message.warning('请先选择快照')
    const s = snapshots.value.find((x) => x.id === snapshotId.value)
    restoreSnapshotId = snapshotId.value
    restoreLabel = s ? s.name : '快照'
    payload = { snapshotId: snapshotId.value, leftLabel: restoreLabel, rightLabel: '当前环境' }
  } else {
    if (!leftId.value || !rightId.value) return message.warning('请选择两个快照')
    if (leftId.value === rightId.value) return message.warning('请选择两个不同的快照')
    const a = snapshots.value.find((x) => x.id === leftId.value)
    const b = snapshots.value.find((x) => x.id === rightId.value)
    restoreSnapshotId = rightId.value
    restoreLabel = b?.name || '快照 B'
    payload = { mode: 'two', leftId: leftId.value, rightId: rightId.value, leftLabel: a?.name, rightLabel: restoreLabel }
  }

  comparing.value = true
  try {
    const res = await api.snapshot.compare(payload)
    if (!res.ok) throw new Error(res.message)
    diff.value = { ...res.data, restoreSnapshotId, restoreLabel }
    pickedUser.value = []
    pickedMachine.value = []
    message.success(`对比完成，共 ${res.data.summary.total} 处差异`)
    ui.tip(`差异对比完成，共 ${res.data.summary.total} 处变化`, 'info')
  } catch (err) {
    message.error(err.message)
  } finally {
    comparing.value = false
  }
}

function compareWithCurrent(record) {
  compareMode.value = 'current'
  snapshotId.value = record.id
  runCompare()
}

/* ------------------------------ 选择性恢复 ------------------------------ */

async function restoreFrom(record) {
  const full = await api.snapshot.get({ id: record.id, skipHash: skipSnapshotHash() })
  if (!full.ok) return message.error(full.message)
  const snap = full.data
  const items = []
  for (const scope of ['user', 'machine']) {
    const snapMap = snap[scope] || {}
    const curMap = env.original[scope] || {}
    for (const name of Object.keys(snapMap)) {
      if (curMap[name] === snapMap[name]) continue
      const currentValue = Object.prototype.hasOwnProperty.call(curMap, name) ? curMap[name] : null
      items.push(restoreRow(scope, name, snapMap[name], currentValue))
    }
    for (const name of Object.keys(curMap)) {
      if (!(name in snapMap)) items.push(restoreRow(scope, name, null, curMap[name]))
    }
  }
  restoreTarget.value = { ...record, raw: snap }
  restoreItems.value = items
  restoreKeys.value = items.filter((i) => !(i.scope === 'machine' && !env.admin)).map((i) => i.__key)
  restoreNote.value = snap.checksum && snap.checksum.skipped
    ? '已按设置跳过校验和。恢复前仍会生成临时快照，写入失败会自动回滚。'
    : snap.checksum && snap.checksum.legacy
    ? '这份快照是旧格式，没有校验和，仍可恢复。'
    : '校验和已通过。恢复前会先生成临时快照，写入失败会自动回滚。'
  restoreOpen.value = true
  await nextTick()
  restoreTable.value?.setSelection(restoreKeys.value)
}

function restoreRow(scope, name, snapshotValue, currentValue) {
  return {
    __key: `${scope}::${name}`,
    scope,
    name,
    scopeLabel: scope === 'machine' ? '系统' : '用户',
    snapshotValue,
    currentValue,
    currentText: currentValue === null ? '（当前不存在）' : clip(currentValue),
    snapText: snapshotValue === null ? '（快照中不存在）' : clip(snapshotValue)
  }
}

async function doRestoreFromSnapshot() {
  const picked = restoreItems.value.filter((i) => restoreKeys.value.includes(i.__key))
  if (!picked.length) {
    message.warning('请勾选要恢复的变量')
    return Promise.reject(new Error('cancel'))
  }

  restoring.value = true
  try {
    const res = await api.snapshot.restore({
      snapshotId: restoreTarget.value.id,
      items: picked.map((item) => ({ scope: item.scope, name: item.name })),
      skipHash: skipSnapshotHash()
    })
    if (!res.ok) throw new Error(res.message)
    restoreOpen.value = false
    const extra = res.data && res.data.legacy ? '（旧快照，未做校验和）' : ''
    message.success(`已恢复 ${res.data.count || picked.length} 项${extra}`)
    ui.tip(`已从快照恢复 ${res.data.count || picked.length} 项环境变量`, 'success')
    await env.load()
    await loadList()
  } catch (err) {
    if (err && err.message === 'cancel') return Promise.reject(err)
    Modal.error({ title: '恢复失败', content: err.message })
    return Promise.reject(err)
  } finally {
    restoring.value = false
  }
}

async function restorePicked() {
  const picked = [...pickedUser.value, ...pickedMachine.value]
  if (!picked.length) return message.warning('请先在差异表格中勾选要还原的项')
  const targetId = diff.value && diff.value.restoreSnapshotId
  const label = (diff.value && diff.value.restoreLabel) || '目标快照'
  if (!targetId) return message.warning('请先完成对比')

  Modal.confirm({
    title: `确认还原 ${picked.length} 项？`,
    content: `将把勾选项恢复为快照「${label}」中的值。会先校验快照，并生成受保护的临时快照；写入失败自动回滚。`,
    okText: '确认还原',
    cancelText: '取消',
    onOk: async () => {
      restoring.value = true
      try {
        const res = await api.snapshot.restore({
          snapshotId: targetId,
          items: picked.map((item) => ({ scope: item.scope, name: item.name })),
          skipHash: skipSnapshotHash()
        })
        if (!res.ok) throw new Error(res.message)
        const extra = res.data && res.data.legacy ? '（旧快照，未做校验和）' : ''
        message.success(`已还原 ${res.data.count || picked.length} 项${extra}`)
        ui.tip(`已还原 ${res.data.count || picked.length} 项`, 'success')
        await env.load()
        await loadList()
        runCompare()
      } catch (err) {
        Modal.error({ title: '还原失败', content: err.message })
        return Promise.reject(err)
      } finally {
        restoring.value = false
      }
    }
  })
}

onMounted(loadList)
</script>

<style scoped>
.danger-link {
  color: var(--wem-danger);
}
</style>
