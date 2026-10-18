<template>
  <div>
    <div class="hint-box" style="margin-bottom: 14px">
      <InfoCircleOutlined />
      <div>
        项目变量只注入本次启动的终端，不写入用户或系统注册表，也不影响已经打开的窗口。
        <template v-if="demo">当前没有项目接口，列表只保存在本地演示数据（localStorage / wem-projects）。</template>
        <template v-else>读取和保存走 envAPI.project，启动终端走 envAPI.project.launch，仍然不会改注册表。</template>
        检测不到文件夹时不标警告，避免把未知当成不存在。
      </div>
    </div>

    <div class="split-2">
      <div class="wem-card">
        <div class="wem-card-head">
          <div class="wem-card-title"><FolderOpenOutlined /> 项目</div>
          <div class="toolbar">
            <a-button type="primary" size="small" @click="openCreate">
              <template #icon><PlusOutlined /></template>
              新建
            </a-button>
            <a-button size="small" danger :disabled="!current" @click="removeCurrent">
              <template #icon><DeleteOutlined /></template>
              删除
            </a-button>
          </div>
        </div>
        <div class="wem-card-body tight">
          <WemTable
            table-id="project-list"
            row-key="id"
            :loading="loading"
            :rows="projectRows"
            :columns="projectColumns"
            :page-size="8"
            :capabilities="projectCaps"
            :row-class="rowClass"
            empty-text="还没有项目。点「新建」添加，名称必填。"
            empty-action-label="新建项目"
            @empty-action="openCreate"
            @row-click="(row) => (selectedId = row.id)"
          >
            <template #cell="{ row, column }">
              <template v-if="column.key === 'name'">
                <a class="cell-name" @click.stop="openEdit(row)">{{ row.name }}</a>
              </template>
              <template v-else-if="column.key === 'folder'">
                <div class="cell-path" :title="row.folder">{{ row.folder || '—' }}</div>
                <a-tag v-if="!row.folder" color="orange">未设置文件夹</a-tag>
                <a-tag v-else-if="row.folderExists === false" color="orange">文件夹不存在</a-tag>
              </template>
              <template v-else-if="column.key === 'terminal'">{{ row.terminalLabel }}</template>
              <template v-else-if="column.key === 'count'">{{ row.count }}</template>
              <template v-else-if="column.key === 'remark'">
                <span class="text-muted">{{ row.remark || '—' }}</span>
              </template>
            </template>
          </WemTable>
        </div>
      </div>

      <div class="wem-card">
        <div class="wem-card-head">
          <div class="wem-card-title"><CodeOutlined /> {{ current ? current.name : '项目变量' }}</div>
          <div class="toolbar" v-if="current">
            <a-button size="small" @click="openEdit(current)">编辑资料</a-button>
            <a-button size="small" @click="addVar">添加变量</a-button>
            <a-button size="small" type="primary" @click="persist(false)">保存项目</a-button>
          </div>
        </div>
        <div class="wem-card-body">
          <div v-if="!current" class="empty-block">先在左侧点选一个项目</div>
          <template v-else>
            <div class="proj-fields">
              <div class="proj-field">
                <span class="text-muted">终端类型</span>
                <a-select v-model:value="current.terminal" size="small" style="width: 180px" :options="termOptions" />
              </div>
              <div class="proj-field">
                <span class="text-muted">继承全局</span>
                <a-switch v-model:checked="current.inheritGlobal" />
                <span class="text-muted">开启后在当前用户环境上叠加；关闭后本次终端只用下面已启用的项目变量。都不写注册表。</span>
              </div>
              <div class="proj-field">
                <span class="text-muted">附带 .env</span>
                <a-switch v-model:checked="current.autoDotenv" />
                <span class="text-muted">开启后，启动时先读项目文件夹里的 .env，再被下面已启用的变量覆盖。</span>
              </div>
              <div class="proj-field">
                <span class="text-muted">启动前预览</span>
                <a-switch :checked="previewBeforeLaunch" @change="setPreview" />
                <span class="text-muted">保存在 wem-project-settings.previewBeforeLaunch</span>
              </div>
            </div>

            <div class="text-muted" style="margin: 8px 0 6px">启动前脚本（只在本次终端里执行）</div>
            <a-textarea v-model:value="current.preScript" :rows="3" placeholder="例如 cd /d 项目目录后要跑的命令。留空则不执行。" />

            <a-table
              class="wem-table"
              style="margin-top: 12px"
              size="small"
              row-key="id"
              :data-source="current.vars"
              :columns="varColumns"
              :pagination="false"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'name'">
                  <a-input v-model:value="record.name" size="small" class="mono" placeholder="变量名" />
                </template>
                <template v-else-if="column.key === 'value'">
                  <a-input v-model:value="record.value" size="small" class="mono" placeholder="值" />
                </template>
                <template v-else-if="column.key === 'enabled'">
                  <a-switch v-model:checked="record.enabled" />
                </template>
                <template v-else-if="column.key === 'op'">
                  <a @click="removeVar(record)">删除</a>
                </template>
              </template>
            </a-table>

            <div class="toolbar" style="margin-top: 12px">
              <a-button type="primary" @click="askLaunch">
                <template #icon><PlayCircleOutlined /></template>
                启动终端
              </a-button>
              <span class="text-muted">只把已启用变量注入这次终端。</span>
            </div>
          </template>
        </div>
      </div>
    </div>

    <a-modal
      v-model:open="editOpen"
      :title="editForm.id ? '编辑项目' : '新建项目'"
      ok-text="保存"
      cancel-text="取消"
      :keyboard="false"
      @ok="submitForm"
    >
      <a-form layout="vertical" style="margin-top: 4px">
        <a-form-item label="名称" required>
          <a-input v-model:value="editForm.name" placeholder="例如 web-demo" />
        </a-form-item>
        <a-form-item label="文件夹">
          <div class="toolbar">
            <a-input v-model:value="editForm.folder" class="mono" style="flex: 1" placeholder="手填路径，例如 D:\project\web-demo" />
            <a-button @click="pickFolder">选择文件夹</a-button>
          </div>
          <div class="text-muted" style="margin-top: 6px">有 envAPI.dialog.pickDir 时用系统目录框，否则请在输入框填写。</div>
        </a-form-item>
        <a-form-item label="终端类型">
          <a-select v-model:value="editForm.terminal" :options="termOptions" />
        </a-form-item>
        <a-form-item label="备注">
          <a-input v-model:value="editForm.remark" />
        </a-form-item>
      </a-form>
    </a-modal>

    <a-modal
      v-model:open="previewOpen"
      title="启动前确认"
      ok-text="确认启动"
      cancel-text="取消"
      :keyboard="false"
      @ok="doLaunch"
    >
      <div class="hint-box" style="margin-bottom: 12px">
        <InfoCircleOutlined />
        <div>
          下列变量只注入「{{ current ? current.name : '' }}」这一次终端，不会写入注册表。
          {{ current && current.inheritGlobal ? '同时继承当前用户环境。' : '不继承当前用户环境，终端里只有这些项目变量。' }}
        </div>
      </div>
      <div v-if="current && current.folderExists === false" class="hint-box warn" style="margin-bottom: 12px">
        文件夹当前检测为不存在，终端可能无法停留在该目录。
      </div>
      <div v-if="current && current.preScript" class="text-muted" style="margin-bottom: 8px">启动前脚本：</div>
      <pre v-if="current && current.preScript" class="mono proj-script">{{ current.preScript }}</pre>
      <a-table
        class="wem-table"
        size="small"
        row-key="name"
        :data-source="previewVars"
        :columns="previewColumns"
        :pagination="false"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'name'"><span class="mono">{{ record.name }}</span></template>
          <template v-else-if="column.key === 'value'"><span class="cell-value">{{ record.value }}</span></template>
        </template>
      </a-table>
      <div v-if="!previewVars.length" class="empty-block">没有可注入的项目变量。</div>
    </a-modal>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import WemTable from '@/components/wem-table/WemTable.vue'
