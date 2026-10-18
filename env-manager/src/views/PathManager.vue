<template>
  <div>
    <div class="hint-box" style="margin-bottom: 14px">
      <NodeIndexOutlined />
      <div>
        PATH 决定系统在哪些目录中查找可执行程序。<b>顺序即优先级</b>，越靠前越优先。
        支持对单条路径上移 / 下移 / 启用 / 禁用 / 删除，以及批量去重与有效性校验。
      </div>
    </div>

    <!-- 作用域切换 + 操作条 -->
    <div class="wem-card">
      <div class="wem-card-head">
        <div class="wem-card-title">
          <NodeIndexOutlined />
          <span>PATH 路径管理</span>
          <a-radio-group v-model:value="scope" size="small" button-style="solid">
            <a-radio-button value="user">用户 PATH</a-radio-button>
            <a-radio-button value="machine" :disabled="false">系统 PATH</a-radio-button>
          </a-radio-group>
          <a-tag color="blue">{{ items.length }} 条</a-tag>
          <a-tag v-if="invalidCount" color="red">{{ invalidCount }} 条无效</a-tag>
        </div>
        <div class="toolbar">
          <a-button type="primary" size="small" @click="openAdd">
            <template #icon><PlusOutlined /></template>
            新增路径
          </a-button>
          <a-button size="small" :loading="validating" @click="validateAll">
            <template #icon><SafetyOutlined /></template>
            校验路径有效性
          </a-button>
          <a-button size="small" :disabled="!invalidCount" danger @click="cleanInvalid">
            <template #icon><ClearOutlined /></template>
            清理无效路径
          </a-button>
          <a-dropdown>
            <a-button size="small">
              <template #icon><MoreOutlined /></template>
              更多操作
            </a-button>
            <template #overlay>
              <a-menu @click="({ key }) => onMore(key)">
                <a-menu-item key="dedup">一键去重（预览确认）</a-menu-item>
                <a-menu-item key="import">导入路径列表（txt）</a-menu-item>
                <a-menu-item key="exportTxt">导出为 txt</a-menu-item>
                <a-menu-item key="exportJson">导出为 json</a-menu-item>
                <a-menu-divider />
                <a-menu-item key="sortAsc">按字母升序排序</a-menu-item>
                <a-menu-item key="sortDesc">按字母降序排序</a-menu-item>
                <a-menu-divider />
                <a-menu-item key="scriptCmd">导出 CMD set 脚本</a-menu-item>
                <a-menu-item key="scriptPs">导出 PowerShell 脚本</a-menu-item>
                <a-menu-divider />
                <a-menu-item key="openPathDir">打开系统 PATH 所在注册表项</a-menu-item>
              </a-menu>
            </template>
          </a-dropdown>
          <a-button size="small" @click="pathextOpen = true">
            <template #icon><FileProtectOutlined /></template>
            PATHEXT
          </a-button>
        </div>
      </div>

      <div class="wem-card-head" style="padding-top: 8px; padding-bottom: 8px">
        <div class="toolbar">
          <span class="text-muted">批量：</span>
          <a-button size="small" :disabled="!selected.length" @click="batchMove(-1)">
            <template #icon><ArrowUpOutlined /></template>
            上移
          </a-button>
          <a-button size="small" :disabled="!selected.length" @click="batchMove(1)">
            <template #icon><ArrowDownOutlined /></template>
            下移
          </a-button>
          <a-button size="small" danger :disabled="!selected.length" @click="batchDelete">
            <template #icon><DeleteOutlined /></template>
            批量删除{{ selected.length ? `（${selected.length}）` : '' }}
          </a-button>
          <a-divider type="vertical" />
          <span class="text-muted">常用开发目录：</span>
          <a-tag
            v-for="p in presets"
            :key="p"
            color="blue"
            style="cursor: pointer; margin-bottom: 2px"
            @click="addPreset(p)"
          >
            + {{ p }}
          </a-tag>
        </div>
      </div>

      <div class="wem-card-body tight">
        <WemTable
          ref="pathTable"
          :table-id="`path-${scope}`"
          row-key="id"
          :rows="items"
          :columns="columns"
          :capabilities="pathCaps"
          :batch-actions="pathBatch"
          :row-class="rowClass"
          empty-text="当前 PATH 为空"
          @selection-change="(keys) => (selectedRowKeys = keys)"
          @batch="onPathBatch"
          @update:rows="onPathRows"
        >
          <template #cell="{ row, column }">
            <template v-if="column.key === 'index'">
              <span class="text-muted mono">{{ pathIndex(row) }}</span>
            </template>

            <template v-else-if="column.key === 'path'">
              <span class="cell-path" :style="{ opacity: row.disabled ? 0.45 : 1 }">{{ row.path }}</span>
              <a-tag v-if="row.disabled" color="default" style="margin-left: 6px">已禁用</a-tag>
              <a-tag v-else-if="row.invalid" color="red" style="margin-left: 6px">目录不存在</a-tag>
              <a-tag v-if="sourceTag(row.path)" :color="sourceColor(row.path)" style="margin-left: 4px">{{ sourceTag(row.path) }}</a-tag>
              <div v-if="pathRemark(row)" class="path-remark">{{ pathRemark(row) }}</div>
            </template>

            <template v-else-if="column.key === 'size'">
              <span class="text-muted mono">{{ row.path.length }}</span>
            </template>

            <template v-else-if="column.key === 'status'">
              <a-tag v-if="row.disabled" color="default">未生效</a-tag>
              <a-tag v-else-if="row.invalid" color="red">无效</a-tag>
              <a-tag v-else-if="row.checked" color="green">有效</a-tag>
              <a-tag v-else color="blue">未校验</a-tag>
            </template>

            <template v-else-if="column.key === 'actions'">
              <a-space size="small">
                <a-tooltip title="上移"><a :class="{ disabled: pathIndex(row) <= 1 }" @click.stop="pathIndex(row) > 1 && move(pathIndex(row) - 1, -1)"><ArrowUpOutlined /></a></a-tooltip>
                <a-tooltip title="下移"><a :class="{ disabled: pathIndex(row) === items.length }" @click.stop="pathIndex(row) < items.length && move(pathIndex(row) - 1, 1)"><ArrowDownOutlined /></a></a-tooltip>
                <a-tooltip :title="row.disabled ? '启用' : '禁用'">
                  <a @click.stop="toggleDisabled(row)">{{ row.disabled ? '启用' : '禁用' }}</a>
                </a-tooltip>
                <a @click.stop="openEdit(row)">编辑</a>
                <a @click.stop="openRemark(row)">备注</a>
                <a @click.stop="checkExecutables(row)">校验器</a>
                <a @click.stop="openDir(row)">打开目录</a>
                <a-dropdown>
                  <a @click.stop>更多 <DownOutlined /></a>
                  <template #overlay>
                    <a-menu @click="({ key }) => rowAction(key, row)">
                      <a-menu-item key="copy">复制路径</a-menu-item>
                      <a-menu-item key="copyFull">复制完整 PATH</a-menu-item>
                      <a-menu-item key="check">校验该条</a-menu-item>
                      <a-menu-item key="delete">删除该条</a-menu-item>
                    </a-menu>
                  </template>
                </a-dropdown>
              </a-space>
            </template>
          </template>
        </WemTable>
      </div>
    </div>

    <!-- 合并预览 -->
    <div class="wem-card">
      <div class="wem-card-head">
        <div class="wem-card-title"><FileTextOutlined /> 合并预览（写入后的完整 PATH）</div>
        <div class="toolbar">
          <a-tag :color="valueLength > 2047 ? 'red' : 'blue'">{{ valueLength }} 字符</a-tag>
          <a-button size="small" @click="copyValue">复制完整 PATH</a-button>
          <a-button size="small" @click="savePath">
            <template #icon><SaveOutlined /></template>
            保存 PATH 到系统
          </a-button>
        </div>
      </div>
      <div class="wem-card-body">
        <div v-if="valueLength > 2047" class="hint-box danger" style="margin-bottom: 10px">
          <WarningOutlined />
          <div>
            当前 PATH 长度已超过 2047 字符（注册表建议上限）。过长可能导致部分程序读取失败，
            建议清理无效路径后重试。
          </div>
        </div>
        <div class="path-preview mono">{{ mergedValue || '（空）' }}</div>
      </div>
    </div>

    <!-- 新增 / 编辑路径 -->
    <a-modal
      v-model:open="editOpen"
      :title="editForm.mode === 'add' ? '新增 PATH 路径' : '编辑 PATH 路径'"
      ok-text="确认"
      cancel-text="取消"
      @ok="submitEdit"
    >
      <p class="text-muted" style="margin: 0 0 6px">
        支持 %VARNAME% 引用其它变量，例如 %LOCALAPPDATA%\Programs
      </p>
      <a-input v-model:value="editForm.path" class="mono" placeholder="C:\your\tool\bin" />
      <div class="toolbar" style="margin-top: 10px">
        <a-button size="small" @click="pickFolder">
          <template #icon><FolderOpenOutlined /></template>
          浏览文件夹
        </a-button>
        <a-button size="small" @click="previewExpand">解析预览</a-button>
        <span v-if="editForm.expanded" class="text-muted mono">{{ editForm.expanded }}</span>
      </div>
    </a-modal>

    <!-- 去重预览 -->
    <a-modal v-model:open="dedupOpen" title="一键去重预览" ok-text="清理重复项" cancel-text="取消" @ok="doDedup">
      <div v-if="dupList.length" class="hint-box warn" style="margin-bottom: 10px">
        <WarningOutlined />
        <div>以下 {{ dupList.length }} 条为重复路径，将保留首次出现的条目，删除后面的重复项。</div>
      </div>
      <div v-else class="hint-box">
        <InfoCircleOutlined />
        <div>当前 PATH 中没有重复条目。</div>
      </div>
      <div v-for="d in dupList" :key="d.id" class="dup-item mono">{{ d.path }}</div>
    </a-modal>

    <!-- PATH 条目备注 -->
    <a-modal v-model:open="remarkOpen" title="PATH 条目备注" ok-text="保存" cancel-text="取消" @ok="submitRemark">
      <div class="hint-box" style="margin-bottom: 10px">
        <InfoCircleOutlined />
        <div>备注仅 WinEnv管家 内部保存，<b>不写入 Windows 注册表</b>，用于记录该路径的用途。</div>
      </div>
      <p class="text-muted mono" style="margin: 0 0 6px">{{ remarkPath }}</p>
      <a-textarea v-model:value="remarkText" :rows="3" placeholder="例如：JDK 17 的 bin 目录，java / javac 在这里" />
    </a-modal>

    <!-- PATH 校验器 -->
    <a-modal v-model:open="checkOpen" title="PATH 校验器" :footer="null" width="680px">
      <p class="text-muted" style="margin-top:0">
        检查 <span class="mono">{{ checkPath }}</span> 目录下的可执行文件是否能被系统找到（按 PATHEXT 后缀匹配）。
      </p>
      <a-button type="primary" size="small" :loading="checkLoading" @click="runExecCheck">开始检测</a-button>
      <a-table
        v-if="checkResult.length" style="margin-top: 12px" size="small" row-key="file"
        :data-source="checkResult" :pagination="{ pageSize: 8 }"
        :columns="[{ title: '可执行文件', key: 'file', ellipsis: true }, { title: '大小', key: 'size', width: 100 }]"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'file'"><span class="cell-path">{{ record.file }}</span></template>
          <template v-else>{{ formatBytes(record.size) }}</template>
        </template>
      </a-table>
      <div v-if="checkDone && !checkResult.length" class="empty-block">该目录下没有可执行文件（按 PATHEXT 后缀匹配）</div>
    </a-modal>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { Modal, message } from 'ant-design-vue'
