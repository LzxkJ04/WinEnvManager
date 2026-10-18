<template>
  <div>
    <div class="hint-box" style="margin-bottom: 14px">
      <AppstoreOutlined />
      <div>
        配置集用于保存多套完整环境变量配置并一键切换，适合区分开发 / 测试 / 项目独立环境。
        <b>加载后所有变量变更加入草稿区</b>，预览对比确认后统一【保存写入系统】。
      </div>
    </div>

    <div class="toolbar" style="margin-bottom: 12px">
      <a-button type="primary" size="small" @click="openCreate">
        <template #icon><PlusOutlined /></template>
        新建配置集
      </a-button>
      <a-button size="small" @click="openImport"><template #icon><ImportOutlined /></template>导入配置集</a-button>
      <a-button size="small" @click="envFileOpen = true"><template #icon><FileTextOutlined /></template>导入 .env</a-button>
      <a-button size="small" @click="openMutexManager"><template #icon><BlockOutlined /></template>互斥组管理（{{ setStore.mutex.length }}）</a-button>
      <a-button size="small" @click="setStore.load()"><template #icon><ReloadOutlined /></template>刷新</a-button>
    </div>

    <WemTable
      table-id="env-sets"
      row-key="id"
      :rows="setRows"
      :columns="setColumns"
      :capabilities="setCaps"
      :row-class="setRowClass"
      empty-text="还没有配置集"
    >
      <template #cell="{ row, column }">
        <template v-if="column.key === 'name'">
          <span class="cell-name">{{ row.name }}</span>
          <a-tag v-if="row.type === 'project'" color="cyan" style="margin-left:6px">项目</a-tag>
          <a-tag v-if="row.readOnly" color="gold" style="margin-left:6px">只读</a-tag>
          <a-tag v-if="isLoaded(row.id)" color="green" style="margin-left:6px">已加载</a-tag>
        </template>
        <template v-else-if="column.key === 'type'">
          <a-tag :color="row.type === 'project' ? 'cyan' : 'blue'">{{ row.type === 'project' ? '项目配置集' : '全局配置集' }}</a-tag>
        </template>
        <template v-else-if="column.key === 'mutex'">
          <a-tag v-if="row.mutexId" color="orange">{{ mutexName(row.mutexId) }}</a-tag>
          <span v-else class="text-muted">—</span>
        </template>
        <template v-else-if="column.key === 'vars'">
          <span class="mono">{{ (row.variables || []).length }} 个变量</span>
          <span v-if="row.projectDir" class="text-muted"> · {{ row.projectDir }}</span>
        </template>
        <template v-else-if="column.key === 'actions'">
          <a-space size="small">
            <a @click.stop="loadOne(row)">加载</a>
            <a v-if="isLoaded(row.id)" @click.stop="unloadOne(row)">卸载草稿</a>
            <a @click.stop="editSet(row)">编辑</a>
            <a-dropdown>
              <a @click.stop>更多 <DownOutlined /></a>
              <template #overlay>
                <a-menu @click="({ key }) => setAction(key, row)">
                  <a-menu-item key="copy">复制配置集</a-menu-item>
                  <a-menu-item key="export">导出 JSON</a-menu-item>
                  <a-menu-item key="exportShare">导出精简版（脱敏）</a-menu-item>
                  <a-menu-item key="diff">与其他配置集对比</a-menu-item>
                  <a-menu-item key="terminal">启动临时终端</a-menu-item>
                  <a-menu-item key="readonly">{{ row.readOnly ? '解除只读锁定' : '设为只读基线' }}</a-menu-item>
                  <a-menu-item key="delete" danger>删除</a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
          </a-space>
        </template>
      </template>
    </WemTable>

    <MutexManager ref="mutexMgr" :sets="mutexSets" style="margin-top: 14px" @change="onMutexChange" @activate="onMutexActivate" />

    <EnvFileWizard v-model:open="envFileOpen" :sets="setStore.sets" @imported="onEnvImported" />

    <!-- 新建 / 编辑配置集 -->
    <a-modal
      v-model:open="editOpen" :title="editForm.id ? '编辑配置集' : '新建配置集'" width="760px"
      ok-text="保存" cancel-text="取消" @ok="submitSet"
    >
      <a-form layout="vertical" style="margin-top: 4px">
        <a-row :gutter="12">
          <a-col :span="12">
            <a-form-item label="配置集名称" required>
              <a-input v-model:value="editForm.name" size="small" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="类型">
              <a-radio-group v-model:value="editForm.type" size="small" button-style="solid">
                <a-radio-button value="global">全局配置集</a-radio-button>
                <a-radio-button value="project">项目独立环境</a-radio-button>
              </a-radio-group>
            </a-form-item>
          </a-col>
        </a-row>
        <a-row :gutter="12">
          <a-col :span="12">
            <a-form-item label="分组">
              <a-input v-model:value="editForm.group" size="small" placeholder="例如 Java / 前端 / 测试" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="互斥组">
              <a-select v-model:value="editForm.mutexId" size="small" allow-clear placeholder="不加入互斥组">
                <a-select-option v-for="g in setStore.mutex" :key="g.id" :value="g.id">{{ g.name }}</a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
        </a-row>
        <a-form-item label="备注">
          <a-input v-model:value="editForm.comment" size="small" />
        </a-form-item>

        <template v-if="editForm.type === 'project'">
          <a-form-item label="绑定项目目录">
            <div class="toolbar">
              <a-input v-model:value="editForm.projectDir" size="small" class="mono" style="flex:1" />
              <a-button size="small" @click="pickProjectDir">浏览</a-button>
            </div>
          </a-form-item>
          <a-form-item>
            <a-checkbox v-model:checked="editForm.folderWatch">开启文件夹监听（资源管理器进入该目录时提醒加载本套环境）</a-checkbox>
          </a-form-item>
        </template>
      </a-form>

      <!-- 变量编辑器 -->
      <div class="section-title">变量列表（{{ editForm.variables.length }}）</div>
      <div class="toolbar" style="margin-bottom: 8px">
        <a-button size="small" @click="addVar"><template #icon><PlusOutlined /></template>新增变量</a-button>
        <a-select v-model:value="tplPick" size="small" style="width: 200px" placeholder="从模板库导入" @change="importTemplate">
          <a-select-option v-for="t in setStore.templates" :key="t.id" :value="t.id">{{ t.name }}（{{ t.desc }}）</a-select-option>
        </a-select>
      </div>
      <div class="var-edit-list">
        <div v-for="(v, i) in editForm.variables" :key="i" class="var-edit-row">
          <a-select v-model:value="v.scope" size="small" style="width: 86px">
            <a-select-option value="user">用户</a-select-option>
            <a-select-option value="system">系统</a-select-option>
          </a-select>
          <a-input v-model:value="v.key" size="small" class="mono" placeholder="变量名" style="width: 180px" />
          <a-input v-model:value="v.value" size="small" class="mono" placeholder="变量值" style="flex:1" />
          <a-input v-model:value="v.remark" size="small" placeholder="备注" style="width: 140px" />
          <a class="danger-link" @click="editForm.variables.splice(i, 1)"><DeleteOutlined /></a>
        </div>
        <div v-if="!editForm.variables.length" class="empty-block">还没有变量，新增或从模板导入</div>
      </div>
    </a-modal>

    <!-- 互斥组管理 -->
    <a-modal v-model:open="mutexOpen" title="互斥组管理" width="820px" :footer="null">
      <div class="toolbar" style="margin-bottom: 10px">
        <a-button type="primary" size="small" @click="createMutex"><template #icon><PlusOutlined /></template>新建互斥组</a-button>
        <span class="text-muted">同一互斥组内最多只能有 1 套配置集处于「已加载（草稿待提交）」状态</span>
      </div>

      <div v-for="g in setStore.mutex" :key="g.id" class="mutex-card">
        <div class="mutex-head">
          <div>
            <b>{{ g.name }}</b>
            <a-tag v-if="g.autoClean" color="green" style="margin-left:6px">自动清理旧草稿</a-tag>
            <a-tag v-if="g.forceBlock" color="red" style="margin-left:6px">强制阻断</a-tag>
            <a-tag v-if="g.snapshotBefore" color="blue" style="margin-left:6px">切换前置快照</a-tag>
            <div class="text-muted" style="font-size:11.5px;margin-top:2px">{{ g.comment || '—' }}</div>
          </div>
          <div class="toolbar">
            <a-button size="small" @click="editMutex(g)">设置</a-button>
            <a-button size="small" danger @click="removeMutex(g)">删除互斥组</a-button>
          </div>
        </div>
        <div class="mutex-body">
          <div class="mutex-col">
            <div class="mutex-title">可选配置集</div>
            <div v-for="s in availableFor(g)" :key="s.id" class="mutex-item" @click="addToMutex(g, s)">
              <PlusOutlined /> {{ s.name }}
            </div>
            <div v-if="!availableFor(g).length" class="empty-block" style="padding:8px">全部配置集已加入互斥组</div>
          </div>
          <div class="mutex-col">
            <div class="mutex-title">组内成员（{{ membersOf(g).length }}）</div>
            <div v-for="s in membersOf(g)" :key="s.id" class="mutex-item member" @click="removeFromMutex(g, s)">
              <CloseOutlined /> {{ s.name }}
              <a-tag v-if="isLoaded(s.id)" color="green" style="margin-left:auto">已加载</a-tag>
            </div>
            <div v-if="!membersOf(g).length" class="empty-block" style="padding:8px">暂无成员，点击左侧添加</div>
          </div>
        </div>
      </div>
      <div v-if="!setStore.mutex.length" class="empty-block">还没有互斥组，点击「新建互斥组」创建</div>
    </a-modal>

    <!-- 配置集对比 -->
    <a-modal v-model:open="diffOpen" title="配置集差异对比" :footer="null" width="760px">
      <div class="toolbar" style="margin-bottom: 10px">
        <a-select v-model:value="diffLeft" size="small" style="width: 240px" placeholder="配置集 A">
          <a-select-option v-for="s in setStore.sets" :key="s.id" :value="s.id">{{ s.name }}</a-select-option>
        </a-select>
        <span class="text-muted">VS</span>
        <a-select v-model:value="diffRight" size="small" style="width: 240px" placeholder="配置集 B">
          <a-select-option v-for="s in setStore.sets" :key="s.id" :value="s.id">{{ s.name }}</a-select-option>
        </a-select>
        <a-button type="primary" size="small" @click="runDiff">对比</a-button>
      </div>
      <WemTable
        v-if="diffRows.length"
        table-id="envset-diff"
        row-key="key"
        :rows="diffRows"
        :columns="diffColumns"
        :capabilities="diffCaps"
        :row-class="diffRowClass"
        empty-text="两套配置集没有差异"
      >
        <template #cell="{ row, column }">
          <template v-if="column.key === 'status'">
            <a-tag :color="{ add: 'green', del: 'red', mod: 'orange' }[row.status]">
              {{ row.statusText }}
            </a-tag>
          </template>
          <template v-else-if="column.key === 'key'"><span class="mono">{{ row.key }}</span></template>
          <template v-else-if="column.key === 'a'"><span class="cell-path">{{ clip(row.a) }}</span></template>
          <template v-else-if="column.key === 'b'"><span class="cell-path">{{ clip(row.b) }}</span></template>
        </template>
      </WemTable>
      <div v-else class="empty-block">选择两套配置集后点击「对比」</div>
    </a-modal>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { Modal, message } from 'ant-design-vue'
