<template>
  <div>
    <!-- 一键备份 -->
    <div class="wem-card">
      <div class="wem-card-head">
        <div class="wem-card-title"><CloudDownloadOutlined /> 一键完整备份</div>
        <span class="text-muted">备份内容包含全部用户变量与系统变量</span>
      </div>
      <div class="wem-card-body">
        <a-radio-group v-model:value="format" button-style="solid" style="margin-bottom: 12px">
          <a-radio-button value="reg">.reg 注册表文件</a-radio-button>
          <a-radio-button value="json">.json 专用备份</a-radio-button>
          <a-radio-button value="txt">.txt 可读文本</a-radio-button>
        </a-radio-group>

        <div class="format-tip">
          <template v-if="format === 'reg'">
            Windows 原生注册表格式，双击即可导入系统，也可用于 regedit 手动还原。包含用户与系统两个键。
          </template>
          <template v-else-if="format === 'json'">
            本工具专用格式（v2），支持增量备份与密码加密，还原时支持逐项勾选，最安全。
          </template>
          <template v-else>
            纯文本格式，方便人工查看与在其它机器上编辑后重新导入。
          </template>
        </div>

        <template v-if="format === 'json'">
          <div class="toolbar" style="margin-top: 12px">
            <span class="text-muted">备份类型：</span>
            <a-radio-group v-model:value="backupType" size="small">
              <a-radio-button value="full">全量备份</a-radio-button>
              <a-radio-button value="increment">增量备份（仅备份自上次备份后的变更）</a-radio-button>
            </a-radio-group>
          </div>
          <div class="toolbar" style="margin-top: 10px">
            <span class="text-muted">加密密码：</span>
            <a-input-password v-model:value="backupPassword" size="small" style="width: 200px" placeholder="留空表示不加密" />
            <span class="text-muted">备份备注：</span>
            <a-input v-model:value="backupComment" size="small" style="width: 240px" placeholder="例如：开发环境基线" />
          </div>
        </template>

        <div class="toolbar" style="margin-top: 12px">
          <a-button type="primary" :loading="exporting" @click="doExport">
            <template #icon><SaveOutlined /></template>
            立即备份
          </a-button>
          <a-button @click="openBackupDir">
            <template #icon><FolderOpenOutlined /></template>
            打开备份文件夹
          </a-button>
          <a-button @click="syncRemote" :disabled="!files.length">
            <template #icon><CloudUploadOutlined /></template>
            同步到远端目录
          </a-button>
          <span class="text-muted">默认目录：<span class="mono">{{ backupDir }}</span></span>
        </div>
      </div>
    </div>

    <!-- 还原向导 -->
    <div class="wem-card">
      <div class="wem-card-head">
        <div class="wem-card-title"><CloudUploadOutlined /> 还原向导</div>
        <div class="toolbar">
          <a-button size="small" @click="pickBackupFile">
            <template #icon><FolderOpenOutlined /></template>
            选择备份文件
          </a-button>
          <a-button size="small" type="primary" :disabled="!preview" :loading="restoring" @click="doRestore">
            执行还原（{{ selectedForRestore.length }} 项）
          </a-button>
        </div>
      </div>

      <div class="wem-card-body">
        <div v-if="!preview" class="empty-block">
          支持 <span class="mono">.reg</span> / <span class="mono">.json</span> / <span class="mono">.txt</span>
          三种备份文件。选择后会自动解析并与当前环境对比，列出所有变更项供你勾选。
        </div>

        <template v-else>
          <div class="hint-box warn" style="margin-bottom: 12px">
            <WarningOutlined />
            <div>
              正在预览 <span class="mono">{{ preview.file }}</span>
            </div>
          </div>

          <div class="stat-grid" style="margin-bottom: 12px">
            <div class="stat-card"><div class="stat-label">备份条目</div><div class="stat-value">{{ preview.total }}</div></div>
            <div class="stat-card"><div class="stat-label">将新增</div><div class="stat-value" style="color: #00b42a">{{ preview.creatable }}</div></div>
            <div class="stat-card"><div class="stat-label">将覆盖</div><div class="stat-value" style="color: #ff7d00">{{ preview.updatable }}</div></div>
            <div class="stat-card"><div class="stat-label">值相同</div><div class="stat-value" style="color: var(--wem-text-3)">{{ preview.same }}</div></div>
          </div>

          <div class="toolbar" style="margin-bottom: 8px">
            <a-button size="small" @click="selectAll(true)">全选可还原项</a-button>
            <a-button size="small" @click="selectAll(false)">全不选</a-button>
            <a-radio-group v-model:value="restoreScopeFilter" size="small" button-style="solid">
              <a-radio-button value="all">全部</a-radio-button>
              <a-radio-button value="user">仅用户变量</a-radio-button>
              <a-radio-button value="machine">仅系统变量</a-radio-button>
            </a-radio-group>
            <span v-if="preview && !preview.checksumOk" style="color:#f53f3f;font-size:12px">
              ⚠ 备份文件校验值不匹配，可能已损坏
            </span>
          </div>

          <WemTable
            ref="previewTable"
            table-id="backup-preview"
            row-key="__key"
            :rows="previewRows"
            :columns="previewColumns"
            :page-size="12"
            :capabilities="previewCaps"
            :row-class="previewRowClass"
            :row-disabled="rowLocked"
            empty-text="没有可显示的备份条目"
            @selection-change="(keys) => (selectedRowKeys = keys)"
          >
            <template #cell="{ row, column }">
              <template v-if="column.key === 'action'">
                <a-tag :color="{ create: 'green', update: 'orange', same: 'default' }[row.action]">
                  {{ row.actionText }}
                </a-tag>
              </template>
              <template v-else-if="column.key === 'scope'">
                <a-tag :color="row.scope === 'machine' ? 'purple' : 'blue'">
                  {{ row.scopeLabel }}
                </a-tag>
              </template>
              <template v-else-if="column.key === 'name'">
                <span class="cell-name">{{ row.name }}</span>
              </template>
              <template v-else-if="column.key === 'current'">
                <span class="diff-value-old">{{ row.currentText }}</span>
              </template>
              <template v-else-if="column.key === 'backup'">
                <span class="diff-value-new">{{ row.backupText }}</span>
              </template>
            </template>
          </WemTable>
        </template>
      </div>
    </div>

    <!-- 备份文件管理 -->
    <div class="wem-card">
      <div class="wem-card-head">
        <div class="wem-card-title"><DatabaseOutlined /> 备份文件管理</div>
        <div class="toolbar">
          <a-input v-model:value="dirInput" size="small" style="width: 320px" class="mono" />
          <a-button size="small" @click="changeDir">更换目录</a-button>
          <a-button size="small" @click="refreshList"><ReloadOutlined /></a-button>
          <a-button size="small" @click="openBackupDir"><FolderOpenOutlined /> 打开</a-button>
        </div>
      </div>
      <div class="wem-card-body tight">
        <WemTable
          table-id="backup-files"
          row-key="file"
          :rows="fileRows"
          :columns="fileColumns"
          :page-size="10"
          :capabilities="fileCaps"
          empty-text="这个目录里还没有备份文件"
        >
          <template #cell="{ row, column }">
            <template v-if="column.key === 'format'">
              <a-tag :color="{ reg: 'purple', json: 'blue', txt: 'default' }[row.format]">
                {{ row.format }}
              </a-tag>
            </template>
            <template v-else-if="column.key === 'name'">
              <span class="mono">{{ row.name }}</span>
            </template>
            <template v-else-if="column.key === 'size'">
              <span class="text-muted">{{ row.sizeText }}</span>
            </template>
            <template v-else-if="column.key === 'time'">
              <span class="text-muted">{{ row.timeText }}</span>
            </template>
            <template v-else-if="column.key === 'actions'">
              <a-space size="small">
                <a @click.stop="loadFromFile(row.file)">预览还原</a>
                <a @click.stop="showInFolder(row.file)">定位</a>
                <a class="danger-link" @click.stop="removeFile(row)">删除</a>
              </a-space>
            </template>
          </template>
        </WemTable>
      </div>
    </div>

    <!-- 自动备份设置 -->
    <div class="wem-card">
      <div class="wem-card-head">
        <div class="wem-card-title"><SettingOutlined /> 自动备份</div>
      </div>
      <div class="wem-card-body">
        <a-form layout="horizontal" :label-col="{ span: 5 }" :wrapper-col="{ span: 12 }">
          <a-form-item label="写入系统前自动备份">
            <a-switch
              :checked="env.config.autoBackup !== false"
              @change="(v) => setConfig({ autoBackup: v })"
              checked-children="开启"
              un-checked-children="关闭"
            />
            <span class="text-muted" style="margin-left: 10px">每次保存写入注册表之前自动生成一份备份文件</span>
          </a-form-item>
          <a-form-item label="自动备份格式">
            <a-radio-group
              :value="env.config.autoBackupFormat || 'json'"
              size="small"
              @change="(e) => setConfig({ autoBackupFormat: e.target.value })"
            >
              <a-radio-button value="json">JSON</a-radio-button>
              <a-radio-button value="reg">REG</a-radio-button>
              <a-radio-button value="txt">TXT</a-radio-button>
            </a-radio-group>
          </a-form-item>
          <a-form-item label="备份存储目录">
            <a-input :value="backupDir" readonly class="mono" style="width: 420px" />
          </a-form-item>
        </a-form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, h, nextTick, onMounted, ref } from 'vue'