import {
  NodeIndexOutlined, PlusOutlined, SafetyOutlined, ClearOutlined, MoreOutlined,
  ArrowUpOutlined, ArrowDownOutlined, DeleteOutlined, DownOutlined, FileTextOutlined,
  SaveOutlined, WarningOutlined, InfoCircleOutlined, FolderOpenOutlined
} from '@ant-design/icons-vue'
import { useEnvStore } from '@/store/env'
import { useUiStore } from '@/store/ui'
import WemTable from '@/components/wem-table/WemTable.vue'
import api from '@/api'
import { buildScript, formatBytes } from '@/lib/helpers'

const env = useEnvStore()
const ui = useUiStore()

const scope = ref('user')
const pathTable = ref(null)
const selectedRowKeys = ref([])
const pathCaps = {
  inline: false,
  sort: false,
  expand: false,
  contextMenu: false,
  batchTag: false,
  batchEnable: false,
  summary: false
}
const pathBatch = [
  { key: 'up', label: '上移' },
  { key: 'down', label: '下移' }
]
const validating = ref(false)
const checks = reactive({}) // path -> { checked, exists }

const editOpen = ref(false)
const editForm = reactive({ mode: 'add', path: '', index: -1, expanded: '' })
const dedupOpen = ref(false)
const dupList = ref([])