import {
  AppstoreOutlined, PlusOutlined, ImportOutlined, ReloadOutlined, DownOutlined, DeleteOutlined,
  CloseOutlined, BlockOutlined, FolderOpenOutlined, InfoCircleOutlined, FileTextOutlined
} from '@ant-design/icons-vue'
import { useSetStore } from '@/store/dev'
import { useEnvStore } from '@/store/env'
import { useUiStore } from '@/store/ui'
import api from '@/api'
import WemTable from '@/components/wem-table/WemTable.vue'
import { clipText } from '@/lib/helpers'
import EnvFileWizard from '@/components/import/EnvFileWizard.vue'
import MutexManager from '@/components/envset/MutexManager.vue'

const setStore = useSetStore()
const env = useEnvStore()
const ui = useUiStore()

const editOpen = ref(false)
const mutexMgr = ref(null)
const editForm = reactive({ id: '', name: '', type: 'global', comment: '', group: '', mutexId: '', projectDir: '', folderWatch: false, variables: [] })

const mutexOpen = ref(false)
const envFileOpen = ref(false)
const diffOpen = ref(false)
const diffLeft = ref(undefined)
const diffRight = ref(undefined)
const diffRows = ref([])
const tplPick = ref(undefined)

const setCaps = {
  inline: false,
  drag: false,
  batchDelete: false,
  batchTag: false,
  batchEnable: false,
  expand: false,
  summary: false
}
const setColumns = [
  { title: '配置集', key: 'name', dataIndex: 'name', width: 240 },
  { title: '类型', key: 'type', dataIndex: 'typeLabel', width: 130 },
  { title: '互斥组', key: 'mutex', dataIndex: 'mutexLabel', width: 170 },
  { title: '内容', key: 'vars', dataIndex: 'varText', ellipsis: true },
  { title: '操作', key: 'actions', width: 260, fixed: 'right', sortable: false, filterable: false }
]
const setRows = computed(() =>
  (setStore.sets || []).map((item) => ({
    ...item,
    typeLabel: item.type === 'project' ? '项目配置集' : '全局配置集',
    mutexLabel: item.mutexId ? mutexName(item.mutexId) : '',
    varText: describeSet(item)
  }))
)

