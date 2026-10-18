<template>
  <div>
    <!-- 常用工具 -->
    <div class="wem-card">
      <div class="wem-card-head">
        <div class="wem-card-title"><ToolOutlined /> 常用工具</div>
        <span class="text-muted">全部为鼠标点击操作，无快捷键</span>
      </div>
      <div class="wem-card-body">
        <div class="tool-grid">
          <div class="tool-tile" @click="restartExplorer">
            <InteractionOutlined class="tool-icon" />
            <div class="tool-name">重启资源管理器</div>
            <div class="tool-desc">让新环境变量立即对部分程序生效</div>
          </div>
          <div class="tool-tile" @click="openNativePanel(false)">
            <ControlOutlined class="tool-icon" />
            <div class="tool-name">打开原生环境变量面板</div>
            <div class="tool-desc">调用 Windows「环境变量」对话框</div>
          </div>
          <div class="tool-tile" @click="openNativePanel(true)">
            <SettingOutlined class="tool-icon" />
            <div class="tool-name">打开系统属性 · 高级</div>
            <div class="tool-desc">系统属性高级选项卡</div>
          </div>
          <div class="tool-tile" @click="openReg('machine')">
            <CodeOutlined class="tool-icon" />
            <div class="tool-name">打开注册表（系统变量）</div>
            <div class="tool-desc">跳转到 HKLM 环境变量键</div>
          </div>
          <div class="tool-tile" @click="openReg('user')">
            <CodeOutlined class="tool-icon" />
            <div class="tool-name">打开注册表（用户变量）</div>
            <div class="tool-desc">跳转到 HKCU\Environment</div>
          </div>
          <div class="tool-tile" @click="broadcast">
            <NotificationOutlined class="tool-icon" />
            <div class="tool-name">广播环境变量变更</div>
            <div class="tool-desc">通知已运行程序重新读取环境</div>
          </div>
          <div class="tool-tile" @click="openPreviewTerminal('cmd')">
            <CodeOutlined class="tool-icon" />
            <div class="tool-name">打开预览终端（CMD）</div>
            <div class="tool-desc">以当前系统环境启动，可用 echo 验证变量</div>
          </div>
          <div class="tool-tile" @click="openPreviewTerminal('powershell')">
            <CodeOutlined class="tool-icon" />
            <div class="tool-name">打开预览终端（PowerShell）</div>
            <div class="tool-desc">验证新写入的 PATH 与变量是否生效</div>
          </div>
        </div>
      </div>
    </div>

    <div class="split-2" style="margin-top: 14px">
      <!-- 权限 -->
      <div class="wem-card">
        <div class="wem-card-head">
          <div class="wem-card-title"><SafetyOutlined /> 权限检测</div>
        </div>
        <div class="wem-card-body">
          <div class="perm-box" :class="env.admin ? 'ok' : 'warn'">
            <component :is="env.admin ? CheckCircleOutlined : ExclamationCircleOutlined" class="perm-icon" />
            <div>
              <div class="perm-title">{{ env.admin ? '当前为管理员权限' : '当前为普通用户权限' }}</div>
              <div class="perm-desc">
                {{ env.admin
                  ? '用户变量与系统变量均可读写。'
                  : '可以读取全部变量，但无法写入或删除系统变量。' }}
              </div>
            </div>
          </div>

          <div class="kv-list" style="margin-top: 14px">
            <span class="kv-key">用户变量</span>
            <span class="kv-val">{{ env.counts.user }} 个 · HKCU\Environment</span>
            <span class="kv-key">系统变量</span>
            <span class="kv-val">{{ env.counts.machine }} 个 · HKLM\...\Session Manager\Environment</span>
            <span class="kv-key">程序版本</span>
            <span class="kv-val">{{ info.version }}（Electron {{ info.electron }}）</span>
            <span class="kv-key">运行模式</span>
            <span class="kv-val">{{ info.packaged ? '打包版（单文件 exe）' : '开发模式' }}</span>
          </div>

          <div class="toolbar" style="margin-top: 14px">
            <a-button :disabled="env.admin" type="primary" @click="elevate">
              <template #icon><RocketOutlined /></template>
              以管理员身份重启
            </a-button>
            <a-button @click="refreshEnv">
              <template #icon><ReloadOutlined /></template>
              重新检测
            </a-button>
          </div>
        </div>
      </div>

      <!-- 变量解析预览 -->
      <div class="wem-card">
        <div class="wem-card-head">
          <div class="wem-card-title"><CodeOutlined /> 变量解析预览</div>
        </div>
        <div class="wem-card-body">
          <p class="text-muted" style="margin: 0 0 8px">输入含 %VAR% 的字符串，查看系统解析后的真实值</p>
          <a-textarea v-model:value="expandInput" :rows="3" class="mono" placeholder="%LOCALAPPDATA%\Programs;%USERPROFILE%\go\bin" />
          <div class="toolbar" style="margin: 10px 0">
            <a-button type="primary" size="small" :loading="expanding" @click="doExpand">解析</a-button>
            <a-button size="small" @click="expandInput = '%SystemRoot%\\system32;%USERPROFILE%'">示例</a-button>
          </div>
          <div class="result-box mono">{{ expandResult || '解析结果会显示在这里' }}</div>
        </div>
      </div>
    </div>

    <!-- 命令查找模拟 -->
    <div class="wem-card">
      <div class="wem-card-head">
        <div class="wem-card-title"><ThunderboltOutlined /> CMD / PowerShell 环境变量预览模拟</div>
        <div class="toolbar">
          <a-input v-model:value="cmdName" size="small" style="width: 160px" placeholder="命令名，如 node" class="mono" />
          <a-select v-model:value="simScope" size="small" style="width: 150px">
            <a-select-option value="machine">使用系统 PATH</a-select-option>
            <a-select-option value="user">使用用户 PATH</a-select-option>
            <a-select-option value="merged">用户 + 系统合并</a-select-option>
          </a-select>
          <a-button type="primary" size="small" :loading="whichLoading" @click="runWhich">
            <template #icon><SearchOutlined /></template>
            模拟查找
          </a-button>
        </div>
      </div>
      <div class="wem-card-body">
        <div class="hint-box" style="margin-bottom: 12px">
          <InfoCircleOutlined />
          <div>
            模拟使用的是<b>当前内存中的 PATH</b>（含未保存的修改）。真实 cmd / PowerShell 会先读用户 PATH 再拼接系统 PATH，
            因此合并模式下用户条目优先级更高。
          </div>
        </div>

        <div v-if="!whichResult" class="empty-block">输入命令名后点击「模拟查找」，查看会在哪个目录命中</div>

        <template v-else>
          <div v-if="whichResult.matches.length" class="hint-box" style="margin-bottom: 10px">
            <CheckCircleOutlined />
            <div>
              找到 {{ whichResult.matches.length }} 处匹配，<b>优先命中的是</b>：
              <span class="mono">{{ whichResult.matches[0].file }}</span>
            </div>
          </div>
          <div v-else class="hint-box danger" style="margin-bottom: 10px">
            <ExclamationCircleOutlined />
            <div>在模拟的 PATH 中没有找到 <span class="mono">{{ whichResult.name }}</span>，该命令将无法直接执行。</div>
          </div>

          <a-table
            class="wem-table"
            size="small"
            row-key="file"
            :data-source="whichResult.matches"
            :columns="whichColumns"
            :pagination="false"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'order'"><span class="mono">{{ record.order }}</span></template>
              <template v-else-if="column.key === 'dir'"><span class="cell-path">{{ record.dir }}</span></template>
              <template v-else-if="column.key === 'file'"><span class="cell-path">{{ record.file }}</span></template>
            </template>
          </a-table>
        </template>

        <a-divider style="margin: 16px 0 12px" />

        <div class="text-muted" style="margin-bottom: 6px">模拟的 PATH 内容（已展开变量）</div>
        <div class="cmd-preview mono">
          <div v-for="(line, i) in simulatedPathLines" :key="i">{{ line }}</div>
        </div>
      </div>
    </div>

    <!-- 扩充工具 -->
    <div class="wem-card" style="margin-top: 14px">
      <div class="wem-card-head">
        <div class="wem-card-title"><ThunderboltOutlined /> 开发环境与诊断工具</div>
        <span class="text-muted">全部为鼠标点击操作</span>
      </div>
      <div class="wem-card-body">
        <div class="tool-grid">
          <div class="tool-tile" @click="$router.push('/devenv'); $router.push({ hash: '#/devenv' })">
            <SafetyOutlined class="tool-icon" />
            <div class="tool-name">全盘环境审计</div>
            <div class="tool-desc">跳转到开发环境 · 环境审计页面</div>
          </div>
          <div class="tool-tile" @click="batchValidate">
            <CheckCircleOutlined class="tool-icon" />
            <div class="tool-name">批量校验开发环境</div>
            <div class="tool-desc">批量执行版本检测命令</div>
          </div>
          <div class="tool-tile" @click="api.devenv.openDir('dev')">
            <FolderOpenOutlined class="tool-icon" />
            <div class="tool-name">打开默认安装目录</div>
            <div class="tool-desc">C:\dev\soft（可在设置中修改）</div>
          </div>
          <div class="tool-tile" @click="api.devenv.openDir('cache')">
            <DatabaseOutlined class="tool-icon" />
            <div class="tool-name">打开安装包缓存目录</div>
            <div class="tool-desc">重复部署复用缓存，不重复下载</div>
          </div>
          <div class="tool-tile" @click="multiJdk">
            <CodeOutlined class="tool-icon" />
            <div class="tool-name">多 JDK 快速切换</div>
            <div class="tool-desc">扫描本机 JDK 并切换版本</div>
          </div>
          <div class="tool-tile" @click="launchDraftTerminal('cmd')">
            <CodeOutlined class="tool-icon" />
            <div class="tool-name">启动 CMD（注入草稿）</div>
            <div class="tool-desc">临时生效，不写入注册表</div>
          </div>
          <div class="tool-tile" @click="launchDraftTerminal('powershell')">
            <CodeOutlined class="tool-icon" />
            <div class="tool-name">启动 PowerShell（注入草稿）</div>
            <div class="tool-desc">临时生效，不写入注册表</div>
          </div>
          <div class="tool-tile" @click="proxyOpen = true">
            <NotificationOutlined class="tool-icon" />
            <div class="tool-name">代理环境变量快速设置</div>
            <div class="tool-desc">http_proxy / https_proxy / no_proxy</div>
          </div>
          <div class="tool-tile" @click="exportTerminalEnv">
            <DownloadOutlined class="tool-icon" />
            <div class="tool-name">导出 .env 文件</div>
            <div class="tool-desc">从当前草稿变量生成标准 .env</div>
          </div>
          <div class="tool-tile" @click="exportChangelog">
            <FileTextOutlined class="tool-icon" />
            <div class="tool-name">导出 Markdown 变更说明</div>
            <div class="tool-desc">记录当前草稿的全部待修改变量</div>
          </div>
          <div class="tool-tile" @click="encodeOpen = true">
            <SwapOutlined class="tool-icon" />
            <div class="tool-name">变量值编码转换</div>
            <div class="tool-desc">URL 编码 / Base64 编解码</div>
          </div>
          <div class="tool-tile" @click="brokenRefs">
            <WarningOutlined class="tool-icon" />
            <div class="tool-name">变量引用检测</div>
            <div class="tool-desc">扫描无效 %xxx% 断裂引用</div>
          </div>
          <div class="tool-tile" @click="nameShadow">
            <ApartmentOutlined class="tool-icon" />
            <div class="tool-name">同名遮蔽分析</div>
            <div class="tool-desc">检测用户/系统同名变量的覆盖冲突</div>
          </div>
          <div class="tool-tile" @click="circularRefs">
            <RetweetOutlined class="tool-icon" />
            <div class="tool-name">循环引用检测</div>
            <div class="tool-desc">找出 %变量% 互相引用形成的死环</div>
          </div>
          <div class="tool-tile" @click="terminalDiff">
            <SearchOutlined class="tool-icon" />
            <div class="tool-name">终端实时环境对比</div>
            <div class="tool-desc">对比当前进程环境与注册表差异</div>
          </div>
          <div class="tool-tile" @click="pathPerf">
            <DashboardOutlined class="tool-icon" />
            <div class="tool-name">环境变量性能检测</div>
            <div class="tool-desc">检测 PATH 规模对终端启动速度的影响</div>
          </div>
          <div class="tool-tile" @click="registryAcl">
            <SafetyCertificateOutlined class="tool-icon" />
            <div class="tool-name">注册表权限诊断</div>
            <div class="tool-desc">检测环境变量注册表项读写权限</div>
          </div>
          <div class="tool-tile danger" @click="resetEnv">
            <ExclamationCircleOutlined class="tool-icon" />
            <div class="tool-name">系统环境重置</div>
            <div class="tool-desc">恢复用户/系统变量到系统默认（高危）</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 风险提示 -->
    <div class="wem-card">
      <div class="wem-card-head">
        <div class="wem-card-title"><WarningOutlined /> 风险提示</div>
      </div>
      <div class="wem-card-body">
        <div class="hint-box danger">
          <WarningOutlined />
          <div>
            <b>注册表编辑器属于高风险工具</b>：手动修改 <span class="mono">HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment</span>
            下的键值可能造成系统不稳定。建议优先使用本工具的界面操作，并确保已有可用备份。
          </div>
        </div>
        <ul class="risk-list">
          <li>部分安装包本身要管理员权限，安装阶段会弹出系统提权窗口。</li>
          <li>镜像下载会校验哈希。哈希对不上时安装包不会进入部署。</li>
          <li>多版本共存时，PATH 顺序决定命令先找到谁。可在 PATH 页面调整。</li>
          <li>注册表 PATH 有长度上限。接近上限会橙色提醒，超过则阻止写入。</li>
          <li>WSL、Docker Desktop 依赖系统组件。审计发现缺依赖时只给文字提示，不会自动安装系统功能。</li>
          <li>杀毒软件可能拦截注册表写入、解压和第三方安装程序。失败时先把本程序加入白名单。</li>
          <li>项目环境分两种：只在当前终端临时生效，或写入用户变量。临时模式不会改注册表。</li>
          <li>重置环境、批量删除系统变量需要二次确认。确认前建议先做完整备份。</li>
          <li>其他程序改了注册表时，顶部会提示草稿可能和系统不一致，可重新加载或保留草稿。</li>
          <li>导出含密钥的变量时，建议打开脱敏，或给备份文件设置密码。</li>
        </ul>
      </div>
    </div>

    <!-- 代理快速设置 -->
    <a-modal v-model:open="proxyOpen" title="代理环境变量快速设置" ok-text="加入草稿区" cancel-text="取消" @ok="applyProxy">
      <div class="hint-box" style="margin-bottom: 10px">
        <InfoCircleOutlined />
        <div>代理变量仅进入草稿区，点击【保存写入系统】后才会写入注册表。关闭开关可快速移除。</div>
      </div>
      <a-form layout="vertical">
        <a-form-item>
          <a-space :size="16">
            <a-checkbox v-model:checked="proxyOn">启用代理变量</a-checkbox>
          </a-space>
        </a-form-item>
        <a-form-item label="http_proxy">
          <a-input v-model:value="proxyForm.http" size="small" class="mono" />
        </a-form-item>
        <a-form-item label="https_proxy">
          <a-input v-model:value="proxyForm.https" size="small" class="mono" />
        </a-form-item>
        <a-form-item label="no_proxy">
          <a-input v-model:value="proxyForm.no" size="small" class="mono" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 编码转换 -->
    <a-modal v-model:open="encodeOpen" title="变量值编码转换" :footer="null" width="640px">
      <a-textarea v-model:value="encodeInput" :rows="3" class="mono" placeholder="输入要转换的文本" />
      <div class="toolbar" style="margin: 10px 0">
        <a-button size="small" @click="encodeInput = encodeURIComponent(encodeInput)">URL 编码</a-button>
        <a-button size="small" @click="encodeInput = decodeURIComponent(encodeInput)">URL 解码</a-button>
        <a-button size="small" @click="encodeInput = btoa(unescape(encodeURIComponent(encodeInput)))">Base64 编码</a-button>
        <a-button size="small" @click="encodeInput = decodeURIComponent(escape(atob(encodeInput)))">Base64 解码</a-button>
      </div>
      <div class="result-box mono">{{ encodeInput || '转换结果会显示在这里' }}</div>
    </a-modal>

    <!-- 终端环境对比 -->
    <a-modal v-model:open="diffModalOpen" title="终端实时环境 vs 注册表环境" :footer="null" width="780px">
      <a-radio-group v-model:value="diffShell" size="small" @change="runTerminalDiff" style="margin-bottom: 10px">
        <a-radio-button value="cmd">CMD</a-radio-button>
        <a-radio-button value="powershell">PowerShell</a-radio-button>
      </a-radio-group>
      <div class="stat-grid" style="margin-bottom: 10px">
        <div class="stat-card"><div class="stat-label">终端内变量数</div><div class="stat-value">{{ diffData.total }}</div></div>
        <div class="stat-card"><div class="stat-label">仅终端有</div><div class="stat-value" style="color:#00b42a">{{ diffData.onlyInTerminal.length }}</div></div>
        <div class="stat-card"><div class="stat-label">仅注册表有</div><div class="stat-value" style="color:#ff7d00">{{ diffData.onlyInRegistry.length }}</div></div>
        <div class="stat-card"><div class="stat-label">值不同</div><div class="stat-value" style="color:#f53f3f">{{ diffData.different.length }}</div></div>
      </div>
      <a-tabs size="small">
        <a-tab-pane key="a" :tab="`仅终端有（${diffData.onlyInTerminal.length}）`">
          <div class="pv-list mono">
            <div v-for="i in diffData.onlyInTerminal" :key="i.name">{{ i.name }} = {{ clipText(i.value, 90) }}</div>
          </div>
        </a-tab-pane>
        <a-tab-pane key="b" :tab="`仅注册表有（${diffData.onlyInRegistry.length}）`">
          <div class="pv-list mono">
            <div v-for="i in diffData.onlyInRegistry" :key="i.name">{{ i.name }} = {{ clipText(i.value, 90) }}</div>
          </div>
        </a-tab-pane>
        <a-tab-pane key="c" :tab="`值不同（${diffData.different.length}）`">
          <div class="pv-list mono">
            <div v-for="i in diffData.different" :key="i.name">{{ i.name }}：终端={{ clipText(i.terminal, 60) }} | 注册表={{ clipText(i.registry, 60) }}</div>
          </div>
        </a-tab-pane>
      </a-tabs>
    </a-modal>

    <!-- 多 JDK 切换 -->
    <a-modal v-model:open="jdkOpen" title="多 JDK 快速切换" :footer="null" width="720px">
      <div class="hint-box" style="margin-bottom: 10px">
        <InfoCircleOutlined />
        <div>切换会把对应 JDK 的 HOME 变量与 PATH 条目写入草稿区，确认后统一【保存写入系统】。</div>
      </div>
      <a-table
        size="small" row-key="id" :data-source="jdkList" :pagination="false"
        :columns="[{ title: '版本', key: 'version', width: 140 }, { title: '安装路径', key: 'installPath', ellipsis: true }, { title: '操作', key: 'actions', width: 100 }]"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'version'"><span class="mono">{{ record.version }}</span></template>
          <template v-else-if="column.key === 'installPath'"><span class="cell-path">{{ record.installPath }}</span></template>
          <template v-else><a @click="switchJdk(record)">切换到此版本</a></template>
        </template>
      </a-table>
      <div v-if="!jdkList.length" class="empty-block">本机未扫描到多个 JDK，请先在「开发环境管理」执行扫描</div>
    </a-modal>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { Modal, message } from 'ant-design-vue'