/* v2：备注 / 来源分组 / 排序 / 脚本导出 / 校验器 / PATHEXT */
const remarkOpen = ref(false)
const remarkPath = ref('')
const remarkText = ref('')
const checkOpen = ref(false)
const checkPath = ref('')
const checkLoading = ref(false)
const checkDone = ref(false)
const checkResult = ref([])
const pathextOpen = ref(false)

const SOURCE_TAGS = [
  { test: /jdk|java/i, name: 'JDK', color: 'orange' },
  { test: /node|npm|nvm/i, name: 'Node', color: 'green' },
  { test: /python|conda/i, name: 'Python', color: 'blue' },
  { test: /git/i, name: 'Git', color: 'red' },
  { test: /go(\\|\/|$)/i, name: 'Go', color: 'cyan' },
  { test: /rust|cargo/i, name: 'Rust', color: 'volcano' },
  { test: /maven|gradle/i, name: '构建工具', color: 'purple' },
  { test: /docker|kubernetes|kubectl/i, name: '容器', color: 'geekblue' }
]

function sourceTag(p) {
  const hit = SOURCE_TAGS.find((t) => t.test.test(String(p)))
  return hit ? hit.name : ''
}

function sourceColor(p) {
  const hit = SOURCE_TAGS.find((t) => t.test.test(String(p)))
  return hit ? hit.color : 'default'
}