const diffCaps = {
  select: false,
  inline: false,
  drag: false,
  batchDelete: false,
  batchTag: false,
  batchEnable: false,
  expand: false,
  summary: false
}
const diffColumns = [
  { title: '状态', key: 'status', dataIndex: 'statusText', width: 110 },
  { title: '变量名', key: 'key', dataIndex: 'key', width: 200 },
  { title: 'A 值', key: 'a', dataIndex: 'a', ellipsis: true },
  { title: 'B 值', key: 'b', dataIndex: 'b', ellipsis: true }
]

function clip(v) {
  return clipText(v, 80)
}

function mutexName(id) {
  const g = setStore.mutex.find((m) => m.id === id)
  return g ? g.name : id
}

function describeSet(item) {
  const base = `${(item.variables || []).length} 个变量${item.projectDir ? ` · ${item.projectDir}` : ''}`
  if (env.config.envsetShowMeta === false) return base
  const notes = []
  if (item.group) notes.push(item.group)
  if (item.comment) notes.push(item.comment)
  for (const variable of item.variables || []) {
    if (!variable.remark || notes.includes(variable.remark)) continue
    notes.push(variable.remark)
    if (notes.length >= 4) break
  }
  return notes.length ? `${base} · ${notes.join(' · ')}` : base
}