import { Modal, message } from 'ant-design-vue'
import {
  InfoCircleOutlined, FolderOpenOutlined, PlusOutlined, DeleteOutlined,
  CodeOutlined, PlayCircleOutlined
} from '@ant-design/icons-vue'

const LS_PROJECTS = 'wem-projects'
const LS_SETTINGS = 'wem-project-settings'

const termOptions = [
  { value: 'cmd', label: '命令提示符' },
  { value: 'powershell', label: 'PowerShell' },
  { value: 'pwsh', label: 'PowerShell 7' },
  { value: 'wt', label: 'Windows 终端' }
]

const projectCaps = {
  select: false,
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
const projectColumns = [
  { title: '名称', key: 'name', dataIndex: 'name', width: 140, ellipsis: true },
  { title: '文件夹', key: 'folder', dataIndex: 'folder', ellipsis: true },
  { title: '终端', key: 'terminal', dataIndex: 'terminalLabel', width: 120 },
  { title: '变量数', key: 'count', dataIndex: 'count', width: 90 },
  { title: '备注', key: 'remark', dataIndex: 'remark', width: 120, ellipsis: true }
]
const projectRows = computed(() =>
  (projects.value || []).map((item) => ({
    ...item,
    terminalLabel: termLabel(item.terminal),
    count: (item.vars || []).length
  }))
)
const varColumns = [
  { title: '名称', key: 'name', width: 160 },
  { title: '值', key: 'value' },
  { title: '启用', key: 'enabled', width: 70 },
  { title: '', key: 'op', width: 56 }
]
const previewColumns = [
  { title: '名称', key: 'name', width: 180 },
  { title: '值', key: 'value' }
]

const projects = ref([])
const selectedId = ref('')
const loading = ref(false)
const demo = ref(false)
const editOpen = ref(false)
const previewOpen = ref(false)
const previewBeforeLaunch = ref(true)
const editForm = reactive(blankForm())

const current = computed(() => projects.value.find((p) => p.id === selectedId.value) || null)
const previewVars = computed(() => (current.value ? launchVars(current.value) : []))

function blankForm() {
  return { id: '', name: '', folder: '', terminal: 'cmd', remark: '' }
}

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function termLabel(v) {
  return (termOptions.find((t) => t.value === v) || termOptions[0]).label
}

function unwrap(res) {
  if (res && typeof res === 'object' && 'data' in res && ('ok' in res || 'message' in res)) return res.data
  return res
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw)
  } catch (_) {
    return fallback
  }
}