function pathRemark(record) {
  const m = env.meta.path[`${scope.value}::${String(record.path).toLowerCase()}`]
  return m ? m.remark || '' : ''
}

function openRemark(record) {
  remarkPath.value = record.path
  const m = env.meta.path[`${scope.value}::${String(record.path).toLowerCase()}`]
  remarkText.value = m ? m.remark || '' : ''
  remarkOpen.value = true
}

async function submitRemark() {
  const res = await api.meta.pathSet({ scope: scope.value, path: remarkPath.value, patch: { remark: remarkText.value } })
  if (res.ok) {
    env.meta.path[`${scope.value}::${remarkPath.value.toLowerCase()}`] = { remark: remarkText.value }
    remarkOpen.value = false
    message.success('备注已保存（仅本工具内部）')
  } else {
    message.error(res.message)
  }
}

function sortPaths(dir) {
  const list = [...items.value].sort((a, b) =>
    dir === 'asc' ? a.path.localeCompare(b.path) : b.path.localeCompare(a.path)
  )
  commit(list)
  message.success(`已按字母${dir === 'asc' ? '升' : '降'}序排序（尚未写入系统）`)
}

async function exportScript(shell) {
  const paths = items.value.filter((i) => !i.disabled).map((i) => i.path).filter(Boolean)
  if (!paths.length) return message.info('当前没有可导出的启用路径')
  // 必须合成一条 PATH。逐条 set PATH= 时后一条会覆盖前一条，脚本无法还原整份路径。
  const vars = [{ name: 'PATH', value: paths.join(';'), action: 'create' }]
  const script = buildScript(vars, shell === 'cmd' ? 'cmd' : 'ps')
  const saved = await api.fs.saveFile({
    title: '导出 PATH 脚本',
    defaultPath: `path-${scope.value}.${shell === 'cmd' ? 'bat' : 'ps1'}`,
    filters: [{ name: shell === 'cmd' ? '批处理' : 'PowerShell', extensions: [shell === 'cmd' ? 'bat' : 'ps1'] }]
  })
  if (!saved.ok || saved.data.canceled) return
  const w = await api.fs.writeTextFile({ file: saved.data.path, content: script })
  if (w.ok) {
    message.success('脚本已导出')
    ui.tip(`PATH 脚本已导出：${saved.data.path}`, 'success')
  }
}