function collectSetPaths(record) {
  const paths = []
  for (const variable of record.variables || []) {
    const key = String(variable.key || variable.name || '')
    const value = String(variable.value || '').trim()
    if (!value) continue
    if (key.toUpperCase() === 'PATH') {
      value.split(';').map((part) => part.trim()).filter(Boolean).forEach((part) => paths.push(part))
    } else if (/^[A-Za-z]:[\\/]/.test(value) && !value.includes(';')) {
      paths.push(value)
    }
  }
  return [...new Set(paths)].slice(0, 80)
}

function confirmMissingPaths(record, invalid) {
  const shown = invalid.slice(0, 8).join('；')
  const more = invalid.length > 8 ? `；另有 ${invalid.length - 8} 条` : ''
  return new Promise((resolve) => {
    Modal.confirm({
      title: '路径预检发现不存在的目录',
      content: `「${record.name}」里有 ${invalid.length} 条路径当前不存在：${shown}${more}。仍要加载到草稿吗？`,
      okText: '仍然加载',
      cancelText: '取消',
      onOk: () => resolve(true),
      onCancel: () => resolve(false)
    })
  })
}

async function precheckSet(record) {
  const paths = collectSetPaths(record)
  if (!paths.length || !api.env.validatePath) return true
  try {
    const res = await api.env.validatePath(paths)
    const invalid = res.ok && res.data ? (res.data.invalid || []) : []
    if (!invalid.length) return true
    return confirmMissingPaths(record, invalid)
  } catch (_) {
    return true
  }
}

function isLoaded(id) {
  return setStore.loadedSets.includes(id)
}

function setRowClass(record) {
  return isLoaded(record.id) ? 'row-added' : ''
}

/* ------------------------------ 配置集 CRUD ------------------------------ */

function openCreate() {
  Object.assign(editForm, {
    id: '', name: '新配置集', type: 'global', comment: '', group: '', mutexId: '',
    projectDir: '', folderWatch: false, variables: []
  })
  editOpen.value = true
}

function editSet(record) {
  if (record.readOnly) return message.warning('该配置集已锁定为只读基线，请先解除锁定')
  Object.assign(editForm, JSON.parse(JSON.stringify(record)))
  editForm.variables = (record.variables || []).map((v) => ({ ...v, scope: v.scope === 'system' ? 'system' : 'user' }))
  editOpen.value = true
}

function addVar() {
  editForm.variables.push({ scope: 'user', key: '', value: '', remark: '' })
}

async function importTemplate(name) {
  if (!name) return
  const res = await api.envset.getTemplate(name)
  if (res.ok && Array.isArray(res.data)) {
    for (const v of res.data) editForm.variables.push({ ...v, scope: v.scope || 'user' })
    message.success('模板已导入')
  }
  tplPick.value = undefined
}

async function pickProjectDir() {
  const res = await api.fs.selectFolder({ title: '选择项目根目录', defaultPath: editForm.projectDir })
  if (res.ok && !res.data.canceled) editForm.projectDir = res.data.path
}

async function submitSet() {
  if (!editForm.name.trim()) return message.error('请输入配置集名称')
  const payload = {
    name: editForm.name.trim(),
    type: editForm.type,
    comment: editForm.comment,
    group: editForm.group,
    mutexId: editForm.mutexId,
    projectDir: editForm.projectDir,
    folderWatch: editForm.folderWatch,
    variables: editForm.variables.filter((v) => v.key.trim())
  }
  try {
    if (editForm.id) {
      const res = await api.envset.update({ id: editForm.id, patch: payload })
      if (!res.ok) throw new Error(res.message)
      message.success('配置集已更新')
    } else {
      const res = await api.envset.create(payload)
      if (!res.ok) throw new Error(res.message)
      message.success('配置集已创建')
    }
    editOpen.value = false
    await setStore.load()
    if (api.envset.syncWatch) api.envset.syncWatch().catch(() => {})
  } catch (err) {
    message.error(err.message)
  }
}

