<template>
  <div>
    <div class="reg-layout">
      <!-- ======================= 左：树 + 收藏 ======================= -->
      <div class="wem-card reg-side">
        <div class="wem-card-head">
          <div class="wem-card-title">
            <ApartmentOutlined />
            <span>注册表分支</span>
            <a-tag color="blue">{{ roots.length }} 个根项</a-tag>
          </div>
          <div class="toolbar">
            <a-button size="small" :loading="refreshing" @click="refreshTree">
              <template #icon><ReloadOutlined /></template>
              刷新
            </a-button>
            <a-button size="small" @click="locateOpen = true">
              <template #icon><AimOutlined /></template>
              定位环境变量
            </a-button>
          </div>
        </div>
        <div class="wem-card-body tight">
          <RegFavorites ref="favRef" :current-path="currentPath" @jump="locatePath" />
          <RegTree ref="treeRef" :roots="roots" :selected="currentPath" @select="onSelectNode" />
          <div class="tree-foot text-muted">
            绿色标记 / 主色加粗的节点即环境变量分支。展开节点时才读取子项，避免一次加载整个注册表。
          </div>
        </div>
      </div>

      <!-- ======================= 右：详情 ======================= -->
      <div class="reg-main">
        <div class="wem-card">
          <div class="wem-card-head">
            <div class="wem-card-title">
              <DatabaseOutlined />
              <span>键值详情</span>
              <a-tag v-if="detail.isEnv" color="blue">环境变量分支</a-tag>
              <a-tag v-if="detail.truncated" color="orange">已截断</a-tag>
            </div>
            <div class="toolbar">
              <a-button size="small" :disabled="!currentPath" @click="loadValues(currentPath)">
                <template #icon><ReloadOutlined /></template>
                刷新
              </a-button>
            </div>
          </div>

          <div class="wem-card-body">
            <!-- 路径栏 -->
            <div class="path-bar">
              <div class="path-text mono" :title="currentPath">{{ currentPath || '请从左侧选择一个注册表分支' }}</div>
              <div class="toolbar">
                <a-button size="small" :disabled="!currentPath" @click="copyPath">
                  <template #icon><CopyOutlined /></template>
                  复制路径
                </a-button>
                <a-button size="small" :disabled="!currentPath" :loading="depLoading" @click="analyzeDependency">
                  <template #icon><PartitionOutlined /></template>
                  分析依赖
                </a-button>
              </div>
            </div>

            <!-- 权限告警 -->
            <div v-if="detail.needsAdmin && !detail.writable" class="hint-box warn" style="margin-bottom: 10px">
              <LockOutlined />
              <div>当前分支需要管理员权限才能修改，只读浏览模式。编辑、新建、删除按钮均不可用。</div>
            </div>

            <!-- 操作条 -->
            <div class="toolbar" style="margin-bottom: 10px">
              <a-button type="primary" size="small" :disabled="readonly" @click="openCreateKey">
                <template #icon><FolderAddOutlined /></template>
                新建项
              </a-button>
              <a-button size="small" :disabled="readonly || !currentPath" @click="openCreateValue">
                <template #icon><PlusOutlined /></template>
                新建键值
              </a-button>
              <a-button size="small" :disabled="readonly || selectedKeys.length !== 1" @click="openEditValue">
                <template #icon><EditOutlined /></template>
                编辑键值
              </a-button>
              <a-button size="small" danger :disabled="readonly || !selectedRows.length" @click="deleteSelectedValues()">
                <template #icon><DeleteOutlined /></template>
                删除选中{{ selectedRows.length ? `（${selectedRows.length}）` : '' }}
              </a-button>
              <a-dropdown :disabled="!currentPath">
                <a-button size="small" :disabled="!currentPath">
                  <template #icon><ExportOutlined /></template>
                  导出 / 备份
                </a-button>
                <template #overlay>
                  <a-menu @click="({ key }) => onExportMenu(key)">
                    <a-menu-item key="export">导出选中项为 .reg</a-menu-item>
                    <a-menu-item key="exportKey">导出当前分支为 .reg</a-menu-item>
                    <a-menu-divider />
                    <a-menu-item key="backup">备份当前分支</a-menu-item>
                  </a-menu>
                </template>
              </a-dropdown>
              <a-divider type="vertical" />
              <a-button size="small" :disabled="!currentPath" @click="importWizard?.openWizard()">
                <template #icon><ImportOutlined /></template>
                导入 REG
              </a-button>
              <a-button size="small" :disabled="!currentPath" @click="replaceWizard?.openWizard()">
                <template #icon><SwapOutlined /></template>
                批量查找替换
              </a-button>
            </div>

            <WemTable
              ref="valueTable"
              :table-id="`reg-values-${detail.root || 'none'}`"
              row-key="__key"
              :rows="valueRows"
              :columns="valueColumns"
              :loading="detail.loading"
              :error="detail.error"
              :page-size="12"
              :capabilities="valueCaps"
              empty-text="该注册表项下没有键值"
              @selection-change="(keys) => (selectedKeys = keys)"
              @row-dblclick="(row) => openEditValue(row)"
              @retry="loadValues(currentPath)"
            >
              <template #cell="{ row, column }">
                <template v-if="column.key === 'name'">
                  <a-tooltip :title="row.isDefault ? '(默认) 键值' : row.name">
                    <span class="mono cell-name">{{ row.isDefault ? '(默认)' : row.name }}</span>
                  </a-tooltip>
                </template>
                <template v-else-if="column.key === 'type'">
                  <a-tag :color="typeColor(row.type)">{{ row.type }}</a-tag>
                  <a-tag v-if="row.type === 'REG_BINARY'" color="purple" style="margin-left: 4px">二进制</a-tag>
                </template>
                <template v-else-if="column.key === 'value'">
                  <a-tooltip v-if="row.type === 'REG_BINARY'" :title="row.binary || '（空）'">
                    <span class="mono cell-value bin-value">{{ clip(row.binary || '') }}</span>
                  </a-tooltip>
                  <a-tooltip v-else :title="row.value || '（空）'">
                    <span class="mono cell-value">{{ clip(row.value) }}</span>
                  </a-tooltip>
                </template>
                <template v-else-if="column.key === 'actions'">
                  <a-space size="small">
                    <a :class="{ disabled: readonly }" @click.stop="readonly ? null : openEditValue(row)">编辑</a>
                    <a @click.stop="showValueDetail(row)">详情</a>
                    <a class="danger-link" :class="{ disabled: readonly }" @click.stop="readonly ? null : deleteSelectedValues(row)">
                      删除
                    </a>
                  </a-space>
                </template>
              </template>
            </WemTable>
          </div>
        </div>

        <!-- 变更监控 -->
        <div class="wem-card">
          <div class="wem-card-head">
            <div class="wem-card-title"><EyeOutlined /> 变更监控</div>
            <span class="text-muted">监控外部程序对指定分支的修改，实时刷新日志</span>
          </div>
          <div class="wem-card-body">
            <RegWatchPanel ref="watchRef" :current-path="currentPath" @external-change="onExternalChange" />
          </div>
        </div>
      </div>
    </div>

    <!-- 依赖分析结果 -->
    <a-modal v-model:open="depOpen" title="注册表依赖分析" width="860px" :footer="null">
      <a-spin :spinning="depLoading">
        <div v-if="depData" class="dep-body">
          <div class="stat-grid" style="margin-bottom: 12px">
            <div class="stat-card">
              <div class="stat-label">分析键值</div>
              <div class="stat-value">{{ depData.items.length }}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">引用变量</div>
              <div class="stat-value">{{ depRefCount }}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">失效引用</div>
              <div class="stat-value" style="color: #f53f3f">{{ depData.invalid.length }}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">循环引用</div>
              <div class="stat-value" style="color: #ff7d00">{{ depData.cycles.length }}</div>
            </div>
          </div>

          <div v-if="depData.invalid.length" class="hint-box danger" style="margin-bottom: 10px">
            <WarningOutlined />
            <div>
              存在 {{ depData.invalid.length }} 个无法解析的变量引用：
              <span class="mono">{{ depInvalidText }}</span>
            </div>
          </div>
          <div v-if="depData.cycles.length" class="hint-box warn" style="margin-bottom: 10px">
            <WarningOutlined />
            <div>
              检测到循环引用：<span class="mono">{{ depData.cycles.map((c) => c.join(' → ')).join('；') }}</span>
            </div>
          </div>

          <WemTable
            table-id="reg-dep"
            row-key="__key"
            :rows="depRows"
            :columns="depColumns"
            :page-size="8"
            :capabilities="depCaps"
            empty-text="该分支没有字符串类型的键值，无法分析引用"
          >
            <template #cell="{ row, column }">
              <template v-if="column.key === 'name'"><span class="mono">{{ row.name || '(默认)' }}</span></template>
              <template v-else-if="column.key === 'refs'">
                <a-tag
                  v-for="ref in row.refs"
                  :key="ref.name"
                  :color="ref.exists ? (ref.scope === 'machine' ? 'purple' : 'blue') : 'red'"
                  style="margin-bottom: 2px"
                >
                  %{{ ref.name }}%{{ ref.exists ? '' : ' 缺失' }}
                </a-tag>
                <span v-if="!row.refs.length" class="text-muted">无引用</span>
              </template>
            </template>
          </WemTable>
        </div>
      </a-spin>
    </a-modal>

    <!-- 键值详情 -->
    <a-modal v-model:open="valueDetailOpen" :title="`键值详情 · ${valueDetailRow?.name || '(默认)'}`" width="720px" :footer="null">
      <div v-if="valueDetailRow" class="kv-list">
        <span class="kv-key">名称</span><span class="kv-val mono">{{ valueDetailRow.name || '(默认)' }}</span>
        <span class="kv-key">类型</span><span class="kv-val">{{ valueDetailRow.type }}</span>
        <span class="kv-key">长度</span><span class="kv-val">{{ (valueDetailRow.value || '').length }} 字符</span>
      </div>
      <div v-if="valueDetailRow" class="detail-block">
        <div class="detail-label">数据</div>
        <pre class="detail-pre mono">{{ valueDetailRow.type === 'REG_BINARY' ? (valueDetailRow.binary || '（空）') : (valueDetailRow.value || '（空）') }}</pre>
      </div>
      <div class="toolbar" style="margin-top: 12px">
        <a-button size="small" @click="copyText(valueDetailRow.type === 'REG_BINARY' ? valueDetailRow.binary : valueDetailRow.value)">
          <template #icon><CopyOutlined /></template>
          复制数据
        </a-button>
        <a-button size="small" @click="copyText(currentPath)">
          <template #icon><CopyOutlined /></template>
          复制路径
        </a-button>
      </div>
    </a-modal>

    <!-- 新建项 -->
    <a-modal v-model:open="createKeyOpen" title="新建注册表项" ok-text="创建" cancel-text="取消" @ok="submitCreateKey">
      <div class="hint-box" style="margin-bottom: 10px">
        <InfoCircleOutlined />
        <div>父项：<span class="mono">{{ currentPath }}</span></div>
      </div>
      <a-form layout="vertical">
        <a-form-item label="项名称" required>
          <a-input v-model:value="createKeyName" placeholder="例如：MyTool" :maxlength="255" />
          <div class="field-hint">不能为空、不能包含反斜杠 \，最长 255 个字符。</div>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 备份当前分支 -->
    <a-modal
      v-model:open="backupOpen"
      title="备份当前注册表分支"
      width="600px"
      ok-text="创建备份"
      cancel-text="取消"
      :confirm-loading="backingUp"
      @ok="submitBackup"
    >
      <a-form layout="vertical" style="margin-top: 6px">
        <a-form-item label="分支路径">
          <a-input :value="currentPath" class="mono" disabled />
        </a-form-item>
        <a-form-item label="备份名称" required>
          <a-input v-model:value="backupForm.name" placeholder="例如：修改 PATH 前" :maxlength="80" />
        </a-form-item>
        <a-form-item label="备注">
          <a-textarea v-model:value="backupForm.note" :rows="2" placeholder="可选，记录这次备份的背景" />
        </a-form-item>
        <a-form-item label="标签">
          <a-select v-model:value="backupForm.tags" mode="tags" placeholder="输入后回车，可多个" :token-separators="[',']" />
        </a-form-item>
        <a-form-item label="备份格式">
          <a-radio-group v-model:value="backupForm.format">
            <a-radio value="json">JSON（带 SHA256 校验，推荐）</a-radio>
            <a-radio value="reg">.reg 原生格式</a-radio>
          </a-radio-group>
          <div class="field-hint">
            JSON 格式带完整性校验，恢复前可验证文件是否被篡改；.reg 格式可被系统注册表编辑器直接导入。
          </div>
        </a-form-item>
        <a-form-item label="存储目录">
          <a-input v-model:value="backupForm.dir" class="mono" placeholder="留空使用默认备份目录">
            <template #suffix>
              <a @click="pickBackupDir">选择…</a>
            </template>
          </a-input>
        </a-form-item>
      </a-form>
      <div class="hint-box warn">
        <WarningOutlined />
        <div>大分支（如 HKLM\SOFTWARE）备份耗时会明显变长，并占用更多磁盘空间。</div>
      </div>
    </a-modal>

    <!-- 定位环境变量 -->
    <a-modal v-model:open="locateOpen" title="定位环境变量注册表" ok-text="定位" cancel-text="取消" @ok="doLocate">
      <a-radio-group v-model:value="locateScope" style="width: 100%">
        <a-radio value="user" class="locate-item">
          <b>用户变量</b>
          <div class="locate-desc mono">HKCU\Environment · 当前用户生效，普通权限即可修改</div>
        </a-radio>
        <a-radio value="machine" class="locate-item">
          <b>系统变量</b>
          <div class="locate-desc mono">HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment · 全局生效，需要管理员权限</div>
        </a-radio>
      </a-radio-group>
    </a-modal>

    <RegValueEditor ref="editorRef" :readonly="readonly" @submit="submitValue" />
    <RegImportWizard ref="importWizard" @done="afterWrite" />
    <RegReplaceWizard ref="replaceWizard" :scope-path="currentPath" @done="afterWrite" />
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { Modal, message } from 'ant-design-vue'
import {
  ApartmentOutlined, DatabaseOutlined, ReloadOutlined, AimOutlined, CopyOutlined,
  PartitionOutlined, FolderAddOutlined, PlusOutlined, EditOutlined, DeleteOutlined,
  ImportOutlined, ExportOutlined, SwapOutlined, EyeOutlined, LockOutlined,
  InfoCircleOutlined, WarningOutlined
} from '@ant-design/icons-vue'
import api from '@/api'
import WemTable from '@/components/wem-table/WemTable.vue'
import RegTree from '@/components/registry/RegTree.vue'
import RegFavorites from '@/components/registry/RegFavorites.vue'
import RegValueEditor from '@/components/registry/RegValueEditor.vue'
import RegImportWizard from '@/components/registry/RegImportWizard.vue'
import RegReplaceWizard from '@/components/registry/RegReplaceWizard.vue'
import RegWatchPanel from '@/components/registry/RegWatchPanel.vue'
import { confirmDanger } from '@/components/registry/confirmDanger'
import { useUiStore } from '@/store/ui'