async function checkExecutables(record) {
  checkPath.value = record.path
  checkResult.value = []
  checkDone.value = false
  checkOpen.value = true
}

async function runExecCheck() {
  checkLoading.value = true
  try {
    const exp = await api.env.expandString(checkPath.value)
    const dir = exp.ok ? exp.data : checkPath.value
    const exts = String(env.original.machine.PATHEXT || '.COM;.EXE;.BAT;.CMD')
      .split(';').map((s) => s.trim().toLowerCase()).filter(Boolean)
    const res = await api.tool.listExecutables({ dir, exts })
    if (res.ok) {
      checkResult.value = res.data
      checkDone.value = true
    } else {
      message.error(res.message)
    }
  } finally {
    checkLoading.value = false
  }
}

const presets = [
  'C:\\bin',
  '%LOCALAPPDATA%\\Programs',
  '%USERPROFILE%\\scoop\\shims',
  '%USERPROFILE%\\go\\bin',
  'C:\\tools\\nodejs',
  'C:\\tools\\Python315',
  'C:\\tools\\Python315\\Scripts',
  'C:\\tools\\rtk-x86_64-pc-windows-msvc'
]

const items = computed(() =>
  env.pathItems[scope.value].map((i) => {
    const checked = checks[i.path] || {}
    const invalid = checks[i.path] ? !checks[i.path].exists : false
    const statusText = i.disabled ? '未生效' : invalid ? '无效' : checked.checked ? '有效' : '未校验'
    return { ...i, ...checked, invalid, size: String(i.path || '').length, statusText }
  })
)

const selected = computed(() => items.value.filter((i) => selectedRowKeys.value.includes(i.id)))
const invalidCount = computed(() => items.value.filter((i) => i.invalid).length)
const mergedValue = computed(() =>
  items.value.filter((i) => !i.disabled).map((i) => i.path).join(';')
)
const valueLength = computed(() => mergedValue.value.length)

const columns = [
  { title: '#', key: 'index', dataIndex: 'index', width: 56, sortable: false, filterable: false },
  { title: '路径', key: 'path', dataIndex: 'path', ellipsis: true, sortable: false },
  { title: '长度', key: 'size', dataIndex: 'size', width: 72, type: 'number', sortable: false, filterable: false },
  { title: '状态', key: 'status', dataIndex: 'statusText', width: 100, sortable: false },
  { title: '操作', key: 'actions', dataIndex: 'actions', width: 280, fixed: 'right', sortable: false, filterable: false }
]