function setAction(key, record) {
  if (key === 'copy') api.envset.duplicate(record.id).then(() => { message.success('已复制'); setStore.load() })
  else if (key === 'export') exportSet(record, env.config.desensitizeExport === true)
  else if (key === 'exportShare') exportSet(record, true)
  else if (key === 'diff') { diffLeft.value = record.id; diffOpen.value = true }
  else if (key === 'terminal') launchTerminal(record)
  else if (key === 'readonly') toggleReadonly(record)
  else if (key === 'delete') deleteSet(record)
}

async function exportSet(record, desensitize) {
  const res = await api.envset.exportToFile({ id: record.id, desensitize })
  if (res.ok && !res.data.canceled) message.success(`已导出：${res.data.file}`)
  else if (!res.ok) message.error(res.message)
}

function toggleReadonly(record) {
  Modal.confirm({
    title: record.readOnly ? '解除只读锁定？' : '设为只读基线？',
    content: record.readOnly ? '解锁后可继续编辑该配置集。' : '锁定后该配置集不允许修改，可作为基线环境长期保存。',
    okText: '确认',
    cancelText: '取消',
    onOk: async () => {
      const res = await api.envset.update({ id: record.id, patch: { readOnly: !record.readOnly, _force: true } })
      if (res.ok) {
        message.success(record.readOnly ? '已解除锁定' : '已锁定为只读基线')
        setStore.load()
      } else message.error(res.message)
    }
  })
}

function deleteSet(record) {
  Modal.confirm({
    title: `删除配置集「${record.name}」？`,
    content: '该操作不可撤销，配置集内保存的变量列表将被删除。',
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      const res = await api.envset.remove(record.id)
      if (res.ok) {
        message.success('已删除')
        setStore.unloadSet(record.id)
        setStore.load()
      } else message.error(res.message)
    }
  })
}

/* ------------------------------ 加载 / 卸载 ------------------------------ */

async function loadOne(record) {
  try {
    if (env.config.envsetPreCheck !== false) {
      const proceed = await precheckSet(record)
      if (!proceed) return { ok: false }
    }
    // 切换前自动快照（设置 → 配置集）：留回滚保底，失败不阻断切换
    if (env.config.envsetSnapshotBefore !== false) {
      api.snapshot.create({ name: `切换前快照 · ${record.name}`, note: '加载配置集前自动生成', auto: true }).catch(() => {})
    }
    const res = await setStore.loadSet(record.id)
    if (res.blocked) {
      message.error(res.message)
      return { ok: false, blocked: true }
    }
    if (res.pendingMutex) {
      const info = res.pendingMutex
      return await new Promise((resolve) => {
        Modal.confirm({
          title: '检测到互斥组冲突',
          content: `⚠️ 检测到互斥组「${info.group.name}」已有【${info.loadedNames.join('、')}】配置集变更存在于草稿，加载【${info.setName}】将移除上述配置集所有草稿变量。`,
          okText: '确认切换（默认）',
          cancelText: '取消本次加载',
          onOk: async () => {
            try {
              const r = await setStore.confirmMutexSwitch(info)
              message.success(`切换完成：清理 ${r.removed} 条旧草稿，新增 ${r.added} 条变量（来源已标记为「配置集」）`)
              ui.tip(`互斥组切换：${info.setName}`, 'info')
              api.log.write({ level: 'info', message: `互斥组切换 ${info.loadedNames.join('/')} -> ${info.setName}，清理 ${r.removed} 条` })
              resolve({ ok: true })
            } catch (err) {
              message.error(err.message || '切换失败')
              resolve({ ok: false })
            }
          },
          onCancel: () => resolve({ ok: false })
        })
      })
    }
    message.success(`已加载「${record.name}」，${res.added.length} 条变量进入草稿区`)
    ui.tip(`已加载配置集 ${record.name}，等待保存写入系统`, 'warning')
    return { ok: true }
  } catch (err) {
    message.error(err.message)
    return { ok: false }
  }
}

function unloadOne(record) {
  const n = setStore.unloadSet(record.id)
  message.success(`已从草稿区移除「${record.name}」的 ${n} 条变更`)
}

/* ------------------------------ 互斥组 ------------------------------ */

function openMutexManager() {
  mutexOpen.value = true
}

function membersOf(g) {
  return setStore.sets.filter((s) => s.mutexId === g.id)
}