import {
  ToolOutlined, InteractionOutlined, ControlOutlined, SettingOutlined, CodeOutlined,
  NotificationOutlined, SafetyOutlined, CheckCircleOutlined, ExclamationCircleOutlined,
  RocketOutlined, ReloadOutlined, ThunderboltOutlined, SearchOutlined, InfoCircleOutlined,
  WarningOutlined, FolderOpenOutlined, DatabaseOutlined, DownloadOutlined, FileTextOutlined,
  SwapOutlined, SafetyCertificateOutlined, ApartmentOutlined, RetweetOutlined
} from '@ant-design/icons-vue'
import { useEnvStore } from '@/store/env'
import { useUiStore } from '@/store/ui'
import { useDevStore } from '@/store/dev'
import { useSetStore } from '@/store/dev'
import api from '@/api'
import { buildMarkdownChangelog, clipText, maskSensitiveExport } from '@/lib/helpers'

const env = useEnvStore()
const ui = useUiStore()
const dev = useDevStore()
const setStore = useSetStore()

const info = ref({ version: '—', electron: '—', packaged: false })
const expandInput = ref('%LOCALAPPDATA%\\Programs;%USERPROFILE%\\go\\bin')
const expandResult = ref('')
const expanding = ref(false)

const cmdName = ref('node')
const simScope = ref('merged')
const whichLoading = ref(false)
const whichResult = ref(null)