function defaultInheritGlobal() {
  return readJson(LS_SETTINGS, {}).inheritGlobal !== false
}

function normalizeVar(v, i) {
  const src = v && typeof v === 'object' ? v : {}
  return {
    id: src.id || `v-${i}-${Date.now()}`,
    name: src.name || src.key || '',
    value: src.value == null ? '' : String(src.value),
    enabled: src.enabled !== false
  }
}

function normalizeProject(p, i) {
  const src = p && typeof p === 'object' ? p : {}
  const vars = Array.isArray(src.vars) ? src.vars : (Array.isArray(src.variables) ? src.variables : [])
  return {
    id: src.id || `p-${i}-${Date.now()}`,
    name: src.name || '未命名项目',
    folder: src.folder || src.projectDir || '',
    terminal: termOptions.some((t) => t.value === src.terminal) ? src.terminal : 'cmd',
    remark: src.remark || src.comment || '',
    inheritGlobal: src.inheritGlobal !== false,
    autoDotenv: src.autoDotenv === true,
    preScript: src.preScript || src.script || '',
    vars: vars.map(normalizeVar),
    folderExists: null
  }
}

function toStored(list) {
  return list.map((p) => {
    const copy = { ...p }
    delete copy.folderExists
    return copy
  })
}

function loadSettings() {
  const s = readJson(LS_SETTINGS, {})
  previewBeforeLaunch.value = s.previewBeforeLaunch !== false
}

