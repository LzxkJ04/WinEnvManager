<template>
  <div>
    <!-- 统计卡片 -->
    <div class="stat-grid">
      <div class="stat-card" @click="$router.push('/user')">
        <div class="stat-label"><UserOutlined /> 用户变量</div>
        <div class="stat-value" style="color: #165dff">{{ env.counts.user }}</div>
        <div class="stat-extra" title="HKCU\Environment">仅当前登录用户</div>
      </div>
      <div class="stat-card" @click="$router.push('/system')">
        <div class="stat-label"><ClusterOutlined /> 系统变量</div>
        <div class="stat-value" style="color: #722ed1">{{ env.counts.machine }}</div>
        <div class="stat-extra" title="HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment">写入需管理员</div>
      </div>
      <div class="stat-card">
        <div class="stat-label"><DatabaseOutlined /> 变量总数</div>
        <div class="stat-value">{{ env.counts.total }}</div>
        <div class="stat-extra">上次读取 {{ readAtText }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label"><ExclamationCircleOutlined /> 未保存修改</div>
        <div class="stat-value" :style="{ color: env.dirty ? '#f53f3f' : '#00b42a' }">
          {{ env.pendingCount }}
        </div>
        <div class="stat-extra">{{ env.dirty ? '点击顶部「保存写入系统」提交' : '内存与系统一致' }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label"><SafetyCertificateOutlined /> 当前权限</div>
        <div class="stat-value" :style="{ fontSize: '18px', color: env.admin ? '#00b42a' : '#ff7d00' }">
          {{ env.admin ? '管理员' : '普通用户' }}
        </div>
        <div class="stat-extra">{{ env.admin ? '可读写系统变量' : '系统变量只读，可提权' }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label"><TagOutlined /> 收藏 / 敏感</div>
        <div class="stat-value" style="font-size: 18px">
          {{ favCount }} <span style="color:var(--wem-text-3)">/</span>
          <span style="color:#fa541c">{{ sensitiveCount }}</span>
        </div>
        <div class="stat-extra" title="收藏变量 / 疑似含密钥变量">收藏 / 疑似密钥</div>
      </div>
    </div>

    <!-- 环境健康 -->
    <div class="wem-card" style="margin-top: 14px">
      <div class="wem-card-head">
        <div class="wem-card-title"><SafetyCertificateOutlined /> 环境健康</div>
        <div class="toolbar">
          <a-button size="small" :disabled="!health" @click="copyHealthReport">复制报告</a-button>
          <a-button size="small" :loading="healthLoading" @click="runHealth">重新检查</a-button>
        </div>
      </div>
      <div class="wem-card-body">
        <div v-if="!health" class="text-muted">{{ healthLoading ? '正在检查同名遮蔽、断裂引用、循环引用和 PATH…' : '尚未检查' }}</div>
        <template v-else>
          <div class="health-grid">
            <div class="health-item" :class="health.shadowN ? 'bad' : 'ok'" @click="openHealth('shadow')">同名遮蔽 <b>{{ health.shadowN }}</b></div>
            <div class="health-item" :class="health.dupN ? 'warn' : 'ok'" @click="openHealth('dup')">同名冗余 <b>{{ health.dupN }}</b></div>
            <div class="health-item" :class="health.brokenN ? 'bad' : 'ok'" @click="openHealth('broken')">断裂引用 <b>{{ health.brokenN }}</b></div>
            <div class="health-item" :class="health.cycleN ? 'bad' : 'ok'" @click="openHealth('cycle')">循环引用 <b>{{ health.cycleN }}</b></div>
            <div class="health-item" :class="health.invalid ? 'warn' : 'ok'" @click="openHealth('invalid')">PATH 失效 <b>{{ health.invalid }}</b></div>
          </div>
          <ul v-if="health.lines.length" class="risk-list">
            <li v-for="(line, i) in health.lines" :key="i">{{ line }}</li>
          </ul>
          <div v-else class="text-muted">未发现遮蔽、断裂引用或循环引用。PATH 失效条目 {{ health.invalid }} 条。</div>
        </template>
      </div>
    </div>

    <!-- 快捷操作 -->
    <div class="wem-card" style="margin-top: 14px">
      <div class="wem-card-head">
        <div class="wem-card-title"><ThunderboltOutlined /> 快捷操作</div>
        <span class="text-muted">全部为鼠标点击操作，无快捷键</span>
      </div>
      <div class="wem-card-body">
        <a-space :size="10" wrap>
          <a-button :loading="env.loading" @click="reload">
            <template #icon><ReloadOutlined /></template>
            重新读取环境变量
          </a-button>
          <a-button @click="quickSnapshot">
            <template #icon><CameraOutlined /></template>
            立即创建快照
          </a-button>
          <a-button @click="quickBackup">
            <template #icon><SaveOutlined /></template>
            一键完整备份
          </a-button>
          <a-button @click="restartExplorer">
            <template #icon><InteractionOutlined /></template>
            重启资源管理器
          </a-button>
          <a-button @click="$router.push('/path')">
            <template #icon><NodeIndexOutlined /></template>
            PATH 路径管理
          </a-button>
          <a-button @click="scanSensitive">
            <template #icon><KeyOutlined /></template>
            密钥/敏感值检测
          </a-button>
          <a-button @click="scanBrokenRefs">
            <template #icon><ApiOutlined /></template>
            断裂引用检测
          </a-button>
          <a-button @click="pathPerf">
            <template #icon><DashboardOutlined /></template>
            PATH 性能检测
          </a-button>
          <a-button @click="staleOpen = true">
            <template #icon><ClockCircleOutlined /></template>
            僵尸变量清理
          </a-button>
          <a-button v-if="!env.admin" type="primary" ghost @click="elevate">
            <template #icon><RocketOutlined /></template>
            以管理员身份重启
          </a-button>
        </a-space>
      </div>
    </div>

    <!-- 概览筛选 -->
    <div class="toolbar" style="margin-top: 14px">
      <a-input
        v-model:value="previewQuery"
        allow-clear
        size="small"
        placeholder="按名称或值筛选下方两张表"
        style="width: min(280px, 100%)"
      />
      <a-checkbox v-model:checked="onlyShadow">只看被遮蔽的同名变量</a-checkbox>
      <span v-if="shadowNames.size" class="text-muted">当前 {{ shadowNames.size }} 个用户变量覆盖了系统同名值</span>
    </div>

    <!-- 环境变量概览表 -->
    <div class="split-2" style="margin-top: 10px">
      <div class="wem-card">
        <div class="wem-card-head">
          <div class="wem-card-title">
            <UserOutlined /> 用户变量
            <span class="text-muted" style="font-weight: 400">共 {{ env.counts.user }} 个</span>
          </div>
          <div class="toolbar">
            <a-radio-group v-model:value="previewFilter" size="small" button-style="solid">
              <a-radio-button value="all">全部</a-radio-button>
              <a-radio-button value="fav">仅收藏</a-radio-button>
              <a-radio-button value="sensitive">仅敏感</a-radio-button>
            </a-radio-group>
            <a @click="$router.push('/user')">前往管理 →</a>
          </div>
        </div>
        <div class="wem-card-body tight">
          <WemTable
            table-id="overview-user"
            row-key="name"
            :rows="userPreview"
            :columns="previewColumns"
            :page-size="8"
            :capabilities="previewCaps"
            empty-text="没有匹配的用户变量"
          >
            <template #cell="{ row, column }">
              <template v-if="column.key === 'name'">
                <span class="cell-name">{{ row.name }}</span>
                <a-tag v-if="isShadowed(row.name)" color="red" style="margin-left: 6px">覆盖系统</a-tag>
              </template>
              <template v-else-if="column.key === 'value'">
                <span class="cell-value">{{ clip(row.value) }}</span>
              </template>
              <template v-else-if="column.key === 'source'">
                <a-tag :color="sourceColor(metaOf(row.name).source || 'system-native')">
                  {{ sourceText(metaOf(row.name).source) }}
                </a-tag>
              </template>
              <template v-else-if="column.key === 'flags'">
                <a-tag v-if="metaOf(row.name).favorite" color="pink">收藏</a-tag>
                <a-tag v-if="metaOf(row.name).sensitive" color="volcano">敏感</a-tag>
                <a-tag v-if="metaOf(row.name).locked" color="gold">锁定</a-tag>
              </template>
            </template>
          </WemTable>
        </div>
      </div>

      <div class="wem-card">
        <div class="wem-card-head">
          <div class="wem-card-title"><ClusterOutlined /> 系统变量
            <span class="text-muted" style="font-weight: 400">共 {{ env.counts.machine }} 个</span>
          </div>
          <div class="toolbar">
            <a-radio-group v-model:value="previewFilter" size="small" button-style="solid">
              <a-radio-button value="all">全部</a-radio-button>
              <a-radio-button value="fav">仅收藏</a-radio-button>
              <a-radio-button value="sensitive">仅敏感</a-radio-button>
            </a-radio-group>
            <a @click="$router.push('/system')">前往管理 →</a>
          </div>
        </div>
        <div class="wem-card-body tight">
          <WemTable
            table-id="overview-machine"
            row-key="name"
            :rows="machinePreview"
            :columns="previewColumns"
            :page-size="8"
            :capabilities="previewCaps"
            empty-text="没有匹配的系统变量"
          >
            <template #cell="{ row, column }">
              <template v-if="column.key === 'name'">
                <span class="cell-name">{{ row.name }}</span>
                <a-tag v-if="isShadowed(row.name)" color="orange" style="margin-left: 6px">被用户覆盖</a-tag>
              </template>
              <template v-else-if="column.key === 'value'">
                <span class="cell-value">{{ clip(row.value) }}</span>
              </template>
              <template v-else-if="column.key === 'source'">
                <a-tag :color="sourceColor(metaOf(row.name).source || 'system-native')">
                  {{ sourceText(metaOf(row.name).source) }}
                </a-tag>
              </template>
              <template v-else-if="column.key === 'flags'">
                <a-tag v-if="metaOf(row.name).favorite" color="pink">收藏</a-tag>
                <a-tag v-if="metaOf(row.name).sensitive" color="volcano">敏感</a-tag>
                <a-tag v-if="metaOf(row.name).locked" color="gold">锁定</a-tag>
              </template>
            </template>
          </WemTable>
        </div>
      </div>
    </div>

    <!-- 风险提示 -->
    <div class="wem-card" style="margin-top: 14px">
      <div class="wem-card-head">
        <div class="wem-card-title"><WarningOutlined /> 使用须知与已知风险</div>
      </div>
      <div class="wem-card-body">
        <div class="hint-box warn" style="margin-bottom: 10px">
          <WarningOutlined />
          <div>
            <strong>杀毒软件拦截提示：</strong>本工具通过系统 reg.exe / PowerShell 读写注册表，部分安全软件会拦截这类操作。
            若出现写入失败，请将本程序加入白名单，或暂时关闭实时防护后重试。
          </div>
        </div>
        <ul class="risk-list">
          <li>修改系统变量后，已经运行的程序<b>不会自动感知</b>，需要重启该程序或重启资源管理器。</li>
          <li>系统 PATH 存在长度上限（注册表建议不超过 2047 字符），超长写入可能被截断。</li>
          <li>中文路径与中文变量值已做 UTF-8 编码兼容处理；若仍出现乱码请反馈。</li>
          <li>重命名变量等价于「删除 + 新建」，引用旧名称的软件会失效。</li>
          <li>所有写入前都会自动生成快照与备份（可在「程序设置」中关闭）。</li>
        </ul>
      </div>
    </div>

    <a-modal v-model:open="staleOpen" title="长期未改动的变量" :footer="null" width="760px">
      <div class="hint-box" style="margin-bottom: 10px">
        <WarningOutlined />
        <div>
          这里按本工具记录的上次修改时间筛选。没有记录的变量不会被当成僵尸变量，避免误删系统原生项。
          标记删除只进草稿，点顶部「保存写入系统」才会真正改注册表。
        </div>
      </div>
      <div class="toolbar" style="margin-bottom: 10px">
        <span class="text-muted">超过</span>
        <a-input-number v-model:value="staleDays" size="small" :min="30" :max="3650" />
        <span class="text-muted">天未修改</span>
        <span class="text-muted">共 {{ staleVars.length }} 条</span>
      </div>
      <WemTable
        table-id="overview-stale"
        row-key="key"
        :rows="staleVars"
        :page-size="8"
        :capabilities="previewCaps"
        :columns="staleColumns"
        empty-text="没有长期未改动的变量"
      >
        <template #cell="{ row, column }">
          <template v-if="column.key === 'name'"><span class="cell-name">{{ row.name }}</span></template>
          <template v-else-if="column.key === 'scope'">{{ row.scope === 'machine' ? '系统' : '用户' }}</template>
          <template v-else-if="column.key === 'when'">{{ row.when }}</template>
          <template v-else><a class="danger-link" @click.stop="markStale(row)">标记删除</a></template>
        </template>
      </WemTable>
      <div v-if="!staleVars.length" class="empty-block">没有超过 {{ staleDays }} 天仍有修改记录的变量</div>
    </a-modal>
  </div>
</template>

<script setup>
import { computed, h, onMounted, ref } from 'vue'
import { Modal, message } from 'ant-design-vue'
import {
  UserOutlined, ClusterOutlined, DatabaseOutlined, ExclamationCircleOutlined,
  SafetyCertificateOutlined, ThunderboltOutlined, ReloadOutlined, CameraOutlined,
  SaveOutlined, InteractionOutlined, NodeIndexOutlined, RocketOutlined, WarningOutlined,
  TagOutlined, KeyOutlined, ApiOutlined, ClockCircleOutlined, DashboardOutlined
} from '@ant-design/icons-vue'
import { useRouter } from 'vue-router'
import { useEnvStore } from '@/store/env'
import { useUiStore } from '@/store/ui'
import { clipText } from '@/lib/helpers'
import api from '@/api'
import WemTable from '@/components/wem-table/WemTable.vue'

const SOURCE_TEXT = {
  manual: '手动新增',
  'env-market': '开发环境',
  'config-set': '配置集',
  'system-native': '系统原生',
  'auto-scan': '自动识别',
  import: '批量导入'
}
const SOURCE_COLOR = {
  manual: 'blue', 'env-market': 'purple', 'config-set': 'cyan',
  'system-native': 'default', 'auto-scan': 'green', import: 'geekblue'
}
function sourceText(s) {
  return SOURCE_TEXT[s] || '系统原生'
}
function sourceColor(s) {
  return SOURCE_COLOR[s] || 'default'
}

const env = useEnvStore()
const ui = useUiStore()
const router = useRouter()

const previewCaps = {
  inline: false,
  drag: false,
  batchDelete: false,
  batchTag: false,
  batchEnable: false,
  expand: false,
  summary: false
}
const previewColumns = [
  { title: '变量名称', key: 'name', dataIndex: 'name', width: 168 },
  { title: '变量值', key: 'value', dataIndex: 'value', ellipsis: true },
  { title: '来源', key: 'source', dataIndex: 'sourceLabel', width: 110 },
  { title: '标记', key: 'flags', dataIndex: 'flagText', width: 120, sortable: false }
]
const staleColumns = [
  { title: '变量', key: 'name', dataIndex: 'name', width: 180 },
  { title: '归属', key: 'scope', dataIndex: 'scopeLabel', width: 90 },
  { title: '上次修改', key: 'when', dataIndex: 'when', width: 170 },
  { title: '操作', key: 'actions', width: 110, sortable: false, filterable: false }
]

function metaOf(name) {
  const key = `user::${String(name).toUpperCase()}`
  return env.meta.vars[key] || env.meta.vars[`machine::${String(name).toUpperCase()}`] || {}
}

const favCount = computed(() => Object.values(env.meta.vars).filter((m) => m.favorite).length)
const sensitiveCount = computed(() => Object.values(env.meta.vars).filter((m) => m.sensitive).length)

const userPreview = computed(() => filterPreview(env.working.user))
const machinePreview = computed(() => filterPreview(env.working.machine))

const previewQuery = ref('')
const onlyShadow = ref(false)
const shadowNames = computed(() => new Set((health.value?.detail?.shadow || []).map((i) => String(i.name).toUpperCase())))

function isShadowed(name) {
  return shadowNames.value.has(String(name).toUpperCase())
}

function filterPreview(list) {
  let out = list.filter((i) => !i._deleted)
  if (previewFilter.value === 'fav') out = out.filter((i) => metaOf(i.name).favorite)
  else if (previewFilter.value === 'sensitive') out = out.filter((i) => metaOf(i.name).sensitive)
  const q = previewQuery.value.trim().toLowerCase()
  if (q) out = out.filter((i) => i.name.toLowerCase().includes(q) || String(i.value).toLowerCase().includes(q))
  if (onlyShadow.value) out = out.filter((i) => isShadowed(i.name))
  return out.slice(0, 200).map((item) => {
    const meta = metaOf(item.name)
    return {
      ...item,
      sourceLabel: sourceText(meta.source),
      flagText: [meta.favorite && '收藏', meta.sensitive && '敏感', meta.locked && '锁定'].filter(Boolean).join(' ')
    }
  })
}

const readAtText = computed(() => {
  if (!env.readAt) return '—'
  const d = new Date(env.readAt)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
})

const health = ref(null)
const healthLoading = ref(false)

async function runHealth() {
  healthLoading.value = true
  try {
    const [broken, shadow, cycle, perf] = await Promise.all([
      api.analyze.brokenRefs(),
      api.analyze.nameShadow(),
      api.analyze.circularRefs(),
      api.analyze.pathPerf()
    ])
    const failed = [broken, shadow, cycle, perf].find((r) => !r.ok)
    if (failed) message.error(failed.message || '健康检查失败')
    const lines = []
    if (shadow.ok) {
      for (const i of shadow.data.items.filter((x) => x.kind === 'shadow').slice(0, 4)) {
        lines.push(`遮蔽 ${i.name}：用户值覆盖了系统值`)
      }
    }
    if (broken.ok) {
      for (const i of broken.data.items.slice(0, 4)) {
        lines.push(`断裂 ${i.scope === 'machine' ? '系统' : '用户'} ${i.name} 引用了未定义的 %${i.ref}%`)
      }
    }
    if (cycle.ok) {
      for (const i of cycle.data.items.slice(0, 3)) lines.push(i.note)
    }
    health.value = {
      shadowN: shadow.ok ? shadow.data.counts.shadow : '—',
      dupN: shadow.ok ? shadow.data.counts.duplicate : '—',
      brokenN: broken.ok ? broken.data.total : '—',
      cycleN: cycle.ok ? cycle.data.total : '—',
      invalid: perf.ok ? perf.data.invalid : '—',
      lines,
      detail: {
        shadow: shadow.ok ? shadow.data.items.filter((i) => i.kind === 'shadow') : [],
        dup: shadow.ok ? shadow.data.items.filter((i) => i.kind === 'duplicate') : [],
        broken: broken.ok ? broken.data.items : [],
        cycle: cycle.ok ? cycle.data.items : [],
        advice: perf.ok ? perf.data.advice : []
      }
    }
  } finally {
    healthLoading.value = false
  }
}

async function copyHealthReport() {
  const h = health.value
  if (!h) return
  const d = h.detail || {}
  const lines = [
    '# WinEnv管家 环境健康报告',
    '',
    `- 同名遮蔽：${h.shadowN}`,
    `- 同名冗余：${h.dupN}`,
    `- 断裂引用：${h.brokenN}`,
    `- 循环引用：${h.cycleN}`,
    `- PATH 失效：${h.invalid}`,
    ''
  ]
  for (const i of d.shadow || []) lines.push(`- 遮蔽 ${i.name}：用户值覆盖系统值`)
  for (const i of d.broken || []) lines.push(`- 断裂 ${i.name} → %${i.ref}%`)
  for (const i of d.cycle || []) lines.push(`- ${i.note}`)
  for (const i of d.advice || []) lines.push(`- ${i}`)
  try {
    await navigator.clipboard.writeText(lines.join('\n'))
    message.success('健康报告已复制到剪贴板')
  } catch (err) {
    message.error(err.message || '复制失败')
  }
}

function openHealth(kind) {
  const d = health.value?.detail
  if (!d) return
  const blocks = {
    shadow: {
      title: '同名遮蔽',
      empty: '没有用户值覆盖系统值的变量。',
      text: d.shadow.map((i) => `${i.name}\n  用户：${clipText(i.userValue, 90)}\n  系统：${clipText(i.machineValue, 90)}`).join('\n\n')
    },
    dup: {
      title: '同名冗余',
      empty: '没有用户与系统取值完全相同的变量。',
      text: d.dup.map((i) => `${i.name}：${clipText(i.userValue, 100)}`).join('\n')
    },
    broken: {
      title: '断裂引用',
      empty: '所有 %变量% 都能找到定义。',
      text: d.broken.map((i) => `${i.scope === 'machine' ? '[系统]' : '[用户]'} ${i.name} 引用了未定义的 %${i.ref}%`).join('\n')
    },
    cycle: {
      title: '循环引用',
      empty: '没有自引用或互相引用的死环。',
      text: d.cycle.map((i) => i.note).join('\n\n')
    },
    invalid: {
      title: 'PATH 失效目录',
      empty: 'PATH 里没有失效目录。',
      text: d.advice.join('\n')
    }
  }
  const block = blocks[kind]
  const empty = !block.text
  Modal.info({
    title: block.title,
    width: 640,
    content: h('div', { style: 'white-space:pre-wrap;line-height:1.7' }, empty ? block.empty : block.text),
    okText: kind === 'invalid' && !empty ? '前往 PATH 管理' : '知道了',
    onOk: () => {
      if (kind === 'invalid' && !empty) router.push('/path')
    }
  })
}

onMounted(runHealth)

const previewFilter = ref('all')
const staleOpen = ref(false)
const staleDays = ref(180)

const staleVars = computed(() => {
  const limit = Date.now() - Number(staleDays.value || 180) * 86400000
  const out = []
  for (const scope of ['user', 'machine']) {
    for (const item of env.working[scope] || []) {
      if (item._deleted) continue
      const meta = env.meta.vars[`${scope}::${String(item.name).toUpperCase()}`] || {}
      const ts = Number(meta.updatedAt || meta.lastModified || 0)
      if (!ts || ts > limit) continue
      const d = new Date(ts)
      const p = (n) => String(n).padStart(2, '0')
      out.push({
        key: `${scope}::${item.name}`,
        name: item.name,
        scope,
        scopeLabel: scope === 'machine' ? '系统' : '用户',
        ts,
        when: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
      })
    }
  }
  return out.sort((a, b) => a.ts - b.ts)
})

function markStale(record) {
  try {
    env.remove(record.scope, record.name, { source: 'manual', originName: '僵尸变量清理' })
    message.success(`已把 ${record.name} 标记为待删除，尚未写入系统`)
  } catch (err) {
    message.error(err.message)
  }
}

function scanSensitive() {
  api.analyze.sensitiveScan().then((res) => {
    if (!res.ok) return message.error(res.message)
    const { items } = res.data
    Modal.info({
      title: `敏感值检测结果：${items.length} 条疑似敏感变量`,
      width: 680,
      content: items.length
        ? items.map((i) => `${i.scope === 'machine' ? '[系统]' : '[用户]'} ${i.name} — ${i.labels.join('、')}`).join('\n')
        : '未检测到疑似密钥 / 口令类变量。',
      okText: '知道了'
    })
    ui.tip(`敏感值检测：${items.length} 条`, items.length ? 'warning' : 'success')
  })
}

function scanBrokenRefs() {
  api.analyze.brokenRefs().then((res) => {
    if (!res.ok) return message.error(res.message)
    const { items } = res.data
    Modal.warning({
      title: `断裂引用检测：${items.length} 处`,
      width: 680,
      content: items.length
        ? items.map((i) => `${i.scope === 'machine' ? '[系统]' : '[用户]'} ${i.name} 引用了未定义的 %${i.ref}%`).join('\n')
        : '未发现断裂引用，所有 %VAR% 均可解析。',
      okText: '知道了'
    })
  })
}

function pathPerf() {
  api.analyze.pathPerf().then((res) => {
    if (!res.ok) return message.error(res.message)
    const d = res.data
    Modal.info({
      title: 'PATH 性能检测',
      width: 640,
      content: `共 ${d.total} 条 / ${d.totalLen} 字符 / ${d.invalid} 条无效。\n\n${d.advice.join('\n')}`,
      okText: '知道了'
    })
  })
}

function clip(v) {
  const s = String(v ?? '')
  if (s.length > 110) return s.slice(0, 110) + '…'
  return s || '（空）'
}

async function reload() {
  await env.load()
  message.success(`已重新读取 ${env.counts.total} 个环境变量`)
  ui.tip(`已重新读取 ${env.counts.total} 个环境变量`, 'success')
}

function quickSnapshot() {
  Modal.confirm({
    title: '立即创建环境变量快照？',
    content: '将抓取当前全部用户变量与系统变量并保存为本地快照文件。',
    okText: '创建快照',
    cancelText: '取消',
    onOk: async () => {
      const res = await api.snapshot.create({ name: `手动快照 ${new Date().toLocaleString('zh-CN')}` })
      if (res.ok) {
        message.success('快照已创建')
        ui.tip(`快照「${res.data.name}」已保存`, 'success')
      } else {
        message.error(res.message)
      }
    }
  })
}

async function quickBackup() {
  const res = await api.backup.export({})
  if (res.ok && !res.data.canceled) {
    message.success('备份文件已生成')
    ui.tip(`备份已导出：${res.data.file}`, 'success')
  } else if (!res.ok) {
    message.error(res.message)
  }
}

function restartExplorer() {
  Modal.confirm({
    title: '确认重启资源管理器？',
    content: '任务栏与桌面会短暂消失约 1~2 秒，随后自动恢复。此操作可使新环境变量立即对部分程序生效。',
    okText: '重启',
    cancelText: '取消',
    onOk: async () => {
      const res = await api.tool.restartExplorer()
      if (res.ok) {
        message.success('资源管理器已重启')
        ui.tip('资源管理器已重启，环境变量已刷新', 'success')
      } else {
        message.error(res.message)
      }
    }
  })
}

async function elevate() {
  Modal.confirm({
    title: '以管理员身份重新启动？',
    content: '将弹出 UAC 授权窗口，确认后会以管理员权限启动新窗口，当前窗口自动关闭。',
    okText: '提权重启',
    cancelText: '取消',
    onOk: async () => {
      const res = await api.tool.elevate()
      if (!res.ok) message.error(res.message)
    }
  })
}
</script>

<style scoped>
.risk-list {
  margin: 10px 0 0;
  padding-left: 20px;
  font-size: var(--wem-fs, 13px);
  line-height: 1.9;
  color: var(--wem-text-2);
}

.health-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.health-item {
  border: 1px solid var(--wem-border);
  border-radius: 8px;
  padding: 6px 10px;
  background: var(--wem-card-alt);
  color: var(--wem-text-2);
  cursor: pointer;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}

.health-item:hover {
  transform: translateY(-1px);
  box-shadow: var(--wem-shadow-sm);
}

.health-item b {
  margin-left: 4px;
  color: var(--wem-text);
}

.health-item.bad {
  border-color: rgba(245, 63, 63, 0.45);
  background: var(--wem-mark-removed);
}

.health-item.warn {
  border-color: rgba(255, 125, 0, 0.45);
  background: var(--wem-mark-modified);
}

.health-item.ok {
  border-color: rgba(0, 180, 42, 0.35);
}
</style>