const whichColumns = [
  { title: '顺序', key: 'order', width: 64 },
  { title: 'PATH 中的目录', key: 'dir', ellipsis: true },
  { title: '命中文件', key: 'file', ellipsis: true }
]

/** 模拟合并后的 PATH 目录列表（用户在前，系统在后） */
const simDirs = computed(() => {
  if (simScope.value === 'user') return env.pathItems.user.filter((i) => !i.disabled).map((i) => i.path)
  if (simScope.value === 'machine') return env.pathItems.machine.filter((i) => !i.disabled).map((i) => i.path)
  return [
    ...env.pathItems.user.filter((i) => !i.disabled).map((i) => i.path),
    ...env.pathItems.machine.filter((i) => !i.disabled).map((i) => i.path)
  ]
})

const simulatedPathLines = computed(() => simDirs.value.map((d, i) => `${String(i + 1).padStart(3, ' ')}  ${d}`))

/* ------------------------------ 工具动作 ------------------------------ */

function restartExplorer() {
  Modal.confirm({
    title: '确认重启资源管理器？',
    content: '任务栏与桌面会短暂消失约 1~2 秒，随后自动恢复。',
    okText: '重启',
    cancelText: '取消',
    onOk: async () => {
      const res = await api.tool.restartExplorer()
      if (res.ok) {
        message.success('资源管理器已重启')
        ui.tip('资源管理器已重启', 'success')
      } else {
        message.error(res.message)
      }
    }
  })
}

