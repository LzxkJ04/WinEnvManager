<template>
  <div class="reg-fav">
    <div class="fav-head">
      <div class="wem-card-title">
        <StarOutlined />
        <span>收藏夹</span>
        <a-tag color="blue">{{ items.length }} 项</a-tag>
      </div>
      <div class="toolbar">
        <a-button size="small" @click="importJson">
          <template #icon><ImportOutlined /></template>
          导入
        </a-button>
        <a-button size="small" @click="exportJson">
          <template #icon><ExportOutlined /></template>
          导出
        </a-button>
        <a-button size="small" @click="toggleOpen">
          {{ open ? '收起' : '展开' }}
        </a-button>
      </div>
    </div>

    <div v-show="open" class="fav-body">
      <a-spin :spinning="loading">
        <div v-for="group in groupList" :key="group.id" class="fav-group">
          <div class="fav-group-head">
            <a-tag :color="group.builtin ? 'gold' : 'default'">{{ group.name }}</a-tag>
            <span class="text-muted">{{ countOf(group.id) }} 项</span>
            <template v-if="!group.builtin">
              <a @click="openGroupRename(group)">重命名</a>
              <a class="danger-link" @click="removeGroup(group)">删除组</a>
            </template>
            <a v-else class="text-muted" title="内置分组不可重命名或删除">内置</a>
          </div>

          <div v-if="!countOf(group.id)" class="fav-empty">该分组下还没有收藏</div>
          <div v-for="item in itemsOf(group.id)" :key="item.id" class="fav-item">
            <div class="fav-item-main">
              <a-tooltip :title="item.path">
                <span class="fav-name" :class="{ hidden: item.hidden }" @click="jump(item)">{{ item.name }}</span>
              </a-tooltip>
              <span class="fav-path mono" :title="item.path">{{ item.path }}</span>
              <div v-if="item.note" class="fav-note">{{ item.note }}</div>
            </div>
            <a-space size="small" class="fav-actions">
              <a @click="jump(item)">跳转</a>
              <a v-if="!item.builtin" @click="openRename(item)">重命名</a>
              <a v-if="!item.builtin" @click="openEdit(item)">编辑</a>
              <a @click="openMove(item)">移动</a>
              <a v-if="item.builtin" @click="toggleHidden(item)">{{ item.hidden ? '取消隐藏' : '隐藏' }}</a>
              <a v-else class="danger-link" @click="removeItem(item)">删除</a>
            </a-space>
          </div>
        </div>
      </a-spin>

      <div class="toolbar" style="margin-top: 10px">
        <a-button type="primary" size="small" block @click="openCreate">
          <template #icon><PlusOutlined /></template>
          新建收藏
        </a-button>
        <a-button size="small" @click="openGroupCreate">
          <template #icon><FolderAddOutlined /></template>
          新建分组
        </a-button>
      </div>
    </div>

    <!-- 新建 / 编辑收藏 -->
    <a-modal
      v-model:open="formOpen"
      :title="form.id ? '编辑收藏' : '新建收藏'"
      ok-text="保存"
      cancel-text="取消"
      @ok="submitForm"
    >
      <a-form layout="vertical" style="margin-top: 8px">
        <a-form-item label="名称" required>
          <a-input v-model:value="form.name" placeholder="例如：启动项 Run" :maxlength="80" />
        </a-form-item>
        <a-form-item label="注册表路径" required>
          <a-input v-model:value="form.path" class="mono" placeholder="HKCU\Software\Microsoft\Windows\CurrentVersion\Run" />
          <div class="toolbar" style="margin-top: 6px">
            <a-button size="small" :disabled="!currentPath" @click="fillCurrent">
              填入当前选中分支
            </a-button>
            <span class="text-muted">{{ currentPath || '当前没有选中分支' }}</span>
          </div>
        </a-form-item>
        <a-form-item label="分组">
          <a-select v-model:value="form.groupId" allow-clear placeholder="不分组">
            <a-select-option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="备注">
          <a-textarea v-model:value="form.note" :rows="2" placeholder="可选，记录这个分支的用途" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 仅改名称 -->
    <a-modal v-model:open="renameOpen" title="重命名收藏" ok-text="保存" cancel-text="取消" @ok="submitRename">
      <a-input v-model:value="renameValue" :maxlength="80" placeholder="收藏名称" />
    </a-modal>

    <!-- 移动分组 -->
    <a-modal v-model:open="moveOpen" title="移动到分组" ok-text="移动" cancel-text="取消" @ok="submitMove">
      <a-select v-model:value="moveGroupId" style="width: 100%" placeholder="不分组" allow-clear>
        <a-select-option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</a-select-option>
      </a-select>
    </a-modal>

    <!-- 分组名称 -->
    <a-modal v-model:open="groupOpen" :title="groupForm.id ? '重命名分组' : '新建分组'" ok-text="保存" cancel-text="取消" @ok="submitGroup">
      <a-input v-model:value="groupForm.name" :maxlength="40" placeholder="分组名称，例如：软件启动项" />
    </a-modal>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { message } from 'ant-design-vue'