function pathIndex(row) {
  return items.value.findIndex((item) => item.id === row.id) + 1
}

function onPathRows(list) {
  commit(list)
  selectedRowKeys.value = []
  pathTable.value?.clearSelection()
  message.success('已按拖拽调整顺序（尚未写入系统）')
}

function onPathBatch(payload) {
  const rows = payload?.rows || []
  selectedRowKeys.value = rows.map((row) => row.id)
  if (payload?.action === 'delete') batchDelete()
  else if (payload?.action === 'up') batchMove(-1)
  else if (payload?.action === 'down') batchMove(1)
}

function rowClass(record) {
  return record.disabled ? 'row-disabled' : ''
}

/* ------------------------------ 基础操作 ------------------------------ */

function commit(list) {
  env.setPathItems(scope.value, list)
}

function move(index, delta) {
  const list = items.value.map((i) => ({ ...i }))
  const target = index + delta
  if (target < 0 || target >= list.length) return
  ;[list[index], list[target]] = [list[target], list[index]]
  commit(list)
  selectedRowKeys.value = []
  pathTable.value?.clearSelection()
}

function batchMove(delta) {
  const selIds = new Set(selectedRowKeys.value)
  const list = items.value.map((i) => ({ ...i }))
  const idxs = list.map((i, idx) => (selIds.has(i.id) ? idx : -1)).filter((i) => i >= 0)
  if (!idxs.length) return
  const ordered = delta < 0 ? idxs : [...idxs].reverse()
  for (const i of ordered) {
    const t = i + delta
    if (t < 0 || t >= list.length) continue
    ;[list[i], list[t]] = [list[t], list[i]]
  }
  commit(list)
  selectedRowKeys.value = []
  pathTable.value?.clearSelection()
  message.success('已调整顺序（尚未写入系统）')
}

function toggleDisabled(record) {
  if (record.scope === 'machine' && !env.admin) {
    return message.warning('普通权限无法修改系统 PATH，请先以管理员身份重启')
  }
  const list = items.value.map((i) => (i.id === record.id ? { ...i, disabled: !i.disabled } : { ...i }))
  commit(list)
  message.success(record.disabled ? '已启用该路径' : '已禁用该路径（写入时会被剔除）')
}

function batchDelete() {
  const sel = selected.value
  if (!sel.length) return
  Modal.confirm({
    title: `确认删除 ${sel.length} 条 PATH 路径？`,
    content: '删除后点击「保存 PATH 到系统」才会真正生效。',
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: () => {
      const ids = new Set(sel.map((s) => s.id))
      commit(items.value.filter((i) => !ids.has(i.id)))
      selectedRowKeys.value = []
      pathTable.value?.clearSelection()
      message.success('已删除，记得保存')
    }
  })
}

function rowAction(key, record) {
  if (key === 'copy') copyText(record.path, '路径')
  else if (key === 'copyFull') copyText(mergedValue.value, '完整 PATH')
  else if (key === 'check') validateOne(record)
  else if (key === 'delete') {
    Modal.confirm({
      title: '确认删除该路径？',
      content: record.path,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        commit(items.value.filter((i) => i.id !== record.id))
        message.success('已删除，记得保存')
      }
    })
  }
}

/* ------------------------------ 新增 / 编辑 ------------------------------ */

function openAdd() {
  editForm.mode = 'add'
  editForm.path = ''
  editForm.index = -1
  editForm.expanded = ''
  editOpen.value = true
}

function openEdit(record) {
  editForm.mode = 'edit'
  editForm.path = record.path
  editForm.index = record.id
  editForm.expanded = ''
  editOpen.value = true
}

async function pickFolder() {
  const res = await api.fs.selectFolder({ title: '选择要加入 PATH 的文件夹' })
  if (res.ok && !res.data.canceled) editForm.path = res.data.path
}