async function openNativePanel(advanced) {
  const res = await api.tool.openNativeEnvPanel(advanced ? 'advanced' : 'simple')
  if (res.ok) {
    message.success('已唤起系统面板')
    ui.tip('已打开 Windows 原生环境变量面板', 'info')
  } else {
    message.error(res.message)
  }
}

function openReg(scope) {
  Modal.confirm({
    title: '打开注册表编辑器？',
    content() {
      return '注册表编辑器允许直接修改系统配置，误操作可能导致系统异常。请确保已备份，操作时请谨慎。'
    },
    okText: '我已了解风险，打开',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      const res = await api.tool.openRegEnv(scope)
      if (res.ok) message.success('已打开注册表编辑器')
      else message.error(res.message)
    }
  })
}

async function broadcast() {
  const res = await api.tool.broadcastChange()
  if (res.ok) {
    message.success('已广播环境变量变更消息')
    ui.tip('已通知系统刷新环境变量', 'success')
  } else {
    message.warning('广播失败，可尝试重启资源管理器')
  }
}

async function openPreviewTerminal(shell) {
  const res = await api.envset.launchTerminal({ shell, injectDraft: false, title: 'WinEnv 预览终端' })
  if (res.ok) {
    message.success(`已打开预览终端（${shell === 'cmd' ? 'CMD' : 'PowerShell'}），可用 echo %变量名% 验证`)
  } else {
    message.error(res.message)
  }
}