const ui = useUiStore()

const roots = ref([])
const refreshing = ref(false)
const treeRef = ref(null)
const favRef = ref(null)
const editorRef = ref(null)
const importWizard = ref(null)
const replaceWizard = ref(null)
const watchRef = ref(null)

const currentPath = ref('')
const selectedKeys = ref([])
const valueTable = ref(null)

const detail = reactive({
  root: '',
  loading: false,
  error: '',
  values: [],
  admin: false,
  writable: true,
  needsAdmin: false,
  isEnv: false
})

const readonly = computed(() => detail.needsAdmin && !detail.writable)

const valueCaps = {
  inline: false,
  drag: false,
  sort: true,
  summary: false,
  batchDelete: false,
  batchTag: false,
  batchEnable: false,
  contextMenu: false,
  export: false,
  select: true
}

const valueColumns = [
  { title: '名称', key: 'name', dataIndex: 'name', width: 220, ellipsis: true },
  { title: '类型', key: 'type', dataIndex: 'type', width: 190 },
  { title: '数据', key: 'value', dataIndex: 'value', ellipsis: true },
  { title: '备注', key: 'note', dataIndex: 'note', width: 160, ellipsis: true },
  { title: '操作', key: 'actions', dataIndex: 'actions', width: 180, fixed: 'right', sortable: false, filterable: false }
]