async function previewExpand() {
  if (!editForm.path) return
  const res = await api.env.expandString(editForm.path)
  if (res.ok) editForm.expanded = `→ ${res.data}`
}

function submitEdit() {
  const p = editForm.path.trim()
  if (!p) return message.error('路径不能为空')
  const list = items.value.map((i) => ({ ...i }))
  if (editForm.mode === 'add') {
    list.push({ id: `${scope.value}-n-${Date.now()}`, path: p, scope: scope.value, disabled: false })
  } else {
    const idx = list.findIndex((i) => i.id === editForm.index)
    if (idx >= 0) list[idx].path = p
  }
  commit(list)
  editOpen.value = false
  message.success('已更新 PATH 列表，记得保存到系统')
}

function addPreset(p) {
  if (scope.value === 'machine' && !env.admin) {
    return message.warning('普通权限无法修改系统 PATH，请先以管理员身份重启')
  }
  const added = env.appendPaths(scope.value, [p])
  if (added.length) {
    message.success(`已添加 ${added[0]}`)
    ui.tip(`已向 PATH 追加 ${added[0]}`, 'warning')
  } else {
    message.info('该路径已存在，已自动跳过')
  }
}

/* ------------------------------ 校验 ------------------------------ */

async function validateAll() {
  const list = items.value.filter((i) => !i.disabled).map((i) => i.path)
  if (!list.length) return message.info('没有需要校验的路径')
  validating.value = true
  try {
    const res = await api.env.validatePath(list)
    if (!res.ok) throw new Error(res.message)
    for (const r of res.data.result) checks[r.path] = { checked: true, exists: r.exists }
    const n = res.data.invalid.length
    if (n) {
      message.warning(`校验完成，发现 ${n} 条无效路径（已在列表中标红）`)
      ui.tip(`发现 ${n} 条无效 PATH 条目`, 'warning')
    } else {
      message.success('全部路径有效')
      ui.tip('全部 PATH 条目均有效', 'success')
    }
  } catch (err) {
    message.error(err.message)
  } finally {
    validating.value = false
  }
}

async function validateOne(record) {
  const res = await api.env.validatePath([record.path])
  if (res.ok) {
    const r = res.data.result[0]
    checks[record.path] = { checked: true, exists: r.exists }
    message[r.exists ? 'success' : 'warning'](r.exists ? `目录有效：${r.expanded}` : `目录不存在：${r.expanded}`)
  }
}

function cleanInvalid() {
  const bad = items.value.filter((i) => i.invalid)
  if (!bad.length) return
  Modal.confirm({
    title: `确认清理 ${bad.length} 条无效路径？`,
    content: '被清理的条目将从 PATH 中移除，保存到系统后生效。',
    okText: '一键清理',
    okType: 'danger',
    cancelText: '取消',
    onOk: () => {
      const ids = new Set(bad.map((b) => b.id))
      commit(items.value.filter((i) => !ids.has(i.id)))
      message.success(`已清理 ${bad.length} 条无效路径，记得保存`)
    }
  })
}

/* ------------------------------ 去重 / 导入导出 ------------------------------ */

function onMore(key) {
  if (key === 'dedup') {
    dupList.value = env.findDuplicatePaths(scope.value)
    dedupOpen.value = true
  } else if (key === 'import') importList()
  else if (key === 'exportTxt') exportList('txt')
  else if (key === 'exportJson') exportList('json')
  else if (key === 'sortAsc') sortPaths('asc')
  else if (key === 'sortDesc') sortPaths('desc')
  else if (key === 'scriptCmd') exportScript('cmd')
  else if (key === 'scriptPs') exportScript('ps')
  else if (key === 'openPathDir') api.tool.openRegEnv(scope.value)
}