function availableFor(g) {
  return setStore.sets.filter((s) => !s.mutexId || s.mutexId === g.id)
}

function createMutex() {
  Modal.confirm({
    title: '新建互斥组',
    content: '创建后可在组内添加配置集，同一组内只能加载一套。',
    okText: '创建',
    cancelText: '取消',
    onOk: async () => {
      const res = await api.envset.createMutex({ name: '新互斥组', comment: '' })
      if (res.ok) {
        message.success('互斥组已创建')
        setStore.load()
      }
    }
  })
}

function editMutex(g) {
  Modal.confirm({
    title: `互斥组设置 · ${g.name}`,
    content: '自动清理本组旧草稿 / 强制阻断多套同时加载 / 切换前置快照，可在下方开关中调整。',
    okText: '知道了',
    onOk: async () => {
      await api.envset.updateMutex({ id: g.id, patch: { autoClean: g.autoClean, forceBlock: g.forceBlock, snapshotBefore: g.snapshotBefore } })
    }
  })
}

function removeMutex(g) {
  Modal.confirm({
    title: `删除互斥组「${g.name}」？`,
    content: '删除互斥组不会删除里面的配置集，仅解除互斥绑定。',
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      const res = await api.envset.deleteMutex(g.id)
      if (res.ok) {
        message.success('互斥组已删除')
        setStore.load()
      }
    }
  })
}

async function addToMutex(g, set) {
  const res = await api.envset.assignMutex({ setId: set.id, mutexId: g.id })
  if (res.ok) {
    setStore.load()
    message.success(`「${set.name}」已加入互斥组「${g.name}」`)
  } else {
    Modal.warning({ title: '无法加入互斥组', content: res.message })
  }
}

async function removeFromMutex(g, set) {
  const res = await api.envset.assignMutex({ setId: set.id, mutexId: '' })
  if (res.ok) {
    setStore.load()
    message.success(`「${set.name}」已移出互斥组`)
  }
}

/* ------------------------------ 临时终端 ------------------------------ */

async function launchTerminal(record) {
  const vars = {}
  for (const v of record.variables || []) vars[v.key] = v.value
  Modal.confirm({
    title: '启动临时终端（进程临时注入）',
    content:
      `将为「${record.name}」启动一个 CMD 窗口：先注入 ${Object.keys(vars).length} 个环境变量，再进入项目目录 ${record.projectDir || '（未绑定）'}。` +
      '变量仅在当前窗口生效，不写入注册表，关闭窗口自动失效。',
    okText: '启动 CMD',
    cancelText: '改用 PowerShell',
    onOk: () => doLaunch(record, vars, 'cmd'),
    onCancel: () => doLaunch(record, vars, 'powershell')
  })
}

async function doLaunch(record, vars, shell) {
  const res = await api.envset.launchTerminal({
    shell,
    cwd: record.projectDir || '',
    env: vars,
    injectDraft: true,
    draftChanges: env.changes,
    title: `WinEnv · ${record.name}`
  })
  if (res.ok) {
    if (res.data && res.data.warning) message.warning(res.data.warning)
    message.success(`终端已启动（PID ${res.data.pid}），配置集变量已注入当前窗口，PATH 为追加而不是覆盖`)
  } else message.error(res.message)
}

/* ------------------------------ 差异对比 ------------------------------ */

function runDiff() {
  if (!diffLeft.value || !diffRight.value) return message.warning('请选择两套配置集')
  if (diffLeft.value === diffRight.value) return message.warning('请选择两套不同的配置集')
  const a = setStore.sets.find((s) => s.id === diffLeft.value)
  const b = setStore.sets.find((s) => s.id === diffRight.value)
  const mapA = {}
  for (const v of a.variables || []) mapA[v.key] = v.value
  const mapB = {}
  for (const v of b.variables || []) mapB[v.key] = v.value

  const rows = []
  const keys = [...new Set([...Object.keys(mapA), ...Object.keys(mapB)])].sort()
  for (const k of keys) {
    const inA = k in mapA
    const inB = k in mapB
    const status = inA && !inB ? 'add' : !inA && inB ? 'del' : mapA[k] !== mapB[k] ? 'mod' : 'same'
    const statusText = { add: 'A 独有', del: 'B 独有', mod: '值不同', same: '一致' }[status]
    rows.push({ key: k, a: inA ? mapA[k] : null, b: inB ? mapB[k] : null, status, statusText })
  }
  diffRows.value = rows
}

function diffRowClass(r) {
  return r.status === 'add' ? 'diff-row-added' : r.status === 'del' ? 'diff-row-removed' : r.status === 'mod' ? 'diff-row-changed' : ''
}