const valueRows = computed(() => (detail.values || []).map((row) => ({
  ...row,
  __key: row.name || '__default__',
  note: noteOf(row)
})))

const selectedRows = computed(() =>
  valueRows.value.filter((row) => selectedKeys.value.includes(row.__key))
)

function noteOf(row) {
  if (row.isDefault) return '默认键值'
  if (detail.isEnv && /^path$/i.test(row.name)) return 'PATH 主变量'
  if (row.type === 'REG_EXPAND_SZ') return '含变量引用'
  return ''
}

function clip(text) {
  const s = String(text == null ? '' : text)
  return s.length > 120 ? `${s.slice(0, 120)}…` : (s || '—')
}

function typeColor(type) {
  if (type === 'REG_SZ') return 'blue'
  if (type === 'REG_EXPAND_SZ') return 'cyan'
  if (type === 'REG_MULTI_SZ') return 'geekblue'
  if (type === 'REG_DWORD' || type === 'REG_QWORD') return 'orange'
  if (type === 'REG_BINARY') return 'purple'
  return 'default'
}

async function loadRoots() {
  refreshing.value = true
  try {
    const res = await api.reg.roots()
    if (!res.ok) {
      message.error(res.message)
      return
    }
    roots.value = res.data || []
    // 默认定位到用户环境变量分支，打开页面即可看到有用内容；失败则选中第一个根项
    if (!currentPath.value) {
      const env = await api.reg.envPaths()
      if (env.ok && env.data && env.data.user) {
        await locatePath(env.data.user)
      } else if (roots.value.length) {
        await locatePath(roots.value[0].key)
      }
    }
  } finally {
    refreshing.value = false
  }
}