import { Modal, message } from 'ant-design-vue'
import {
  CloudDownloadOutlined, CloudUploadOutlined, DatabaseOutlined, SaveOutlined,
  FolderOpenOutlined, ReloadOutlined, SettingOutlined, WarningOutlined
} from '@ant-design/icons-vue'
import { useEnvStore } from '@/store/env'
import { useUiStore } from '@/store/ui'
import api from '@/api'
import WemTable from '@/components/wem-table/WemTable.vue'

const env = useEnvStore()
const ui = useUiStore()

const format = ref('json')
const exporting = ref(false)
const restoring = ref(false)
const backupType = ref('full')
const backupPassword = ref('')
const backupComment = ref('')

const preview = ref(null)
const selectedRowKeys = ref([])
const restoreScopeFilter = ref('all')

const files = ref([])
const backupDir = ref('')
const dirInput = ref('')

const previewTable = ref(null)
const previewCaps = {
  inline: false,
  drag: false,
  batchDelete: false,
  batchTag: false,
  batchEnable: false,
  expand: false,
  summary: false,
  contextMenu: false,
  format: false,
  presets: false
}
const previewColumns = [
  { title: '动作', key: 'action', dataIndex: 'actionText', width: 90 },
  { title: '归属', key: 'scope', dataIndex: 'scopeLabel', width: 90 },
  { title: '变量名', key: 'name', dataIndex: 'name', width: 200, ellipsis: true },
  { title: '当前值', key: 'current', dataIndex: 'currentText', ellipsis: true },
  { title: '备份值', key: 'backup', dataIndex: 'backupText', ellipsis: true }
]