function doDedup() {
  if (!dupList.value.length) {
    dedupOpen.value = false
    return
  }
  env.removePathDuplicates(scope.value, dupList.value.map((d) => d.id))
  dedupOpen.value = false
  message.success(`已移除 ${dupList.value.length} 条重复路径，记得保存`)
}

async function importList() {
  const picked = await api.fs.selectFile({ title: '选择路径清单文件', filters: [{ name: '文本文件', extensions: ['txt', 'json'] }] })
  if (!picked.ok || picked.data.canceled) return
  const read = await api.fs.readTextFile(picked.data.path)
  if (!read.ok) return message.error(read.message)
  const lines = String(read.data)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
  const added = env.appendPaths(scope.value, lines)
  message.success(`已导入 ${added.length} 条新路径（去重后）`)
  if (!added.length) message.info('没有新增路径，全部已存在')
}

async function exportList(format) {
  const list = items.value.filter((i) => !i.disabled).map((i) => i.path)
  if (!list.length) return message.info('当前没有可导出的路径')
  const saved = await api.fs.saveFile({
    title: '导出 PATH 列表',
    defaultPath: `PathList-${scope.value}.${format}`,
    filters: [{ name: format === 'json' ? 'JSON 文件' : '文本文件', extensions: [format] }]
  })
  if (!saved.ok || saved.data.canceled) return
  const content =
    format === 'json' ? JSON.stringify({ scope: scope.value, paths: list }, null, 2) : list.join('\r\n')
  const res = await api.fs.writeTextFile({ file: saved.data.path, content, bom: format === 'txt' })
  if (res.ok) {
    message.success('导出成功')
    ui.tip(`PATH 列表已导出：${saved.data.path}`, 'success')
  } else {
    message.error(res.message)
  }
}

/* ------------------------------ 打开 / 复制 / 保存 ------------------------------ */

async function openDir(record) {
  const res = await api.env.expandString(record.path)
  const target = res.ok ? res.data : record.path
  const open = await api.tool.openFolder(target)
  if (!open.ok) {
    message.error(`无法打开目录：${open.message}`)
  }
}

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text)
    message.success(`已复制${label}`)
  } catch (_) {
    message.warning('复制失败，请手动选择复制')
  }
}

function copyValue() {
  copyText(mergedValue.value, '完整 PATH')
}

async function savePath() {
  if (scope.value === 'machine' && !env.admin) {
    return Modal.confirm({
      title: '普通权限无法写入系统 PATH',
      content: '要不要以管理员身份重新启动程序？',
      okText: '提权重启',
      cancelText: '取消',
      onOk: async () => api.tool.elevate()
    })
  }
  const res = await api.env.savePathItems({ scope: scope.value, items: items.value.filter((i) => !i.disabled) })
  if (res.ok) {
    message.success(`已写入 ${scope.value === 'machine' ? '系统' : '用户'} PATH（${res.data.length} 字符）`)
    ui.tip('PATH 已写入系统，新开命令行窗口即可生效', 'success')
    await env.load()
  } else {
    Modal.error({ title: '写入 PATH 失败', content: res.message })
  }
}

watch(scope, () => {
  selectedRowKeys.value = []
})
</script>

<style scoped>
.disabled {
  color: var(--wem-text-3);
  pointer-events: none;
}

.row-disabled td {
  opacity: 0.65;
}

.path-preview {
  background: var(--wem-card-alt);
  border: 1px solid var(--wem-border);
  border-radius: 8px;
  padding: 10px 12px;
  max-height: 150px;
  overflow: auto;
  word-break: break-all;
  line-height: 1.8;
  color: var(--wem-text-2);
}

.dup-item {
  padding: 5px 9px;
  border-radius: 6px;
  background: var(--wem-mark-modified);
  margin-bottom: 5px;
  font-size: 12px;
  word-break: break-all;
}

.path-remark {
  font-size: 11px;
  color: var(--wem-text-3);
  margin-top: 2px;
  line-height: 1.4;
}
</style>