async function refreshTree() {
  refreshing.value = true
  try {
    await treeRef.value?.refresh()
    if (currentPath.value) await loadValues(currentPath.value)
    message.success('注册表树已刷新')
  } finally {
    refreshing.value = false
  }
}

function onSelectNode(path) {
  if (!path) return
  currentPath.value = path
  selectedKeys.value = []
  loadValues(path)
}

async function locatePath(path) {
  if (!path) return
  currentPath.value = path
  selectedKeys.value = []
  await treeRef.value?.expandTo(path)
  await loadValues(path)
}

async function loadValues(path) {
  if (!path) return
  detail.loading = true
  detail.error = ''
  try {
    const res = await api.reg.values(path)
    if (!res.ok) {
      detail.values = []
      detail.error = res.message || '读取键值失败'
      message.error(detail.error)
      return
    }
    const data = res.data || {}
    detail.values = data.values || []
    detail.admin = !!data.admin
    detail.writable = data.writable !== false
    detail.needsAdmin = !!data.needsAdmin
    detail.isEnv = !!data.isEnv
    detail.root = String(data.path || path).split('\\')[0]
    if (data.path) currentPath.value = data.path
    selectedKeys.value = []
    valueTable.value?.clearSelection()
  } catch (err) {
    detail.error = err.message
  } finally {
    detail.loading = false
  }
}