const fileCaps = {
  select: false,
  inline: false,
  drag: false,
  batchDelete: false,
  batchTag: false,
  batchEnable: false,
  expand: false,
  summary: false,
  contextMenu: false
}
const fileColumns = [
  { title: '文件名', key: 'name', dataIndex: 'name', ellipsis: true },
  { title: '格式', key: 'format', dataIndex: 'format', width: 90 },
  { title: '大小', key: 'size', dataIndex: 'size', width: 100 },
  { title: '生成时间', key: 'time', dataIndex: 'timeText', width: 180 },
  { title: '操作', key: 'actions', width: 190, sortable: false, filterable: false, fixed: 'right' }
]
const fileRows = computed(() =>
  (files.value || []).map((item) => ({
    ...item,
    sizeText: `${((item.size || 0) / 1024).toFixed(1)} KB`,
    timeText: fmtTime(item.mtime)
  }))
)

const previewRows = computed(() => {
  if (!preview.value) return []
  const items = preview.value.items.filter((i) => restoreScopeFilter.value === 'all' || i.scope === restoreScopeFilter.value)
  return items.map((i) => ({
    ...i,
    __key: `${i.scope}::${i.name}`,
    actionText: { create: '新增', update: '覆盖', same: '相同' }[i.action] || i.action,
    scopeLabel: i.scope === 'machine' ? '系统' : '用户',
    currentText: i.currentValue === null ? '（不存在）' : clip(i.currentValue),
    backupText: clip(i.value)
  }))
})

