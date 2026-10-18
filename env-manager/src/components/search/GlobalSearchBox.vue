<template>
  <div ref="root" class="gsb">
    <div class="gsb-bar">
      <a-dropdown :trigger="['click']">
        <a-button size="small">搜索范围</a-button>
        <template #overlay>
          <div class="gsb-sources" @click.stop>
            <a-checkbox
              v-for="g in groups"
              :key="g.type"
              :checked="enabled[g.type] !== false"
              @change="(e) => toggleSource(g.type, e.target.checked)"
            >{{ g.label }}</a-checkbox>
          </div>
        </template>
      </a-dropdown>
      <a-input-search
        v-model:value="q"
        class="gsb-input"
        placeholder="全局搜索：变量名、配置集、快照、开发工具、日志"
        allow-clear
        @change="schedule"
        @search="onSearchClick"
        @focus="openPanel"
      />
    </div>
    <div class="text-muted gsb-delay">输入停止 {{ delay }} ms 后搜索。点搜索按钮或点一条结果才记入历史。</div>

    <div v-show="panelOpen" class="gsb-pop">
      <template v-if="q.trim()">
        <div v-if="!anyEnabled" class="empty-block">请至少勾选一个分组</div>
        <div v-else-if="!hitCount" class="empty-block">没有匹配「{{ q.trim() }}」</div>
        <div v-for="g in visibleGroups" :key="g.type" class="gsb-group">
          <div class="gsb-group-title">{{ g.label }}（{{ g.items.length }}）</div>
          <button
            v-for="(item, i) in g.items.slice(0, 8)"
            :key="i"
            type="button"
            class="gsb-hit"
            @click="pick(g.type, item)"
          >
            <span class="gsb-hit-name"><HitText :text="labelOf(item)" :kw="q" /></span>
            <span v-if="subOf(item)" class="gsb-hit-sub"><HitText :text="subOf(item)" :kw="q" /></span>
          </button>
          <div v-if="g.items.length > 8" class="text-muted gsb-more">还有 {{ g.items.length - 8 }} 条，请缩小关键词</div>
        </div>
      </template>

      <div class="gsb-history">
        <div class="gsb-group-title">
          <span>最近搜索</span>
          <a v-if="history.length" @click="clearHistory">清空</a>
        </div>
        <div v-if="!history.length" class="text-muted">还没有搜索历史</div>
        <div v-for="item in history" :key="item" class="gsb-hist">
          <button type="button" class="gsb-hist-text" @click="useHistory(item)">{{ item }}</button>
          <a @click="removeHistory(item)">删除</a>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, defineComponent, h, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { message } from 'ant-design-vue'

const HitText = defineComponent({
  name: 'HitText',
  props: { text: { type: String, default: '' }, kw: { type: String, default: '' } },
  setup(props) {
    return () => {
      const parts = splitHit(props.text, props.kw)
      return h('span', parts.map((p, i) => p.hit
        ? h('mark', { class: 'gsb-mark', key: i }, p.t)
        : h('span', { key: i }, p.t)))
    }
  }
})

const props = defineProps({
  sources: { type: Object, default: () => ({}) }
})

const emit = defineEmits(['pick'])

const LS_HIST = 'wem-search-history'
const LS_SRC = 'wem-search-sources'
const LS_SET = 'wem-search-settings'
const FIELDS = ['name', 'title', 'key', 'value', 'remark', 'comment', 'note', 'path', 'action', 'category']

const groups = [
  { type: 'vars', label: '环境变量' },
  { type: 'sets', label: '配置集' },
  { type: 'snaps', label: '快照' },
  { type: 'tools', label: '开发工具' },
  { type: 'rules', label: '识别规则' },
  { type: 'audits', label: '日志' }
]

const root = ref(null)
const q = ref('')
const panelOpen = ref(false)
const delay = ref(200)
const history = ref(readHistory())
const enabled = reactive(readSources())
const hits = ref({})
let timer = 0

const anyEnabled = computed(() => groups.some((g) => enabled[g.type] !== false))
const visibleGroups = computed(() => groups
  .filter((g) => enabled[g.type] !== false)
  .map((g) => ({ ...g, items: hits.value[g.type] || [] }))
  .filter((g) => g.items.length))
const hitCount = computed(() => visibleGroups.value.reduce((n, g) => n + g.items.length, 0))

watch(() => props.sources, () => run(false), { deep: true })

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw)
  } catch (_) {
    return fallback
  }
}

function readDelay() {
  const s = readJson(LS_SET, {})
  const n = Number(s && s.searchDelay)
  return Number.isFinite(n) && n >= 0 ? n : 200
}

function historyLimit() {
  const s = readJson(LS_SET, {})
  if (s && s.saveHistory === false) return 0
  const n = Number(s && s.historyMax)
  if (!Number.isFinite(n) || n <= 0) return 20
  return Math.min(50, Math.max(1, Math.floor(n)))
}

function readHistory() {
  const limit = historyLimit()
  if (!limit) return []
  const arr = readJson(LS_HIST, [])
  return Array.isArray(arr) ? arr.map((x) => String(x)).filter(Boolean).slice(0, limit) : []
}

function readSources() {
  const saved = readJson(LS_SRC, {})
  const out = {}
  groups.forEach((g) => { out[g.type] = saved[g.type] !== false })
  return out
}