async function afterWrite() {
  if (currentPath.value) await loadValues(currentPath.value)
  treeRef.value?.invalidate(currentPath.value)
  const parent = currentPath.value.replace(/\\[^\\]+$/, '')
  if (parent && parent !== currentPath.value) treeRef.value?.invalidate(parent)
}

function onExternalChange(payload) {
  if (!payload || !payload.path) return
  const changed = String(payload.path).toLowerCase()
  const mine = String(currentPath.value).toLowerCase()
  if (mine && (changed === mine || mine.startsWith(`${changed}\\`))) loadValues(currentPath.value)
  else message.info(`检测到外部程序修改了 ${payload.path}`)
}

/* ------------------------------ 复制 / 详情 ------------------------------ */

async function copyText(text) {
  if (!text) {
    message.info('没有可复制的内容')
    return
  }
  try {
    await navigator.clipboard.writeText(String(text))
    message.success('已复制到剪贴板')
  } catch {
    message.warning('复制失败，请手动选择复制')
  }
}

function copyPath() {
  copyText(currentPath.value)
}

const valueDetailOpen = ref(false)
const valueDetailRow = ref(null)

function showValueDetail(row) {
  valueDetailRow.value = row
  valueDetailOpen.value = true
}

/* ------------------------------ 新建 / 编辑 / 删除 ------------------------------ */

const createKeyOpen = ref(false)
const createKeyName = ref('')

function openCreateKey() {
  if (readonly.value) {
    message.error('当前分支需要管理员权限才能修改')
    return
  }
  createKeyName.value = ''
  createKeyOpen.value = true
}

async function submitCreateKey() {
  const name = String(createKeyName.value || '')
  if (!name.trim()) {
    message.error('项名称不能为空')
    return
  }
  if (name.includes('\\')) {
    message.error('项名称不能包含反斜杠 \\')
    return
  }
  if (name.length > 255) {
    message.error('项名称不能超过 255 个字符')
    return
  }
  const res = await api.reg.createKey({ parentPath: currentPath.value, keyName: name.trim() })
  if (!res.ok) {
    message.error(res.message)
    return
  }
  createKeyOpen.value = false
  message.success(`已创建注册表项 ${res.data.path}`)
  ui.tip(`新建注册表项：${res.data.path}`, 'success')
  await afterWrite()
}

function openCreateValue() {
  if (readonly.value) {
    message.error('当前分支需要管理员权限才能修改')
    return
  }
  editorRef.value?.openCreate(currentPath.value, '')
}

function openEditValue(row) {
  if (readonly.value) {
    message.error('当前分支需要管理员权限才能修改')
    return
  }
  const target = row || selectedRows.value[0]
  if (!target) {
    message.info('请先选择要编辑的键值')
    return
  }
  editorRef.value?.openEdit(currentPath.value, target)
}