const mutexSets = computed(() => (setStore.sets || []).map((s) => ({
  id: s.id,
  name: s.name,
  groupId: s.mutexId || '',
  groupName: s.mutexId ? mutexName(s.mutexId) : ''
})))

function varKeyOf(v) {
  return String((v && (v.key || v.name)) || '').trim().toUpperCase()
}

/** 向导给出 {name,value,remark}，配置集变量沿用 {scope,key,value,remark} */
function incomingVars(vars) {
  const map = new Map()
  for (const raw of vars || []) {
    const key = String((raw && (raw.name || raw.key)) || '').trim()
    if (!key) continue
    map.set(key.toUpperCase(), {
      scope: 'user',
      key,
      value: raw.value == null ? '' : String(raw.value),
      remark: raw.remark || ''
    })
  }
  return [...map.values()]
}

function mergeSetVars(existing, incoming, mode) {
  const base = (existing || []).map((v) => ({
    ...v,
    key: v.key || v.name || '',
    scope: v.scope === 'system' ? 'system' : (v.scope || 'user')
  })).filter((v) => v.key)
  const addList = incomingVars(incoming)
  const have = new Set(base.map(varKeyOf))
  if (mode === 'overwrite') {
    const pending = new Map(addList.map((v) => [varKeyOf(v), v]))
    let written = 0
    const next = base.map((v) => {
      const hit = pending.get(varKeyOf(v))
      if (!hit) return v
      pending.delete(varKeyOf(v))
      written += 1
      return { ...v, value: hit.value, remark: hit.remark || v.remark }
    })
    for (const v of pending.values()) {
      next.push(v)
      written += 1
    }
    return { variables: next, written, skipped: Math.max(0, addList.length - written) }
  }
  const conflictKeys = new Set(addList.filter((v) => have.has(varKeyOf(v))).map(varKeyOf))
  const next = base.slice()
  const seen = new Set()
  let written = 0
  for (const v of addList) {
    const k = varKeyOf(v)
    if (conflictKeys.has(k) || have.has(k) || seen.has(k)) continue
    seen.add(k)
    next.push(v)
    written += 1
  }
  return { variables: next, written, skipped: addList.length - written }
}

async function onEnvImported(payload) {
  const target = payload && payload.target
  const mode = (payload && payload.mode) || 'merge'
  const vars = (payload && payload.vars) || []
  if (!target || (target.type !== 'new' && target.type !== 'existing')) {
    message.error('导入目标无效')
    return
  }
  try {
    if (target.type === 'new') {
      const variables = incomingVars(vars)
      const name = String(target.name || '').trim() || '导入的配置集'
      const res = await api.envset.create({ name, variables })
      if (!res || res.ok === false) throw new Error((res && res.message) || '创建配置集失败')
      await setStore.load()
      message.success(`已创建配置集「${name}」，共 ${variables.length} 条变量。尚未写入系统环境。`)
      return
    }
    const got = await api.envset.get(target.id)
    if (got && got.ok === false) throw new Error(got.message || '读取配置集失败')
    let detail = got && got.data ? (got.data.set || got.data) : null
    if (!detail || typeof detail !== 'object' || !Array.isArray(detail.variables)) {
      detail = setStore.sets.find((s) => s.id === target.id) || null
    }
    if (!detail) throw new Error('配置集不存在')
    const applied = mergeSetVars(detail.variables || [], vars, mode)
    const label = detail.name || target.name || target.id
    if (!applied.written) {
      await setStore.load()
      message.success(`配置集「${label}」没有写入新变量（跳过 ${applied.skipped} 条同名或冲突项）。尚未写入系统环境。`)
      return
    }
    const res = await api.envset.update({ id: target.id, patch: { variables: applied.variables } })
    if (!res || res.ok === false) throw new Error((res && res.message) || '更新配置集失败')
    await setStore.load()
    message.success(`已更新配置集「${label}」：写入 ${applied.written} 条，跳过 ${applied.skipped} 条。尚未写入系统环境。`)
  } catch (err) {
    message.error(err.message || '导入 .env 失败')
  }
}

let mutexLive = null
let mutexSaveChain = Promise.resolve()

function initialMutexMap() {
  const map = new Map()
  for (const s of setStore.sets || []) {
    if (s.mutexId) map.set(s.mutexId, s.mutexId)
  }
  return map
}

function onMutexChange(groups) {
  const snapshot = JSON.parse(JSON.stringify(Array.isArray(groups) ? groups : []))
  mutexSaveChain = mutexSaveChain.then(() => persistMutex(snapshot)).catch(() => {})
}