function writeHistory(list) {
  const limit = historyLimit()
  if (!limit) {
    history.value = []
    return
  }
  history.value = list.slice(0, limit)
  try { localStorage.setItem(LS_HIST, JSON.stringify(history.value)) } catch (_) { /* 忽略写入失败 */ }
}

function pushHistory(text) {
  if (!historyLimit()) return
  const t = String(text || '').trim()
  if (!t) return
  writeHistory([t, ...history.value.filter((x) => x !== t)])
}

function openPanel() {
  history.value = readHistory()
  panelOpen.value = true
}

function toggleSource(type, on) {
  enabled[type] = !!on
  try { localStorage.setItem(LS_SRC, JSON.stringify({ ...enabled })) } catch (_) { /* 忽略 */ }
  run(false)
}

function labelOf(item) {
  if (!item || typeof item !== 'object') return String(item ?? '')
  return String(item.name || item.title || item.key || '(未命名)')
}

function subOf(item) {
  if (!item || typeof item !== 'object') return ''
  const v = item.value || item.path || item.remark || item.comment || item.note || item.action || ''
  return v == null ? '' : String(v)
}

function blobOf(item) {
  if (item == null) return ''
  if (typeof item !== 'object') return String(item)
  return FIELDS.map((k) => item[k]).filter((v) => v != null && v !== '').join('\n')
}

function run(record) {
  delay.value = readDelay()
  const kw = q.value.trim().toLowerCase()
  const next = {}
  groups.forEach((g) => {
    const list = Array.isArray(props.sources && props.sources[g.type]) ? props.sources[g.type] : []
    if (!kw || enabled[g.type] === false) { next[g.type] = []; return }
    next[g.type] = list.filter((item) => blobOf(item).toLowerCase().includes(kw))
  })
  hits.value = next
  if (record && kw) pushHistory(kw)
}

function schedule() {
  panelOpen.value = true
  window.clearTimeout(timer)
  delay.value = readDelay()
  timer = window.setTimeout(() => run(false), delay.value)
}

function onSearchClick(_value, ev) {
  if (ev && ev.type && ev.type !== 'click') return
  window.clearTimeout(timer)
  panelOpen.value = true
  run(true)
}

function useHistory(text) {
  q.value = text
  panelOpen.value = true
  window.clearTimeout(timer)
  run(false)
  pushHistory(text)
}

function removeHistory(text) {
  writeHistory(history.value.filter((x) => x !== text))
}

function clearHistory() {
  history.value = []
  try { localStorage.setItem(LS_HIST, '[]') } catch (_) { /* 忽略写入失败 */ }
  message.success('已清空搜索历史')
}

function pick(type, item) {
  pushHistory(q.value)
  emit('pick', { type, item })
  panelOpen.value = false
}

function onDoc(e) {
  if (!root.value || root.value.contains(e.target)) return
  panelOpen.value = false
}

function splitHit(text, kw) {
  const raw = String(text ?? '')
  const needle = String(kw || '').trim()
  if (!needle) return [{ t: raw, hit: false }]
  const lower = raw.toLowerCase()
  const n = needle.toLowerCase()
  const out = []
  let i = 0
  while (i < raw.length) {
    const j = lower.indexOf(n, i)
    if (j < 0) { out.push({ t: raw.slice(i), hit: false }); break }
    if (j > i) out.push({ t: raw.slice(i, j), hit: false })
    out.push({ t: raw.slice(j, j + n.length), hit: true })
    i = j + n.length || i + 1
  }
  return out.filter((p) => p.t)
}

onMounted(() => document.addEventListener('mousedown', onDoc))
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDoc)
  window.clearTimeout(timer)
})
</script>

<style scoped>
.gsb { position: relative; min-width: 280px; }
.gsb-bar { display: flex; gap: 8px; align-items: center; }
.gsb-input { flex: 1; min-width: 0; }
.gsb-delay { margin-top: 4px; font-size: 12px; }
.gsb-pop {
  position: absolute;
  z-index: 30;
  left: 0;
  right: 0;
  top: calc(100% - 18px);
  margin-top: 4px;
  background: var(--wem-card);
  border: 1px solid var(--wem-border);
  border-radius: 10px;
  box-shadow: var(--wem-shadow-lg);
  max-height: 360px;
  overflow: auto;
  padding: 6px 0;
}
.gsb-sources {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  background: var(--wem-card);
  border-radius: 8px;
  min-width: 140px;
}
.gsb-group-title {
  display: flex;
  justify-content: space-between;
  padding: 6px 12px 2px;
  font-size: 12px;
  color: var(--wem-text-3);
}
.gsb-hit, .gsb-hist-text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  text-align: left;
  border: 0;
  background: transparent;
  padding: 6px 12px;
  cursor: pointer;
  color: var(--wem-text);
}
.gsb-hit:hover, .gsb-hist-text:hover { background: rgba(22, 93, 255, 0.08); }
.gsb-hit-name { font-weight: 600; }
.gsb-hit-sub {
  color: var(--wem-text-3);
  font-family: var(--wem-mono);
  font-size: 12px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gsb-more { padding: 0 12px 6px; }
.gsb-hist { display: flex; align-items: center; gap: 8px; padding-right: 12px; }
.gsb-hist-text { flex: 1; width: auto; }
:deep(.gsb-mark) {
  background: rgba(22, 93, 255, 0.18);
  color: inherit;
  padding: 0 1px;
}
</style>