import {
  StarOutlined, PlusOutlined, ExportOutlined, ImportOutlined, FolderAddOutlined
} from '@ant-design/icons-vue'
import api from '@/api'
import { useUiStore } from '@/store/ui'
import { confirmDanger } from '@/components/registry/confirmDanger'

const props = defineProps({
  currentPath: { type: String, default: '' }
})

const emit = defineEmits(['jump'])
const ui = useUiStore()

const open = ref(true)
const loading = ref(false)
const groups = ref([])
const items = ref([])

const formOpen = ref(false)
const form = reactive({ id: '', name: '', path: '', groupId: '', note: '' })

const renameOpen = ref(false)
const renameTarget = ref(null)
const renameValue = ref('')

const moveOpen = ref(false)
const moveTarget = ref(null)
const moveGroupId = ref(undefined)

const groupOpen = ref(false)
const groupForm = reactive({ id: '', name: '' })

const groupList = computed(() => {
  const list = [...groups.value]
  const rest = items.value.filter((i) => !i.groupId || !list.some((g) => g.id === i.groupId))
  if (rest.length) list.push({ id: '', name: '未分组', builtin: false })
  return list
})

function countOf(groupId) {
  return itemsOf(groupId).length
}

function itemsOf(groupId) {
  const id = groupId || ''
  return items.value.filter((i) => (i.groupId || '') === id)
}

function toggleOpen() {
  open.value = !open.value
}

async function load() {
  loading.value = true
  try {
    const res = await api.regFav.list()
    if (!res.ok) {
      message.error(res.message)
      return
    }
    groups.value = (res.data && res.data.groups) || []
    items.value = (res.data && res.data.items) || []
  } finally {
    loading.value = false
  }
}

function jump(item) {
  if (!item.path) return
  emit('jump', item.path)
}

function openCreate() {
  form.id = ''
  form.name = ''
  form.path = ''
  form.groupId = groups.value.find((g) => !g.builtin)?.id || ''
  form.note = ''
  formOpen.value = true
}

function openEdit(item) {
  form.id = item.id
  form.name = item.name
  form.path = item.path
  form.groupId = item.groupId || ''
  form.note = item.note || ''
  formOpen.value = true
}

function fillCurrent() {
  if (!props.currentPath) return
  form.path = props.currentPath
  if (!form.name) form.name = props.currentPath.split('\\').pop() || props.currentPath
}

async function submitForm() {
  if (!form.name.trim()) {
    message.error('请输入收藏名称')
    return
  }
  if (!form.path.trim()) {
    message.error('请输入注册表路径')
    return
  }
  if (form.id) {
    const res = await api.regFav.update({
      id: form.id,
      name: form.name.trim(),
      groupId: form.groupId || '',
      note: form.note
    })
    if (!res.ok) {
      message.error(res.message)
      return
    }
    message.success('收藏已更新')
  } else {
    const res = await api.regFav.create({
      name: form.name.trim(),
      path: form.path.trim(),
      groupId: form.groupId || '',
      note: form.note
    })
    if (!res.ok) {
      message.error(res.message)
      return
    }
    message.success('收藏已添加')
  }
  formOpen.value = false
  await load()
}

function openRename(item) {
  renameTarget.value = item
  renameValue.value = item.name
  renameOpen.value = true
}

async function submitRename() {
  const target = renameTarget.value
  if (!target) return
  if (!renameValue.value.trim()) {
    message.error('名称不能为空')
    return
  }
  const res = await api.regFav.update({ id: target.id, name: renameValue.value.trim() })
  if (!res.ok) {
    message.error(res.message)
    return
  }
  renameOpen.value = false
  message.success('已重命名')
  await load()
}

function openMove(item) {
  moveTarget.value = item
  moveGroupId.value = item.groupId || undefined
  moveOpen.value = true
}

async function submitMove() {
  const target = moveTarget.value
  if (!target) return
  const res = await api.regFav.update({ id: target.id, groupId: moveGroupId.value || '' })
  if (!res.ok) {
    message.error(res.message)
    return
  }
  moveOpen.value = false
  message.success('已移动分组')
  await load()
}

async function toggleHidden(item) {
  const res = await api.regFav.update({ id: item.id, hidden: !item.hidden })
  if (!res.ok) {
    message.error(res.message)
    return
  }
  message.success(item.hidden ? '已取消隐藏' : '已隐藏（内置收藏不可删除，只能隐藏）')
  await load()
}