async function submitValue(payload) {
  if (readonly.value) {
    message.error('当前分支需要管理员权限才能修改')
    return
  }
  editorRef.value?.setSubmitting(true)
  try {
    const res = await api.reg.setValue({
      path: payload.path,
      name: payload.name,
      type: payload.type,
      value: payload.value
    })
    if (!res.ok) {
      message.error(res.message)
      return
    }
    // 改名场景：先写新名再删旧名
    if (payload.mode === 'edit' && payload.name !== payload.oldName) {
      const del = await api.reg.deleteValue({ path: payload.path, name: payload.oldName })
      if (!del.ok) message.warning(`新值已写入，但删除旧键值失败：${del.message}`)
    }
    editorRef.value?.close()
    message.success(payload.mode === 'edit' ? '键值已更新' : '键值已写入')
    ui.tip(`注册表键值已写入：${payload.name || '(默认)'}`, 'success')
    await afterWrite()
  } finally {
    editorRef.value?.setSubmitting(false)
  }
}

async function deleteSelectedValues(single) {
  if (readonly.value) {
    message.error('当前分支需要管理员权限才能修改')
    return
  }
  const list = single ? [single] : selectedRows.value
  if (!list.length) {
    message.info('请先勾选要删除的键值')
    return
  }
  const paths = list.map((row) => `${currentPath.value}\\${row.name || '(默认)'}`)
  const ok = await confirmDanger({
    title: '⚠️ 注册表修改高危警告',
    warning:
      '修改 Windows 注册表可能造成程序异常、系统无法启动等严重问题，' +
      '强烈建议在修改前先对该注册表分支创建注册表备份。',
    content: `即将删除 ${list.length} 个键值，删除后无法通过本软件撤销（可用注册表备份恢复）。`,
    hint: '如不确定影响范围，请先点击「导出 / 备份 → 备份当前分支」。',
    rows: list.map((row, i) => ({
      完整路径: paths[i],
      类型: row.type,
      数据: row.type === 'REG_BINARY' ? (row.binary || '') : (row.value || '')
    })),
    columns: [
      { title: '完整路径', dataIndex: '完整路径', key: '完整路径', ellipsis: true },
      { title: '类型', dataIndex: '类型', key: '类型', width: 130 },
      { title: '数据', dataIndex: '数据', key: '数据', ellipsis: true }
    ]
  })
  if (!ok) return

  let done = 0
  const failed = []
  for (const row of list) {
    const res = await api.reg.deleteValue({ path: currentPath.value, name: row.name })
    if (res.ok) done += 1
    else failed.push(`${row.name || '(默认)'}：${res.message}`)
  }
  if (done) {
    message.success(`已删除 ${done} 个键值`)
    ui.tip(`注册表键值已删除：${done} 项`, 'warning')
  }
  if (failed.length) Modal.error({ title: `${failed.length} 个键值删除失败`, content: failed.join('\n') })
  await afterWrite()
}

/* ------------------------------ 导出 / 备份 ------------------------------ */

function onExportMenu(key) {
  if (key === 'export') exportSelected()
  else if (key === 'exportKey') exportBranch()
  else if (key === 'backup') openBackup()
}

async function exportSelected() {
  const list = selectedRows.value
  if (!list.length) {
    message.warning('请先勾选要导出的键值')
    return
  }
  const picked = await api.reg.pickSaveReg({
    defaultName: `${currentPath.value.replace(/[\\:*?"<>|]/g, '_')}-selected.reg`
  })
  if (!picked.ok) {
    message.error(picked.message)
    return
  }
  if (!picked.data || !picked.data.file) return
  // 导出选中键值：后端只支持「按分支导出」，这里在渲染层按 regsvc.buildRegText
  // 的同一格式生成文本再落盘，避免为导出而向注册表写入临时分支。
  const values = list.map((row) => ({
    name: row.name,
    type: row.type,
    value: row.type === 'REG_BINARY' ? (row.binary || '') : (row.value || '')
  }))
  const res = await exportNodes([{ path: currentPath.value, values }], picked.data.file)
  if (!res.ok) {
    message.error(res.message)
    return
  }
  message.success(`已导出 ${list.length} 个键值到 ${res.data.file}`)
  ui.tip(`注册表已导出：${res.data.file}`, 'success')
}

/** 按 regsvc.buildRegText 的格式拼 .reg 文本（已逐字段对齐验证） */
async function exportNodes(nodes, file) {
  const text = buildRegText(nodes)
  const w = await api.fs.writeTextFile({ file, content: text, bom: true })
  if (!w.ok) return w
  return { ok: true, data: { file: w.data && w.data.file ? w.data.file : file } }
}