async function elevate() {
  Modal.confirm({
    title: '以管理员身份重新启动？',
    content: '将弹出 UAC 授权窗口，确认后以管理员权限启动新窗口，当前窗口自动关闭。',
    okText: '提权重启',
    cancelText: '取消',
    onOk: async () => {
      const res = await api.tool.elevate()
      if (!res.ok) message.error(res.message)
    }
  })
}

async function refreshEnv() {
  await env.load()
  message.success(`已重新检测：${env.admin ? '管理员权限' : '普通用户权限'}`)
}

/* ------------------------------ 解析与模拟 ------------------------------ */

async function doExpand() {
  expanding.value = true
  try {
    const res = await api.env.expandString(expandInput.value)
    expandResult.value = res.ok ? res.data : `解析失败：${res.message}`
    // 对比原始输入，标出未解析的变量
    const unresolved = String(res.ok ? res.data : '').match(/%[^%]+%/g)
    if (unresolved && unresolved.length) {
      message.warning(`以下变量未定义：${[...new Set(unresolved)].join('、')}`)
    }
  } finally {
    expanding.value = false
  }
}

async function runWhich() {
  if (!cmdName.value.trim()) return message.warning('请输入命令名')
  whichLoading.value = true
  try {
    const res = await api.tool.whichCommand({ name: cmdName.value.trim(), dirs: simDirs.value })
    whichResult.value = res.ok ? res.data : { name: cmdName.value, matches: [] }
    if (!res.ok) message.error(res.message)
  } finally {
    whichLoading.value = false
  }
}