const selectedForRestore = computed(() =>
  previewRows.value.filter((r) => selectedRowKeys.value.includes(r.__key) && canRestoreRow(r))
)

function clip(v) {
  const s = String(v ?? '')
  return s.length > 80 ? s.slice(0, 80) + '…' : s || '（空）'
}

function fmtTime(ts) {
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function canRestoreRow(record) {
  return record.action !== 'same' && !(record.scope === 'machine' && !env.admin)
}

function rowLocked(record) {
  return !canRestoreRow(record)
}

function restoreKeys() {
  return previewRows.value.filter((row) => canRestoreRow(row)).map((row) => row.__key)
}

function previewRowClass(record) {
  return record.action === 'create' ? 'diff-row-added' : record.action === 'update' ? 'diff-row-changed' : ''
}

/* ------------------------------ 备份 ------------------------------ */

async function doExport() {
  exporting.value = true
  try {
    if (format.value === 'json' && backupType.value === 'increment' && backupPassword.value && !files.value.some((f) => f.format === 'json')) {
      message.warning('增量备份需要存在上一份 JSON 备份作为基准，本次将生成全量备份')
    }
    const res = await api.backup.exportV2({
      format: format.value,
      backupType: format.value === 'json' ? backupType.value : 'full',
      password: backupPassword.value || '',
      comment: backupComment.value
    })
    if (!res.ok) throw new Error(res.message)
    if (res.data.canceled) return
    if (res.data.empty) {
      message.info('与上一份备份相比没有变更，未生成新文件')
      return
    }
    message.success(`备份文件已生成（${res.data.type === 'increment' ? '增量' : '全量'}）`)
    ui.tip(`备份已导出：${res.data.file}`, 'success')
    await refreshList()
  } catch (err) {
    Modal.error({ title: '备份失败', content: err.message })
  } finally {
    exporting.value = false
  }
}

async function syncRemote() {
  const picked = await api.fs.selectFolder({ title: '选择远端备份目录（本地 / 网络共享路径）' })
  if (!picked.ok || picked.data.canceled) return
  let n = 0
  for (const f of files.value) {
    const res = await api.backup.copyToRemote({ file: f.file, remoteDir: picked.data.path })
    if (res.ok) n += 1
  }
  message.success(`已同步 ${n} 份备份到 ${picked.data.path}`)
}

async function refreshList() {
  const res = await api.backup.list()
  if (res.ok) {
    files.value = res.data.files
    backupDir.value = res.data.dir
    dirInput.value = res.data.dir
  }
  // 保留数量上限清理
  const keep = Number(env.config.backupKeep) || 0
  if (keep > 0) await api.backup.prune(keep)
}

async function openBackupDir() {
  const res = await api.backup.openDir(backupDir.value)
  if (!res.ok) message.error(res.message)
}

async function changeDir() {
  const picked = await api.fs.selectFolder({ title: '选择备份存储目录', defaultPath: backupDir.value })
  if (picked.ok && !picked.data.canceled) {
    const res = await api.config.set({ backupDir: picked.data.path })
    if (res.ok) {
      backupDir.value = res.data.paths.backupDir
      dirInput.value = backupDir.value
      env.config.backupDir = picked.data.path
      message.success('备份目录已更新')
      await refreshList()
    }
  }
}

async function setConfig(patch) {
  const res = await api.config.set(patch)
  if (res.ok) {
    env.config = { ...env.config, ...patch }
    message.success('设置已保存')
  }
}

function removeFile(record) {
  Modal.confirm({
    title: '确认删除该备份文件？',
    content: record.name,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      const res = await api.backup.remove(record.file)
      if (res.ok) {
        message.success('已删除')
        await refreshList()
      } else {
        message.error(res.message)
      }
    }
  })
}

