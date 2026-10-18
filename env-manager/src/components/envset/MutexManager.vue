<template>
  <div class="wem-card">
    <div class="wem-card-head">
      <div class="wem-card-title"><BlockOutlined /> 互斥组</div>
      <div class="toolbar">
        <a-button type="primary" size="small" @click="addGroup">新建组</a-button>
        <a-button size="small" danger :disabled="!current" @click="removeGroup">删除组</a-button>
      </div>
    </div>
    <div class="wem-card-body">
      <div class="hint-box" style="margin-bottom: 12px">
        <InfoCircleOutlined />
        <div>一个配置集只能加入一个组。删除组不会删除配置集，也不会改系统环境。设为激活会把该套加载到草稿，并按互斥规则处理同组其它草稿；不会直接写入注册表。</div>
      </div>

      <div v-if="!groups.length" class="empty-block">还没有互斥组。新建后，从左侧把配置集加入右侧。</div>

      <div v-else class="mx-layout">
        <div class="mx-groups">
          <button
            v-for="g in groups"
            :key="g.id"
            type="button"
            class="mx-group"
            :class="{ on: g.id === currentId }"
            @click="currentId = g.id"
          >
            <span class="cell-name">{{ g.name || '未命名组' }}</span>
            <span class="text-muted">{{ g.memberIds.length }} 个配置集</span>
          </button>
        </div>

        <div v-if="current" class="mx-main">
          <div class="proj-fields">
            <div class="proj-field">
              <span class="text-muted">名称</span>
              <a-input v-model:value="current.name" size="small" style="width: 220px" @blur="emitChange" />
            </div>
            <div class="proj-field">
              <span class="text-muted">备注</span>
              <a-input v-model:value="current.remark" size="small" style="width: 280px" @blur="emitChange" />
            </div>
            <div class="proj-field">
              <span class="text-muted">切换前自动快照</span>
              <a-switch v-model:checked="current.autoSnapshot" @change="emitChange" />
              <span class="text-muted">校验路径</span>
              <a-switch v-model:checked="current.validatePath" @change="emitChange" />
            </div>
          </div>

          <div class="mx-transfer">
            <div class="mx-col">
              <div class="mx-col-title">未在本组</div>
              <div class="mx-list">
                <div
                  v-for="s in outside"
                  :key="s.id"
                  class="mx-item"
                  :class="{ on: pickedLeft === s.id, locked: !!ownerOf(s.id) }"
                  @click="pickedLeft = s.id"
                >
                  <span>{{ s.name || s.id }}</span>
                  <a-tag v-if="ownerOf(s.id)" color="orange">{{ ownerOf(s.id).name }}</a-tag>
                </div>
                <div v-if="!outside.length" class="empty-block">没有可加入的配置集</div>
              </div>
            </div>

            <div class="mx-ops">
              <a-button size="small" type="primary" :disabled="!pickedLeft" @click="addMember">加入</a-button>
              <a-button size="small" :disabled="!pickedRight" @click="removeMember">移出</a-button>
            </div>

            <div class="mx-col">
              <div class="mx-col-title">本组配置集</div>
              <div class="mx-list">
                <div
                  v-for="s in members"
                  :key="s.id"
                  class="mx-item"
                  :class="{ on: pickedRight === s.id }"
                  @click="pickedRight = s.id"
                >
                  <span>{{ s.name || s.id }}</span>
                  <a-button
                    size="small"
                    type="link"
                    @click.stop="activate(s.id)"
                  >{{ current.activeId === s.id ? '当前激活' : '设为激活' }}</a-button>
                </div>
                <div v-if="!members.length" class="empty-block">从左侧加入</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { Modal, message } from 'ant-design-vue'
import { BlockOutlined, InfoCircleOutlined } from '@ant-design/icons-vue'

const props = defineProps({
  sets: { type: Array, default: () => [] }
})

const emit = defineEmits(['change', 'activate'])

const groups = ref([])
const currentId = ref('')
const pickedLeft = ref('')
const pickedRight = ref('')
const seeded = ref(false)

const current = computed(() => groups.value.find((g) => g.id === currentId.value) || null)
const setList = computed(() => (Array.isArray(props.sets) ? props.sets.filter((s) => s && s.id) : []))
const members = computed(() => {
  if (!current.value) return []
  return current.value.memberIds
    .map((id) => setList.value.find((s) => s.id === id))
    .filter(Boolean)
})
const outside = computed(() => {
  if (!current.value) return []
  const mine = new Set(current.value.memberIds)
  return setList.value.filter((s) => !mine.has(s.id))
})

watch(setList, (list) => reconcile(list), { immediate: true })

function clone(v) {
  return JSON.parse(JSON.stringify(v))
}

function blankGroup(id, name) {
  return {
    id,
    name: name || '未命名互斥组',
    remark: '',
    memberIds: [],
    autoSnapshot: true,
    validatePath: true,
    activeId: ''
  }
}