onMounted(async () => {
  const res = await api.app.getInfo()
  if (res.ok) info.value = res.data
})

/* ==================== 扩充工具逻辑 ==================== */

const proxyOpen = ref(false)
const proxyOn = ref(true)
const proxyForm = reactive({ http: 'http://127.0.0.1:7890', https: 'http://127.0.0.1:7890', no: 'localhost,127.0.0.1' })
const encodeOpen = ref(false)
const encodeInput = ref('')
const diffModalOpen = ref(false)
const diffShell = ref('cmd')
const diffData = ref({ total: 0, onlyInTerminal: [], onlyInRegistry: [], different: [] })
const jdkOpen = ref(false)
const jdkList = ref([])

function applyProxy() {
  const vars = proxyOn.value
    ? [
        { scope: 'user', name: 'http_proxy', value: proxyForm.http, op: 'create' },
        { scope: 'user', name: 'https_proxy', value: proxyForm.https, op: 'create' },
        { scope: 'user', name: 'no_proxy', value: proxyForm.no, op: 'create' }
      ]
    : [
        { scope: 'user', name: 'http_proxy', op: 'delete' },
        { scope: 'user', name: 'https_proxy', op: 'delete' },
        { scope: 'user', name: 'no_proxy', op: 'delete' }
      ]
  const r = env.applyTemplateVars(vars, { source: 'manual' })
  proxyOpen.value = false
  message.success(r.errors.length ? r.errors.join('；') : '代理变量已加入草稿区，保存写入系统后生效')
  ui.tip('代理变量已加入草稿', 'warning')
}

async function exportTerminalEnv() {
  const vars = env.working.user.filter((i) => !i._deleted)
  const lines = ['# WinEnv管家 导出', `# ${new Date().toLocaleString('zh-CN')}`, '']
  for (const v of vars) {
    const value = env.config.desensitizeExport === true ? maskSensitiveExport(v.name, v.value) : v.value
    lines.push(`${v.name.toUpperCase()}="${value}"`)
  }
  const saved = await api.fs.saveFile({
    title: '导出 .env 文件', defaultPath: '.env', filters: [{ name: 'env', extensions: ['env', 'txt'] }]
  })
  if (!saved.ok || saved.data.canceled) return
  const w = await api.fs.writeTextFile({ file: saved.data.path, content: lines.join('\r\n') })
  if (w.ok) message.success(`已导出 ${vars.length} 个用户变量为 .env 文件`)
}

async function exportChangelog() {
  if (!env.changes.length) return message.info('草稿区没有变更，无需导出')
  const changes = env.config.desensitizeExport === true
    ? env.changes.map((c) => ({ ...c, value: maskSensitiveExport(c.name, c.value) }))
    : env.changes
  const md = buildMarkdownChangelog(changes, { note: '快捷工具箱导出' })
  const saved = await api.fs.saveFile({
    title: '保存变更说明文档', defaultPath: '环境变量变更说明.md', filters: [{ name: 'Markdown', extensions: ['md'] }]
  })
  if (!saved.ok || saved.data.canceled) return
  const w = await api.fs.writeTextFile({ file: saved.data.path, content: md })
  if (w.ok) message.success('Markdown 变更说明已导出')
}