async function removeItem(item) {
  const ok = await confirmDanger({
    title: '⚠️ 删除注册表收藏',
    warning: `将删除收藏「${item.name}」，只影响收藏夹记录，不会修改注册表本身。`,
    content: item.path,
    hint: '内置收藏项不能删除，只能隐藏。',
    rows: [{ 名称: item.name, 路径: item.path }],
    columns: [
      { title: '名称', dataIndex: '名称', key: '名称', width: 160, ellipsis: true },
      { title: '路径', dataIndex: '路径', key: '路径', ellipsis: true }
    ]
  })
  if (!ok) return
  const res = await api.regFav.remove({ id: item.id })
  if (!res.ok) {
    message.error(res.message)
    return
  }
  message.success('收藏已删除')
  await load()
}

function openGroupCreate() {
  groupForm.id = ''
  groupForm.name = ''
  groupOpen.value = true
}

function openGroupRename(group) {
  groupForm.id = group.id
  groupForm.name = group.name
  groupOpen.value = true
}

async function submitGroup() {
  if (!groupForm.name.trim()) {
    message.error('分组名称不能为空')
    return
  }
  const res = await api.regFav.groups({
    action: groupForm.id ? 'rename' : 'create',
    id: groupForm.id || undefined,
    name: groupForm.name.trim()
  })
  if (!res.ok) {
    message.error(res.message)
    return
  }
  groupOpen.value = false
  message.success(groupForm.id ? '分组已重命名' : '分组已创建')
  await load()
}

async function removeGroup(group) {
  const ok = await confirmDanger({
    title: '⚠️ 删除收藏分组',
    warning: `将删除分组「${group.name}」，组内收藏会移动到「未分组」，不会删除收藏本身。`,
    hint: '内置分组「系统预设」不可删除。'
  })
  if (!ok) return
  const res = await api.regFav.groups({ action: 'remove', id: group.id })
  if (!res.ok) {
    message.error(res.message)
    return
  }
  message.success('分组已删除')
  await load()
}

async function exportJson() {
  const saved = await api.fs.saveFile({
    title: '导出注册表收藏夹',
    defaultPath: 'registry-favorites.json',
    filters: [{ name: 'JSON 文件', extensions: ['json'] }]
  })
  if (!saved.ok) {
    message.error(saved.message)
    return
  }
  if (!saved.data || saved.data.canceled || !saved.data.path) return
  const res = await api.regFav.exportJson({ file: saved.data.path })
  if (!res.ok) {
    message.error(res.message)
    return
  }
  message.success(`已导出 ${res.data.items} 项收藏`)
  ui.tip(`收藏夹已导出：${res.data.file}`, 'success')
}

async function importJson() {
  const picked = await api.fs.selectFile({
    title: '选择收藏夹 JSON 文件',
    filters: [{ name: 'JSON 文件', extensions: ['json'] }]
  })
  if (!picked.ok) {
    message.error(picked.message)
    return
  }
  if (!picked.data || picked.data.canceled || !picked.data.path) return
  const res = await api.regFav.importJson({ file: picked.data.path, mode: 'merge' })
  if (!res.ok) {
    message.error(res.message)
    return
  }
  const d = res.data || {}
  message.success(`导入完成：新增 ${d.added || 0} 项，更新 ${d.updated || 0} 项，跳过 ${d.skipped || 0} 项`)
  await load()
}

onMounted(load)

defineExpose({ load })
</script>

<style scoped>
.reg-fav {
  border-bottom: 1px solid var(--wem-border);
  padding-bottom: 10px;
  margin-bottom: 10px;
}

.fav-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.fav-body {
  margin-top: 8px;
  max-height: 300px;
  overflow: auto;
}

.fav-group + .fav-group {
  margin-top: 10px;
}

.fav-group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 2px 0 4px;
  flex-wrap: wrap;
}

.fav-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 6px;
  transition: background 0.14s ease;
}

.fav-item:hover {
  background: var(--wem-card-alt);
}

.fav-item-main {
  min-width: 0;
  flex: 1;
}

.fav-name {
  display: block;
  font-weight: 600;
  font-size: 12.5px;
  color: var(--wem-text);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fav-name:hover {
  color: var(--wem-primary);
}

.fav-name.hidden {
  color: var(--wem-text-3);
  text-decoration: line-through;
}

.fav-path {
  display: block;
  font-size: 11px;
  color: var(--wem-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fav-note {
  font-size: 11px;
  color: var(--wem-text-3);
  margin-top: 2px;
}

.fav-actions {
  flex: 0 0 auto;
  font-size: 12px;
  white-space: nowrap;
}

.fav-actions :deep(a) {
  font-size: 12px;
}

.fav-empty {
  font-size: 11.5px;
  color: var(--wem-text-3);
  padding: 4px 8px;
}

.danger-link {
  color: var(--wem-danger);
}
</style>