function setPreview(checked) {
  previewBeforeLaunch.value = !!checked
  const s = readJson(LS_SETTINGS, {})
  s.previewBeforeLaunch = !!checked
  localStorage.setItem(LS_SETTINGS, JSON.stringify(s))
}

function launchVars(p) {
  return (p.vars || [])
    .filter((v) => v.enabled && String(v.name || '').trim())
    .map((v) => ({ name: String(v.name).trim(), value: v.value == null ? '' : String(v.value) }))
}

async function markFolders() {
  const settings = readJson(LS_SETTINGS, {})
  if (settings.watchFolder === false) {
    projects.value.forEach((p) => { p.folderExists = null })
    return
  }
  const fn = window.envAPI && window.envAPI.env && window.envAPI.env.validatePath
  projects.value.forEach((p) => { p.folderExists = p.folder ? null : false })
  const paths = [...new Set(projects.value.map((p) => p.folder).filter(Boolean))]
  if (typeof fn !== 'function' || !paths.length) return
  try {
    const res = await fn(paths)
    if (res && res.ok === false) return
    const data = unwrap(res) || {}
    const rows = Array.isArray(data.result) ? data.result : []
    const map = new Map(rows.map((r) => [r.path, r]))
    projects.value.forEach((p) => {
      if (!p.folder) { p.folderExists = false; return }
      const row = map.get(p.folder)
      if (!row) { p.folderExists = null; return }
      if (row.type === 'network-skipped' || row.type === 'removable-skipped' || row.type === 'ignored') {
        p.folderExists = null
        return
      }
      p.folderExists = !!row.exists
    })
  } catch (_) { /* 检测失败时不把文件夹标成不存在 */ }
}

async function load() {
  loading.value = true
  loadSettings()
  const api = window.envAPI && window.envAPI.project
  const listFn = api && (api.list || api.all)
  demo.value = !(api && (typeof api.save === 'function' || typeof listFn === 'function'))
  try {
    if (typeof listFn === 'function') {
      const res = await listFn()
      if (res && res.ok === false) throw new Error(res.message || '读取项目失败')
      const data = unwrap(res)
      const arr = Array.isArray(data) ? data : (data && (data.projects || data.list)) || []
      projects.value = arr.map(normalizeProject)
    } else {
      const arr = readJson(LS_PROJECTS, [])
      projects.value = (Array.isArray(arr) ? arr : []).map(normalizeProject)
    }
    if (!projects.value.some((p) => p.id === selectedId.value)) selectedId.value = projects.value[0] ? projects.value[0].id : ''
    await markFolders()
  } catch (err) {
    message.error(err.message || '读取项目失败')
  } finally {
    loading.value = false
  }
}

async function persist(quiet) {
  const payload = toStored(projects.value)
  const fn = window.envAPI && window.envAPI.project && window.envAPI.project.save
  try {
    if (typeof fn === 'function') {
      const res = await fn(payload)
      if (res && res.ok === false) throw new Error(res.message || '保存失败')
      if (!quiet) message.success('项目已保存。变量只在启动终端时注入，没有写入注册表。')
    } else {
      localStorage.setItem(LS_PROJECTS, JSON.stringify(payload))
      if (!quiet) message.success('已写入本地演示数据（wem-projects），没有写入注册表。')
    }
    await markFolders()
    return true
  } catch (err) {
    message.error(err.message || '保存失败')
    return false
  }
}

function rowClass(record) {
  return record.id === selectedId.value ? 'row-selected' : ''
}

function openCreate() {
  Object.assign(editForm, blankForm(), { id: '' })
  editOpen.value = true
}

function openEdit(record) {
  selectedId.value = record.id
  Object.assign(editForm, {
    id: record.id,
    name: record.name,
    folder: record.folder,
    terminal: record.terminal,
    remark: record.remark
  })
  editOpen.value = true
}