async function launchDraftTerminal(shell) {
  const vars = {}
  for (const c of env.changes) {
    if (c.action === 'delete') vars[c.name] = ''
    else vars[c.name] = c.value
  }
  const res = await api.envset.launchTerminal({ shell, cwd: '', env: vars, injectDraft: true, draftChanges: env.changes, title: 'WinEnv · 草稿终端' })
  if (res.ok) message.success(`终端已启动，注入 ${Object.keys(vars).length} 个草稿变量（仅当前窗口生效）`)
  else message.error(res.message)
}

async function brokenRefs() {
  const res = await api.analyze.brokenRefs()
  if (!res.ok) return message.error(res.message)
  Modal.warning({
    title: `变量引用检测：${res.data.total} 处断裂引用`,
    width: 680,
    content: res.data.total
      ? res.data.items.map((i) => `${i.scope === 'machine' ? '[系统]' : '[用户]'} ${i.name} 引用了未定义的 %${i.ref}%`).join('\n')
      : '未发现断裂引用。',
    okText: '知道了'
  })
}

async function nameShadow() {
  const res = await api.analyze.nameShadow()
  if (!res.ok) return message.error(res.message)
  const { total, counts, items } = res.data
  if (!total) {
    return Modal.success({
      title: '同名遮蔽分析：未发现同名变量',
      content: '用户变量与系统变量没有重名，不存在遮蔽冲突。',
      okText: '知道了'
    })
  }
  const kindTag = { shadow: '[遮蔽]', duplicate: '[冗余]', path: '[拼接]' }
  const content = items
    .map((i) => {
      const vals = i.kind === 'duplicate'
        ? ''
        : `\n  用户值: ${clipText(i.userValue, 80)}\n  系统值: ${clipText(i.machineValue, 80)}`
      return `${kindTag[i.kind]} ${i.name}${vals}\n  ${i.note}`
    })
    .join('\n\n')
  Modal.warning({
    title: `同名遮蔽分析：${counts.shadow} 处遮蔽 / ${counts.duplicate} 处冗余 / ${counts.path} 处 PATH 拼接`,
    width: 720,
    content,
    okText: '知道了'
  })
}

async function circularRefs() {
  const res = await api.analyze.circularRefs()
  if (!res.ok) return message.error(res.message)
  const { total, items } = res.data
  if (!total) {
    return Modal.success({
      title: '循环引用检测：未发现引用环',
      content: '所有 %变量% 引用都能展开到确定的值，没有自引用或互相引用的死环。',
      okText: '知道了'
    })
  }
  Modal.warning({
    title: `循环引用检测：发现 ${total} 个引用环`,
    width: 680,
    content: items.map((i) => (i.self ? `[自引用] ${i.note}` : `[闭环] ${i.note}`)).join('\n\n'),
    okText: '知道了'
  })
}

async function terminalDiff() {
  diffModalOpen.value = true
  await runTerminalDiff()
}

async function runTerminalDiff() {
  const res = await api.analyze.terminalEnv({ shell: diffShell.value })
  if (res.ok) diffData.value = res.data
  else message.error(res.message)
}

async function pathPerf() {
  const res = await api.analyze.pathPerf()
  if (!res.ok) return message.error(res.message)
  Modal.info({
    title: '环境变量性能检测',
    width: 640,
    content: `共 ${res.data.total} 条 / ${res.data.totalLen} 字符 / ${res.data.invalid} 条无效。\n\n${res.data.advice.join('\n')}`,
    okText: '知道了'
  })
}

async function registryAcl() {
  const res = await api.analyze.registryAcl()
  if (!res.ok) return message.error(res.message)
  Modal.info({
    title: '注册表权限诊断',
    width: 640,
    content: res.data.results.map((r) => `${r.target}：${r.message}`).join('\n'),
    okText: '知道了'
  })
}

function resetEnv() {
  Modal.confirm({
    title: '⚠️ 系统环境重置（高危操作）',
    content: '将删除当前作用域下全部环境变量，并恢复为 Windows 默认值。执行前会自动生成快照与备份，但请务必确认！',
    okText: '我已了解风险，继续',
    okType: 'danger',
    cancelText: '取消',
    onOk: () => {
      const run = async () => {
        const scope = env.admin ? 'machine' : 'user'
        const res = await api.tool.resetEnvDefaults({ scope })
        if (res.ok) {
          message.success(`已重置${scope === 'machine' ? '系统' : '用户'}变量（清理 ${res.data.removed} 条，恢复 ${res.data.restored} 条）`)
          await env.load()
        } else message.error(res.message)
      }
      if (env.config.confirmDanger === false) return run()
      Modal.confirm({
        title: '第二次确认',
        content: '真的要重置吗？此操作影响面很大，请确保已有可用备份。',
        okText: '确认重置',
        okType: 'danger',
        cancelText: '再想想',
        onOk: run
      })
    }
  })
}