function regEscape(text) {
  return String(text == null ? '' : text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * 字符串转 UTF-16LE 字节序列（与 electron/lib/regsvc.js 的 utf16Hex 一致），
 * 返回可直接拼成 hex(...) 的两位十六进制数组。
 */
function utf16HexBytes(text) {
  const units = []
  for (const ch of String(text == null ? '' : text)) {
    const code = ch.codePointAt(0)
    if (code > 0xffff) {
      const v = code - 0x10000
      units.push(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff))
    } else {
      units.push(code)
    }
  }
  const bytes = []
  for (const unit of units) {
    bytes.push((unit & 0xff).toString(16).padStart(2, '0'))
    bytes.push(((unit >> 8) & 0xff).toString(16).padStart(2, '0'))
  }
  return bytes
}

function buildRegText(nodes) {
  const lines = ['Windows Registry Editor Version 5.00', '']
  for (const node of nodes) {
    lines.push(`[${node.path}]`)
    for (const value of node.values || []) {
      const name = value.name ? `"${regEscape(value.name)}"` : '@'
      const type = value.type || 'REG_SZ'
      if (type === 'REG_SZ') {
        lines.push(`${name}="${regEscape(value.value)}"`)
      } else if (type === 'REG_EXPAND_SZ') {
        lines.push(`${name}=hex(2):${utf16HexBytes(`${value.value || ''}\0`).join(',')}`)
      } else if (type === 'REG_MULTI_SZ') {
        const parts = String(value.value || '').split(/\r?\n/).filter((s) => s !== '')
        const bytes = []
        for (const part of parts) bytes.push(...utf16HexBytes(part), '00', '00')
        bytes.push('00', '00')
        lines.push(`${name}=hex(7):${bytes.join(',')}`)
      } else if (type === 'REG_DWORD') {
        const n = Number(value.value) >>> 0
        // 与 electron/lib/regsvc.js 的 buildRegText 保持一致，保证导出再导入的字节序闭环
        lines.push(`${name}=dword:${n.toString(16).padStart(8, '0')}`)
      } else if (type === 'REG_QWORD') {
        let hex = ''
        try {
          hex = BigInt(String(value.value || '0').trim() || '0').toString(16).padStart(16, '0').slice(-16)
        } catch {
          hex = '0000000000000000'
        }
        const pairs = []
        for (let i = 14; i >= 0; i -= 2) pairs.push(hex.slice(i, i + 2))
        lines.push(`${name}=hex(b):${pairs.join(',')}`)
      } else if (type === 'REG_BINARY') {
        const clean = String(value.value || '').replace(/[^0-9a-fA-F]/g, '')
        const pairs = clean.match(/.{1,2}/g) || []
        lines.push(`${name}=hex:${pairs.join(',')}`)
      } else {
        lines.push(`${name}="${regEscape(value.value)}"`)
      }
    }
    lines.push('')
  }
  return lines.join('\r\n')
}

async function exportBranch() {
  const picked = await api.reg.pickSaveReg({
    defaultName: `${currentPath.value.replace(/[\\:*?"<>|]/g, '_')}.reg`
  })
  if (!picked.ok) {
    message.error(picked.message)
    return
  }
  if (!picked.data || !picked.data.file) return
  const res = await api.reg.exportReg({ path: currentPath.value, file: picked.data.file, encoding: 'utf8' })
  if (!res.ok) {
    message.error(res.message)
    return
  }
  message.success(`已导出 ${res.data.keys} 个注册表项${res.data.truncated ? '（已截断）' : ''}`)
  ui.tip(`注册表分支已导出：${res.data.file}`, 'success')
}

const backupOpen = ref(false)
const backingUp = ref(false)
const backupForm = reactive({ name: '', note: '', tags: [], format: 'json', dir: '' })

function openBackup() {
  backupForm.name = `${currentPath.value} 备份`
  backupForm.note = ''
  backupForm.tags = []
  backupForm.format = 'json'
  backupForm.dir = ''
  backupOpen.value = true
}

async function pickBackupDir() {
  const res = await api.fs.selectFolder({ title: '选择注册表备份目录' })
  if (res.ok && res.data && !res.data.canceled) backupForm.dir = res.data.path
}

async function submitBackup() {
  if (!backupForm.name.trim()) {
    message.error('请填写备份名称')
    return
  }
  backingUp.value = true
  try {
    const res = await api.regBackup.create({
      path: currentPath.value,
      name: backupForm.name.trim(),
      note: backupForm.note,
      tags: backupForm.tags,
      format: backupForm.format,
      dir: backupForm.dir || undefined
    })
    if (!res.ok) {
      message.error(res.message)
      return
    }
    backupOpen.value = false
    message.success(`备份已创建：${res.data.keyCount} 个注册表项，${formatBytes(res.data.size)}`)
    ui.tip(`注册表备份已创建：${res.data.file}`, 'success')
  } finally {
    backingUp.value = false
  }
}

function formatBytes(n) {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = Number(n) || 0
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  return `${Math.round(value * 10) / 10} ${units[i]}`
}

/* ------------------------------ 依赖分析 ------------------------------ */

const depOpen = ref(false)
const depLoading = ref(false)
const depData = ref(null)

const depRows = computed(() => {
  const items = (depData.value && depData.value.items) || []
  return items.map((item, i) => ({ ...item, __key: `dep-${i}` }))
})
const depRefCount = computed(() =>
  ((depData.value && depData.value.items) || []).reduce((n, item) => n + (item.refs || []).length, 0)
)
const depInvalidText = computed(() => {
  const list = (depData.value && depData.value.invalid) || []
  return list.slice(0, 8).map((it) => `${it.name} → %${it.ref}%`).join('，')
})

const depCaps = {
  inline: false,
  drag: false,
  sort: false,
  summary: false,
  select: false,
  batchDelete: false,
  batchTag: false,
  batchEnable: false,
  contextMenu: false,
  export: false,
  filter: false
}

const depColumns = [
  { title: '键名', key: 'name', dataIndex: 'name', width: 200, ellipsis: true },
  { title: '类型', key: 'type', dataIndex: 'type', width: 140 },
  { title: '原始值', key: 'raw', dataIndex: 'raw', ellipsis: true },
  { title: '引用的变量', key: 'refs', dataIndex: 'refs' }
]

async function analyzeDependency() {
  if (!currentPath.value) {
    message.info('请先选择一个注册表分支')
    return
  }
  depOpen.value = true
  depLoading.value = true
  depData.value = null
  try {
    const res = await api.regDep.analyze({ path: currentPath.value })
    if (!res.ok) {
      message.error(res.message)
      return
    }
    depData.value = res.data || { items: [], cycles: [], invalid: [] }
  } finally {
    depLoading.value = false
  }
}

/* ------------------------------ 定位环境变量 ------------------------------ */

const locateOpen = ref(false)
const locateScope = ref('user')

async function doLocate() {
  const res = await api.reg.envPaths()
  if (!res.ok) {
    message.error(res.message)
    return
  }
  const path = locateScope.value === 'machine' ? res.data.machine : res.data.user
  locateOpen.value = false
  await locatePath(path)
  message.success(`已定位到${locateScope.value === 'machine' ? '系统' : '用户'}环境变量分支`)
}

onMounted(loadRoots)
</script>

<style scoped>
.reg-layout {
  display: grid;
  grid-template-columns: minmax(320px, 400px) minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}

@media (max-width: 1180px) {
  .reg-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}

.reg-side {
  position: sticky;
  top: 0;
}

.reg-main {
  min-width: 0;
}

.tree-foot {
  font-size: 11px;
  line-height: 1.6;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--wem-border);
}

