<template>
  <div class="reg-tree">
    <a-spin :spinning="rootLoading">
      <a-tree
        v-if="treeData.length"
        block-node
        :tree-data="treeData"
        :expanded-keys="expandedKeys"
        :selected-keys="selected ? [selected] : []"
        :show-line="false"
        @expand="onExpand"
        @select="onSelect"
      >
        <template #title="node">
          <span class="tree-label" :class="{ 'is-env': meta(node).isEnv, 'is-error': !!meta(node).error }">
            <span class="tree-text">{{ meta(node).label }}</span>
            <a-tag v-if="meta(node).isEnv" color="blue" class="tree-tag">环境变量</a-tag>
            <a-tag v-if="meta(node).loading" class="tree-tag">加载中</a-tag>
            <a-tooltip v-if="meta(node).error" :title="meta(node).error">
              <a-tag color="red" class="tree-tag">无法读取</a-tag>
            </a-tooltip>
          </span>
        </template>
      </a-tree>
      <a-empty v-else description="没有可用的注册表根项" />
    </a-spin>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import api from '@/api'

const props = defineProps({
  roots: { type: Array, default: () => [] },
  selected: { type: String, default: '' }
})

const emit = defineEmits(['select', 'loaded'])

/** path -> { path, name, isEnv, hasChildren, isLeaf, children: [], loaded, loading, error } */
const nodes = reactive({})
const expandedKeys = ref([])
const rootLoading = ref(false)

const treeData = computed(() => props.roots.map((root) => buildNode(root.key, root.label)).filter(Boolean))

function buildNode(path, fallbackLabel) {
  const node = nodes[path]
  if (!node) return null
  const out = {
    key: path,
    label: node.name || fallbackLabel || path,
    title: node.name || fallbackLabel || path,
    isEnv: !!node.isEnv,
    isLeaf: !!node.isLeaf,
    loading: !!node.loading,
    error: node.error || ''
  }
  if (!node.isLeaf && node.loaded) {
    out.children = node.children.map((child) => buildNode(child)).filter(Boolean)
  }
  return out
}

watch(
  () => props.roots,
  (roots) => {
    ;(roots || []).forEach((root) => {
      if (!nodes[root.key]) {
        nodes[root.key] = {
          path: root.key,
          name: root.label,
          isEnv: false,
          hasChildren: true,
          isLeaf: false,
          children: [],
          loaded: false,
          loading: false,
          error: ''
        }
      }
    })
  },
  { immediate: true, deep: true }
)

function ensureNode(path, name, hasChildren, isEnv) {
  if (!nodes[path]) {
    nodes[path] = {
      path,
      name,
      isEnv: !!isEnv,
      hasChildren: !!hasChildren,
      isLeaf: !hasChildren,
      children: [],
      loaded: false,
      loading: false,
      error: ''
    }
  }
  return nodes[path]
}

/** 展开时才真正读取子项，避免一次性把整棵注册表拉下来 */
async function ensureLoaded(path) {
  let node = nodes[path]
  if (!node) {
    // 定位时可能早于根节点注册完成，这里按根项列表补建
    const root = (props.roots || []).find((r) => r.key === path)
    if (!root) return
    node = ensureNode(path, root.label, true, false)
  }
  if (node.loading) return
  if (node.loaded) return
  node.loading = true
  node.error = ''
  const res = await api.reg.subKeys(path)
  node.loading = false
  node.loaded = true
  if (!res.ok) {
    node.error = res.message || '读取失败'
    node.isLeaf = true
    message.warning(`读取 ${path} 失败：${node.error}`)
    return
  }
  const list = Array.isArray(res.data) ? res.data : []
  node.children = list.map((item) => {
    ensureNode(item.fullPath, item.name, item.hasChildren, item.isEnv)
    return item.fullPath
  })
  node.isLeaf = list.length === 0
  emit('loaded', path)
}

/** a-tree 槽位在不同版本里给的是 node 本身或 node.dataRef，这里统一取值 */
function meta(node) {
  const src = (node && node.dataRef) || node || {}
  return {
    label: src.label || src.title || src.name || '',
    isEnv: !!src.isEnv,
    loading: !!src.loading,
    error: src.error || ''
  }
}

async function onExpand(keys, info) {
  expandedKeys.value = keys
  if (!info || !info.expanded) return
  await ensureLoaded(info.node.key)
}

function onSelect(keys) {
  if (!keys || !keys.length) return
  emit('select', keys[0])
}

/** 依次加载各级祖先并展开，最后选中目标路径 */
async function expandTo(path) {
  if (!path) return
  const parts = String(path).split('\\').filter(Boolean)
  if (!parts.length) return
  const prefixes = []
  for (let i = 1; i <= parts.length; i += 1) prefixes.push(parts.slice(0, i).join('\\'))
  for (const prefix of prefixes) {
    await ensureLoaded(prefix)
    if (!expandedKeys.value.includes(prefix)) expandedKeys.value = [...expandedKeys.value, prefix]
  }
  // 选中状态由父组件的 selected prop 驱动，这里不再 emit，避免重复触发键值加载
}

/** 重建整棵树（刷新） */
async function refresh() {
  const keep = props.selected
  rootLoading.value = true
  Object.keys(nodes).forEach((key) => { delete nodes[key] })
  expandedKeys.value = []
  ;(props.roots || []).forEach((root) => {
    nodes[root.key] = {
      path: root.key,
      name: root.label,
      isEnv: false,
      hasChildren: true,
      isLeaf: false,
      children: [],
      loaded: false,
      loading: false,
      error: ''
    }
  })
  rootLoading.value = false
  if (keep) await expandTo(keep)
}

/** 某路径下的子项在外部发生变化后，只重载这一级 */
function invalidate(path) {
  const node = nodes[path]
  if (!node) return
  node.loaded = false
  node.children = []
  if (expandedKeys.value.includes(path)) ensureLoaded(path)
}

defineExpose({ expandTo, refresh, invalidate })
</script>

<style scoped>
.reg-tree {
  max-height: 420px;
  overflow: auto;
  padding-right: 2px;
}

.reg-tree :deep(.ant-tree) {
  background: transparent;
  font-size: calc(var(--wem-fs) - 0.5px);
}

.reg-tree :deep(.ant-tree-node-content-wrapper) {
  border-radius: 6px;
  overflow: hidden;
}

.tree-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
}

.tree-text {
  overflow: hidden;
  text-overflow: ellipsis;
}

.tree-label.is-env .tree-text {
  color: var(--wem-primary);
  font-weight: 700;
}

.tree-label.is-error .tree-text {
  color: var(--wem-danger);
}

.tree-tag {
  margin-inline-end: 0;
  font-size: 10px;
  line-height: 16px;
  padding: 0 5px;
}
</style>