async function multiJdk() {
  if (!dev.scanResult) await dev.scan({})
  jdkList.value = (dev.scanResult ? dev.scanResult.items : []).filter((i) => i.ruleId === 'jdk')
  jdkOpen.value = true
}

async function switchJdk(record) {
  const res = await api.devenv.buildPlan({ ruleId: record.ruleId, installPath: record.installPath, scope: 'user' })
  if (!res.ok) return message.error(res.message)
  const r = env.applyTemplateVars(res.data.plan.filter((p) => p.op !== 'same'), {
    source: 'env-market', originId: `jdk-switch-${record.id}`, originName: `切换到 JDK ${record.version}`
  })
  jdkOpen.value = false
  message.success(`已切换到 JDK ${record.version}，${r.added.length} 条变量进入草稿区，保存写入系统后生效`)
}

async function batchValidate() {
  if (!dev.scanResult || !dev.scanResult.items.length) await dev.scan({})
  const items = dev.scanResult ? dev.scanResult.items.filter((i) => !i.ignored) : []
  if (!items.length) return message.warning('本机未发现可校验的开发环境')
  const res = await api.devenv.validateBatch(items)
  if (!res.ok) return message.error(res.message)
  const okCount = res.data.filter((r) => r.ok).length
  Modal.info({
    title: `批量校验完成：${okCount}/${items.length} 通过`,
    width: 640,
    content: res.data.map((r) => `${r.ok ? '✅' : '❌'} ${r.name} ${r.version || r.message || ''}`).join('\n'),
    okText: '知道了'
  })
}
</script>

<style scoped>
.tool-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(220px, 100%), 1fr));
  gap: 12px;
}

.tool-tile {
  min-width: 0;
  border: 1px solid var(--wem-border);
  border-radius: var(--wem-radius);
  padding: 14px;
  cursor: pointer;
  transition: border-color 0.2s ease, box-shadow 0.22s ease, transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), background-color 0.2s ease;
  background: var(--wem-card-alt);
}

.tool-tile:hover {
  border-color: var(--wem-primary);
  box-shadow: var(--wem-shadow);
  transform: translateY(-2px);
  background: var(--wem-card);
}

.tool-tile:active {
  transform: translateY(0) scale(0.985);
}

.tool-icon {
  font-size: 18px;
  color: var(--wem-primary);
}

.tool-name {
  font-size: 13px;
  font-weight: 600;
  margin-top: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-desc {
  font-size: 11.5px;
  color: var(--wem-text-3);
  margin-top: 3px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.perm-box {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 14px;
  border-radius: var(--wem-radius);
  border: 1px solid var(--wem-border);
  background: var(--wem-card-alt);
}

.perm-box.ok {
  border-color: rgba(0, 180, 42, 0.3);
  background: var(--wem-mark-added);
}

.perm-box.warn {
  border-color: rgba(255, 125, 0, 0.3);
  background: var(--wem-mark-modified);
}

.perm-icon {
  font-size: 20px;
}

.perm-box.ok .perm-icon {
  color: var(--wem-success);
}

.perm-box.warn .perm-icon {
  color: var(--wem-warning);
}

.perm-title {
  font-size: 13.5px;
  font-weight: 600;
}

.perm-desc {
  font-size: 12px;
  color: var(--wem-text-2);
  margin-top: 3px;
  line-height: 1.6;
}

.tool-tile.danger .tool-icon,
.tool-tile.danger .tool-name {
  color: var(--wem-danger);
}

.pv-list {
  max-height: 240px;
  overflow: auto;
  font-size: 11.5px;
  line-height: 1.7;
  padding: 8px 10px;
  border: 1px solid var(--wem-border);
  border-radius: 8px;
  background: var(--wem-card-alt);
  word-break: break-all;
}

.result-box {
  background: var(--wem-card-alt);
  border: 1px solid var(--wem-border);
  border-radius: 8px;
  padding: 10px 12px;
  min-height: 68px;
  word-break: break-all;
  line-height: 1.8;
  color: var(--wem-text-2);
}

.risk-list {
  margin: 12px 0 0;
  padding-left: 18px;
  color: var(--wem-text-2);
  font-size: 12.5px;
  line-height: 1.7;
}

.risk-list li + li {
  margin-top: 4px;
}

.cmd-preview {
  background: var(--wem-card-alt);
  border: 1px solid var(--wem-border);
  border-radius: 8px;
  padding: 10px 12px;
  max-height: 220px;
  overflow: auto;
  line-height: 1.8;
  color: var(--wem-text-2);
  white-space: pre;
}
</style>