function reconcile(list) {
  const ids = new Set(list.map((s) => s.id))
  if (!seeded.value) {
    const map = new Map()
    list.forEach((s) => {
      if (!s.groupId) return
      if (!map.has(s.groupId)) {
        map.set(s.groupId, blankGroup(s.groupId, s.groupName || `互斥组 ${map.size + 1}`))
      }
      const g = map.get(s.groupId)
      if (!g.memberIds.includes(s.id)) g.memberIds.push(s.id)
    })
    groups.value = [...map.values()]
    currentId.value = groups.value[0] ? groups.value[0].id : ''
    seeded.value = true
    return
  }
  groups.value.forEach((g) => {
    g.memberIds = g.memberIds.filter((id) => ids.has(id))
    if (g.activeId && !g.memberIds.includes(g.activeId)) g.activeId = ''
  })
  const placed = new Set(groups.value.flatMap((g) => g.memberIds))
  list.forEach((s) => {
    if (!s.groupId || placed.has(s.id)) return
    let g = groups.value.find((x) => x.id === s.groupId)
    if (!g) {
      g = blankGroup(s.groupId, s.groupName || '互斥组')
      groups.value.push(g)
    }
    if (!g.memberIds.includes(s.id)) g.memberIds.push(s.id)
    placed.add(s.id)
  })
  if (!groups.value.some((g) => g.id === currentId.value)) currentId.value = groups.value[0] ? groups.value[0].id : ''
}

function ownerOf(id) {
  return groups.value.find((g) => g.memberIds.includes(id)) || null
}

function emitChange() {
  emit('change', clone(groups.value))
}

function addGroup() {
  const id = `mg-${Date.now().toString(36)}`
  groups.value.push(blankGroup(id, `互斥组 ${groups.value.length + 1}`))
  currentId.value = id
  pickedLeft.value = ''
  pickedRight.value = ''
  emitChange()
}

function removeGroup() {
  const g = current.value
  if (!g) return
  Modal.confirm({
    title: '删除互斥组',
    content: `删除「${g.name}」只解散分组，组里的配置集都会保留。不会删除配置集，也不会改系统环境。`,
    okText: '删除组',
    okType: 'danger',
    cancelText: '取消',
    onOk() {
      groups.value = groups.value.filter((x) => x.id !== g.id)
      currentId.value = groups.value[0] ? groups.value[0].id : ''
      pickedRight.value = ''
      emitChange()
    }
  })
}

function addMember() {
  const g = current.value
  const id = pickedLeft.value
  if (!g || !id) return
  const owner = ownerOf(id)
  if (owner && owner.id !== g.id) {
    message.warning(`「${setName(id)}」已在「${owner.name}」。一个配置集只能在一个组，请先从那一组移出。`)
    return
  }
  if (!g.memberIds.includes(id)) g.memberIds.push(id)
  pickedLeft.value = ''
  emitChange()
}

function removeMember() {
  const g = current.value
  const id = pickedRight.value
  if (!g || !id) return
  g.memberIds = g.memberIds.filter((x) => x !== id)
  if (g.activeId === id) g.activeId = ''
  pickedRight.value = ''
  emitChange()
  message.info('已移出本组。配置集还在，系统环境没有改动。')
}

function setName(id) {
  const hit = setList.value.find((s) => s.id === id)
  return (hit && hit.name) || id
}

function activate(setId) {
  const g = current.value
  if (!g || !g.memberIds.includes(setId) || g.activeId === setId) return
  const previousId = g.activeId || ''
  emit('activate', { groupId: g.id, setId, previousId })
}

function markActive(setId) {
  for (const g of groups.value) {
    if (g.memberIds.includes(setId)) g.activeId = setId
  }
}

defineExpose({ markActive })
</script>

<style scoped>
.proj-fields { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.proj-field { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mx-layout { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 12px; }
.mx-groups { display: flex; flex-direction: column; gap: 6px; }
.mx-group {
  text-align: left;
  border: 1px solid var(--wem-border);
  background: var(--wem-card-alt);
  border-radius: 8px;
  padding: 8px 10px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mx-group.on { border-color: #165DFF; background: rgba(22, 93, 255, 0.08); }
.mx-transfer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  gap: 8px;
  align-items: stretch;
}
.mx-col { min-width: 0; }
.mx-col-title { font-weight: 600; margin-bottom: 6px; }
.mx-list {
  border: 1px solid var(--wem-border);
  border-radius: 8px;
  min-height: 180px;
  max-height: 280px;
  overflow: auto;
  background: var(--wem-card);
}
.mx-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  cursor: pointer;
  border-bottom: 1px solid var(--wem-border);
}
.mx-item.on { background: rgba(22, 93, 255, 0.1); }
.mx-item.locked { color: var(--wem-text-3); }
.mx-ops { display: flex; flex-direction: column; justify-content: center; gap: 8px; }
@media (max-width: 900px) {
  .mx-layout, .mx-transfer { grid-template-columns: minmax(0, 1fr); }
  .mx-ops { flex-direction: row; }
}
</style>