.path-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border: 1px solid var(--wem-border);
  border-radius: 8px;
  background: var(--wem-card-alt);
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.path-text {
  flex: 1 1 240px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--wem-text-2);
  font-size: 12px;
}

.bin-value {
  color: var(--wem-text-3);
}

.disabled {
  color: var(--wem-text-3);
  pointer-events: none;
}

.danger-link {
  color: var(--wem-danger);
}

.field-hint {
  font-size: 11.5px;
  color: var(--wem-text-3);
  margin-top: 4px;
  line-height: 1.5;
}

.locate-item {
  display: flex;
  align-items: flex-start;
  width: 100%;
  padding: 10px 12px;
  margin-bottom: 10px;
  border: 1px solid var(--wem-border);
  border-radius: 10px;
}

.locate-desc {
  font-size: 11.5px;
  color: var(--wem-text-3);
  margin-top: 3px;
  word-break: break-all;
  white-space: normal;
}

.detail-block {
  margin-top: 12px;
}

.detail-label {
  font-size: 12px;
  color: var(--wem-text-3);
  margin-bottom: 6px;
}

.detail-pre {
  max-height: 320px;
  overflow: auto;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid var(--wem-border);
  background: var(--wem-card-alt);
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
}

.dep-body {
  padding-top: 4px;
}
</style>