async function showInFolder(file) {
  await api.tool.showInFolder(file)
}

/* ------------------------------ 还原 ------------------------------ */

async function pickBackupFile() {
  const res = await api.backup.import({})
  if (!res.ok) return message.error(res.message)
  if (res.data.canceled) return
  applyPreview(res.data)
}

async function loadFromFile(file) {
  const read = await api.backup.readV2({ file, password: backupPassword.value })
  if (!read.ok) return message.error(read.message)
  if (read.data.encrypted && !backupPassword.value) {
    const pwd = await askPassword()
    if (!pwd) return
    return loadFromFile(file)
  }
  if (!read.data.checksumOk) message.warning('备份文件校验值不匹配，可能已损坏，请谨慎还原')
  const res = await api.backup.import({ file })
  if (!res.ok) return message.error(res.message)
  applyPreview(res.data)
}

function askPassword() {
  return new Promise((resolve) => {
    Modal.confirm({
      title: '该备份已加密',
      content: h('div', null, [
        h('p', { style: 'margin:0 0 6px' }, '请输入备份密码：'),
        h('input', {
          id: '__wem_pwd__',
          type: 'password',
          style: 'width:100%;padding:5px 8px;border:1px solid #d9d9d9;border-radius:6px'
        })
      ]),
      okText: '解密并读取',
      cancelText: '取消',
      onOk: () => {
        const el = document.getElementById('__wem_pwd__')
        backupPassword.value = el ? el.value : ''
        resolve(backupPassword.value)
      },
      onCancel: () => resolve('')
    })
  })
}

async function applyPreview(data) {
  preview.value = data
  selectedRowKeys.value = restoreKeys()
  await nextTick()
  previewTable.value?.setSelection(selectedRowKeys.value)
  message.info(`已解析 ${data.total} 条备份记录`)
}

function selectAll(v) {
  selectedRowKeys.value = v ? restoreKeys() : []
  previewTable.value?.setSelection(selectedRowKeys.value)
}

async function doRestore() {
  const targets = selectedForRestore.value
  if (!targets.length) return message.warning('请先勾选要还原的变量')

  Modal.confirm({
    title: `确认还原 ${targets.length} 项环境变量？`,
    content: '该操作会直接写入注册表。执行前会自动备份；写入失败会按原值回滚。值相同的项和无管理员权限时的系统变量不能勾选。',
    okText: '确认还原',
    cancelText: '取消',
    onOk: async () => {
      restoring.value = true
      try {
        // 还原前先自动备份当前状态
        await api.backup.export({ format: 'json', silent: true, prefix: 'BeforeRestore' })

        const changes = targets.map((t) => {
          const change = {
            action: t.action === 'create' ? 'create' : 'update',
            scope: t.scope,
            name: t.name,
            value: t.value
          }
          if (change.action === 'update') change.oldValue = t.currentValue == null ? '' : String(t.currentValue)
          return change
        })
        const res = await api.env.applyChanges(changes)
        if (!res.ok) throw new Error(res.message)
        const failed = (res.data.results || []).filter((r) => !r.ok)
        if (failed.length) throw new Error(failed.map((f) => f.name).join('、') + ' 还原失败')

        message.success(`已还原 ${changes.length} 项`)
        ui.tip(`已还原 ${changes.length} 项环境变量`, 'success')
        preview.value = null
        selectedRowKeys.value = []
        await env.load()
        Modal.success({
          title: '还原完成',
          content: res.data.needRestartExplorer
            ? '涉及系统变量，建议重启资源管理器让新变量立即生效。'
            : '新开命令行窗口即可读取到最新变量。'
        })
      } catch (err) {
        Modal.error({ title: '还原失败', content: err.message })
      } finally {
        restoring.value = false
      }
    }
  })
}

onMounted(refreshList)
</script>

<style scoped>
.format-tip {
  font-size: 12.5px;
  color: var(--wem-text-2);
  background: var(--wem-card-alt);
  border: 1px solid var(--wem-border);
  border-radius: 8px;
  padding: 9px 12px;
  line-height: 1.6;
}

.danger-link {
  color: var(--wem-danger);
}
</style>