async function pickFolder() {
  const fn = window.envAPI && window.envAPI.dialog && window.envAPI.dialog.pickDir
  if (typeof fn !== 'function') {
    message.info('当前没有文件夹选择器，请在输入框填写路径')
    return
  }
  try {
    const res = await fn()
    if (res && res.ok === false) throw new Error(res.message || '选择文件夹失败')
    const data = unwrap(res)
    if (!data || data.canceled || data.cancelled) return
    let dir = ''
    if (typeof data === 'string') dir = data
    else if (Array.isArray(data.filePaths)) dir = data.filePaths[0] || ''
    else dir = data.path || data.folder || data.dir || ''
    if (dir) editForm.folder = dir
  } catch (err) {
    message.error(err.message || '选择文件夹失败')
  }
}

async function submitForm() {
  const name = String(editForm.name || '').trim()
  if (!name) {
    message.warning('请填写项目名称')
    return Promise.reject(new Error('名称必填'))
  }
  if (editForm.id) {
    const hit = projects.value.find((p) => p.id === editForm.id)
    if (hit) {
      hit.name = name
      hit.folder = String(editForm.folder || '').trim()
      hit.terminal = editForm.terminal || 'cmd'
      hit.remark = editForm.remark || ''
      selectedId.value = hit.id
    }
  } else {
    const created = normalizeProject({
      id: uid('p'),
      name,
      folder: String(editForm.folder || '').trim(),
      terminal: editForm.terminal,
      remark: editForm.remark,
      inheritGlobal: defaultInheritGlobal(),
      autoDotenv: false,
      preScript: '',
      vars: []
    }, projects.value.length)
    projects.value.push(created)
    selectedId.value = created.id
  }
  const ok = await persist(false)
  if (!ok) return Promise.reject(new Error('保存失败'))
  editOpen.value = false
}

function removeCurrent() {
  const hit = current.value
  if (!hit) return
  Modal.confirm({
    title: '删除项目',
    content: `删除「${hit.name}」只移除项目清单，不会改注册表，也不会删除文件夹。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      projects.value = projects.value.filter((p) => p.id !== hit.id)
      selectedId.value = projects.value[0] ? projects.value[0].id : ''
      await persist(false)
    }
  })
}

function addVar() {
  if (!current.value) return
  current.value.vars.push({ id: uid('v'), name: '', value: '', enabled: true })
}

function removeVar(record) {
  if (!current.value) return
  current.value.vars = current.value.vars.filter((v) => v.id !== record.id)
}

async function askLaunch() {
  if (!current.value) return
  const saved = await persist(true)
  if (!saved) return
  loadSettings()
  if (previewBeforeLaunch.value) previewOpen.value = true
  else await doLaunch()
}

async function doLaunch() {
  const p = current.value
  if (!p) return
  const payload = {
    id: p.id,
    name: p.name,
    folder: p.folder,
    terminal: p.terminal,
    inheritGlobal: !!p.inheritGlobal,
    autoDotenv: p.autoDotenv === true,
    preScript: p.preScript || '',
    vars: launchVars(p)
  }
  previewOpen.value = false
  const fn = window.envAPI && window.envAPI.project && window.envAPI.project.launch
  if (typeof fn !== 'function') {
    message.info('演示模式，不真正打开终端')
    return
  }
  try {
    const res = await fn(payload)
    if (res && res.ok === false) throw new Error(res.message || '启动失败')
    const data = unwrap(res) || {}
    if (data.warning) message.warning(data.warning)
    message.success('已请求启动终端。变量只注入这次进程，没有写入注册表。')
  } catch (err) {
    message.error(err.message || '启动失败')
  }
}

onMounted(load)
</script>

<style scoped>
.proj-fields {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.proj-field {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.proj-script {
  margin: 0 0 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--wem-card-alt);
  border: 1px solid var(--wem-border);
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