async function persistMutex(groups) {
  const prev = mutexLive || initialMutexMap()
  const warnings = []
  const next = new Map()
  let wrote = false

  for (const g of groups) {
    const known = (setStore.mutex || []).some((m) => m.id === g.id)
    let serverId = prev.get(g.id) || (known ? g.id : '')
    const patch = {
      name: g.name || '未命名互斥组',
      comment: g.remark || '',
      snapshotBefore: g.autoSnapshot !== false
    }
    try {
      if (!serverId) {
        const res = await api.envset.createMutex(patch)
        if (!res || res.ok === false || !(res.data && res.data.id)) {
          warnings.push((res && res.message) || '创建互斥组失败')
        } else {
          serverId = res.data.id
          wrote = true
        }
      } else {
        const res = await api.envset.updateMutex({ id: serverId, patch })
        if (!res || res.ok === false) warnings.push((res && res.message) || '更新互斥组失败')
        else wrote = true
      }
    } catch (err) {
      warnings.push(err.message || '互斥组接口不可用')
    }
    if (serverId) next.set(g.id, serverId)
  }

  const wanted = new Map()
  const unresolved = new Set()
  for (const g of groups) {
    const serverId = next.get(g.id)
    for (const setId of g.memberIds || []) {
      if (serverId) wanted.set(setId, serverId)
      else unresolved.add(setId)
    }
  }
  for (const s of setStore.sets || []) {
    if (unresolved.has(s.id)) continue
    const target = wanted.get(s.id) || ''
    if ((s.mutexId || '') === target) continue
    try {
      const res = await api.envset.assignMutex({ setId: s.id, mutexId: target })
      if (!res || res.ok === false) warnings.push((res && res.message) || '配置集互斥绑定未写入')
      else wrote = true
    } catch (err) {
      warnings.push(err.message || '配置集互斥绑定未写入')
    }
  }

  for (const [cid, sid] of prev) {
    if (next.has(cid) || !sid) continue
    try {
      const res = await api.envset.deleteMutex(sid)
      if (!res || res.ok === false) warnings.push((res && res.message) || '删除互斥组失败')
      else wrote = true
    } catch (err) {
      warnings.push(err.message || '删除互斥组失败')
    }
  }

  mutexLive = next
  if (wrote) {
    try { await setStore.load() } catch (_) { /* 刷新失败时界面仍保留本次编辑 */ }
  }
  if (warnings.length) {
    const text = [...new Set(warnings)].slice(0, 2).join('；')
    message.warning(`互斥组只在界面记录，未能全部写入（不会切换系统环境）：${text}`)
  }
}

async function onMutexActivate(payload) {
  const setId = payload && payload.setId
  const set = (setStore.sets || []).find((s) => s.id === setId)
  if (!set) return
  const res = await loadOne(set)
  if (res && res.ok && mutexMgr.value && mutexMgr.value.markActive) mutexMgr.value.markActive(set.id)
}

function openImport() {
  Modal.confirm({
    title: '导入配置集',
    content: '请选择此前导出的配置集 JSON 文件，导入后可在列表中编辑。',
    okText: '选择文件',
    cancelText: '取消',
    onOk: async () => {
      const picked = await api.fs.selectFile({ title: '选择配置集文件', filters: [{ name: 'JSON', extensions: ['json'] }] })
      if (!picked.ok || picked.data.canceled) return
      const read = await api.fs.readTextFile(picked.data.path)
      if (!read.ok) return message.error(read.message)
      const res = await api.envset.importSet(read.data)
      if (res.ok) {
        message.success('配置集已导入')
        setStore.load()
      } else message.error(res.message)
    }
  })
}

onMounted(() => setStore.load())
</script>

<style scoped>
.section-title {
  font-size: 13px;
  font-weight: 600;
  margin: 10px 0 6px;
}

.var-edit-list {
  max-height: 260px;
  overflow: auto;
  border: 1px solid var(--wem-border);
  border-radius: 8px;
  padding: 8px;
  background: var(--wem-card-alt);
}

.var-edit-row {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 6px;
}

.mutex-card {
  border: 1px solid var(--wem-border);
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 12px;
  background: var(--wem-card);
}

.mutex-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 10px;
}

.mutex-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.mutex-col {
  border: 1px solid var(--wem-border);
  border-radius: 8px;
  padding: 8px;
  max-height: 220px;
  overflow: auto;
}

.mutex-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--wem-text-3);
  margin-bottom: 6px;
}

.mutex-item {
  padding: 5px 8px;
  border-radius: 6px;
  font-size: 12.5px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
}

.mutex-item:hover {
  background: rgba(22, 93, 255, 0.08);
}

.mutex-item.member {
  background: var(--wem-card-alt);
  border: 1px solid var(--wem-border);
}

.danger-link {
  color: var(--wem-danger);
}
</style>
