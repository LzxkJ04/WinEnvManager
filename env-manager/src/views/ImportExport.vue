<template>
  <div>
    <a-tabs v-model:active-key="tab" type="card" size="small">
      <!-- ==================== 批量导出 ==================== -->
      <a-tab-pane key="export" tab="批量导出">
        <div class="wem-card">
          <div class="wem-card-head">
            <div class="wem-card-title"><ExportOutlined /> 批量导出</div>
            <span class="text-muted">把选定范围内的变量导出为文件，便于迁移到其它机器</span>
          </div>
          <div class="wem-card-body">
            <div class="toolbar" style="margin-bottom: 12px">
              <span class="text-muted">导出范围：</span>
              <a-radio-group v-model:value="exportScope" button-style="solid" size="small">
                <a-radio-button value="all">全部变量</a-radio-button>
                <a-radio-button value="user">仅用户变量</a-radio-button>
                <a-radio-button value="machine">仅系统变量</a-radio-button>
                <a-radio-button value="custom">自定义勾选</a-radio-button>
              </a-radio-group>
            </div>
            <div class="toolbar" style="margin-bottom: 12px">
              <span class="text-muted">文件格式：</span>
              <a-radio-group v-model:value="exportFormat" size="small">
                <a-radio-button value="json">JSON</a-radio-button>
                <a-radio-button value="txt">TXT</a-radio-button>
                <a-radio-button value="reg">REG</a-radio-button>
                <a-radio-button value="env">.env</a-radio-button>
                <a-radio-button value="cmd">CMD 脚本</a-radio-button>
                <a-radio-button value="ps1">PowerShell 脚本</a-radio-button>
              </a-radio-group>
              <a-checkbox v-model:checked="exportMask">批量脱敏（替换密钥类敏感值）</a-checkbox>
              <a-button type="primary" size="small" :loading="exporting" @click="doExport">
                <template #icon><DownloadOutlined /></template>
                导出（{{ exportCount }} 项）
              </a-button>
            </div>

            <a-table
              v-if="exportScope === 'custom'"
              class="wem-table" size="small" row-key="__key" :data-source="customRows"
              :columns="customColumns" :pagination="{ pageSize: 10, size: 'small' }"
              :row-selection="{ selectedRowKeys: customKeys, onChange: (k) => (customKeys = k) }"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'scope'">
                  <a-tag :color="record.scope === 'machine' ? 'purple' : 'blue'">{{ record.scope === 'machine' ? '系统' : '用户' }}</a-tag>
                </template>
                <template v-else-if="column.key === 'name'"><span class="mono">{{ record.name }}</span></template>
                <template v-else-if="column.key === 'value'"><span class="cell-value">{{ clip(record.value) }}</span></template>
              </template>
            </a-table>
          </div>
        </div>
      </a-tab-pane>

      <!-- ==================== 批量导入 ==================== -->
      <a-tab-pane key="import" tab="批量导入">
        <div class="wem-card">
          <div class="wem-card-head">
            <div class="wem-card-title"><ImportOutlined /> 批量导入</div>
            <div class="toolbar">
              <a-button size="small" @click="pickImportFile">
                <template #icon><FolderOpenOutlined /></template>
                加载 reg / json / env / properties / txt
              </a-button>
              <a-button size="small" @click="pasteOpen = true">粘贴导入</a-button>
            </div>
          </div>
          <div class="wem-card-body">
            <div v-if="!importRows.length && !mappingOpen" class="empty-block">
              支持 <span class="mono">.reg</span> / <span class="mono">.json</span> / <span class="mono">.env</span> /
              <span class="mono">.properties</span> / 纯文本 key=value。<br />
              .env 与 .properties 文件会进入可视化字段映射编辑器（自动映射 + 手动调整），导入后默认进入草稿区。
            </div>

            <!-- 普通导入（reg/json）-->
            <template v-if="importRows.length && !mappingOpen">
              <div class="stat-grid" style="margin-bottom: 12px">
                <div class="stat-card"><div class="stat-label">解析条目</div><div class="stat-value">{{ importRows.length }}</div></div>
                <div class="stat-card"><div class="stat-label">将新增</div><div class="stat-value" style="color:#00b42a">{{ importStats.create }}</div></div>
                <div class="stat-card"><div class="stat-label">同名冲突</div><div class="stat-value" style="color:#ff7d00">{{ importStats.conflict }}</div></div>
                <div class="stat-card"><div class="stat-label">值相同</div><div class="stat-value" style="color:var(--wem-text-3)">{{ importStats.same }}</div></div>
              </div>

              <div class="toolbar" style="margin-bottom: 10px">
                <span class="text-muted">导入到：</span>
                <a-radio-group v-model:value="importScope" button-style="solid" size="small" @change="recalc">
                  <a-radio-button value="keep">保持文件中的归属</a-radio-button>
                  <a-radio-button value="user">全部到用户变量</a-radio-button>
                  <a-radio-button value="machine">全部到系统变量</a-radio-button>
                </a-radio-group>
                <span class="text-muted" style="margin-left:10px">冲突策略：</span>
                <a-radio-group v-model:value="conflictMode" size="small">
                  <a-radio-button value="overwrite">覆盖</a-radio-button>
                  <a-radio-button value="merge">合并</a-radio-button>
                  <a-radio-button value="skip">仅新增不覆盖</a-radio-button>
                </a-radio-group>
                <a-button type="primary" size="small" :disabled="!selectedImport.length" :loading="importing" @click="doImport">
                  <template #icon><UploadOutlined /></template>
                  导入（{{ selectedImport.length }} 项）
                </a-button>
                <a-button size="small" @click="clearImport">清空</a-button>
              </div>

              <a-table
                class="wem-table" size="small" row-key="__key" :data-source="importRows"
                :columns="importColumns" :pagination="{ pageSize: 10, size: 'small' }"
                :row-selection="{ selectedRowKeys: importKeys, onChange: (k) => (importKeys = k) }"
                :row-class-name="importRowClass"
              >
                <template #bodyCell="{ column, record }">
                  <template v-if="column.key === 'status'">
                    <a-tag :color="{ create: 'green', conflict: 'orange', same: 'default' }[record.status]">
                      {{ { create: '新增', conflict: '冲突', same: '相同' }[record.status] }}
                    </a-tag>
                  </template>
                  <template v-else-if="column.key === 'target'">
                    <a-tag :color="record.targetScope === 'machine' ? 'purple' : 'blue'">{{ record.targetScope === 'machine' ? '系统' : '用户' }}</a-tag>
                  </template>
                  <template v-else-if="column.key === 'name'"><span class="mono">{{ record.name }}</span></template>
                  <template v-else-if="column.key === 'value'"><span class="cell-value">{{ clip(record.value) }}</span></template>
                  <template v-else-if="column.key === 'current'">
                    <span class="diff-value-old">{{ record.current === null ? '（不存在）' : clip(record.current) }}</span>
                  </template>
                </template>
              </a-table>
            </template>

            <!-- 字段映射向导（.env / .properties）-->
            <template v-if="mappingOpen">
              <a-steps :current="mapStep" size="small" style="margin-bottom: 14px">
                <a-step title="解析文件" /><a-step title="字段映射" /><a-step title="冲突策略" /><a-step title="导入预览" />
              </a-steps>

              <!-- 步骤2：映射编辑器 -->
              <div v-if="mapStep === 1">
                <div class="toolbar" style="margin-bottom: 10px">
                  <a-button size="small" @click="autoMap">自动映射</a-button>
                  <a-input v-model:value="mapPrefix" size="small" style="width: 140px" placeholder="前缀，如 PROJ_" />
                  <a-button size="small" @click="batchPrefix">批量追加前缀</a-button>
                  <a-button size="small" @click="batchRemovePrefix">批量移除前缀</a-button>
                  <a-button size="small" @click="batchDotToUnderscore">批量替换 . 为 _</a-button>
                  <a-button size="small" @click="mapRows.forEach((r) => (r.enabled = true))">全部启用</a-button>
                  <a-button size="small" @click="mapRows.forEach((r) => (r.enabled = false))">全部跳过</a-button>
                </div>
                <a-table
                  size="small" row-key="__key" :data-source="mapRows" :pagination="{ pageSize: 12, size: 'small' }"
                  :columns="mapColumns" :scroll="{ x: 640, y: 320 }"
                  :row-class-name="(r) => (r.issues && r.issues.length ? 'row-removed' : '')"
                >
                  <template #bodyCell="{ column, record }">
                    <template v-if="column.key === 'sourceKey'"><span class="mono">{{ record.sourceKey }}</span></template>
                    <template v-else-if="column.key === 'target'">
                      <a-input v-model:value="record.targetName" size="small" class="mono" :disabled="!record.enabled" />
                      <div v-if="record.issues && record.issues.length" style="color:#f53f3f;font-size:11px">{{ record.issues.join('；') }}</div>
                    </template>
                    <template v-else-if="column.key === 'scope'">
                      <a-radio-group v-model:value="record.targetScope" size="small" :disabled="!record.enabled">
                        <a-radio value="user">用户</a-radio>
                        <a-radio value="machine">系统</a-radio>
                      </a-radio-group>
                    </template>
                    <template v-else-if="column.key === 'value'"><span class="cell-path">{{ clip(record.value) }}</span></template>
                    <template v-else-if="column.key === 'enabled'">
                      <a-checkbox v-model:checked="record.enabled">{{ record.enabled ? '启用' : '跳过该行' }}</a-checkbox>
                    </template>
                  </template>
                </a-table>
                <div class="toolbar" style="margin-top: 12px">
                  <a-button @click="mapStep = 0">上一步</a-button>
                  <div class="toolbar-right"></div>
                  <a-button type="primary" :disabled="!enabledRows.length" @click="mapStep = 2">
                    下一步（{{ enabledRows.length }} 条启用）
                  </a-button>
                </div>
              </div>

              <!-- 步骤3：冲突策略 + 附加选项 -->
              <div v-else-if="mapStep === 2">
                <a-form layout="vertical">
                  <a-form-item label="冲突处理策略（草稿 / 系统中已有同名变量时）">
                    <a-radio-group v-model:value="mapConflict">
                      <a-radio value="overwrite">覆盖：直接使用导入文件新值</a-radio>
                      <a-radio value="merge">合并：路径类变量去重追加，普通变量逐个询问</a-radio>
                      <a-radio value="skip">仅新增：已有同名变量则跳过</a-radio>
                    </a-radio-group>
                  </a-form-item>
                  <a-form-item label="附加选项">
                    <a-space direction="vertical" :size="6">
                      <a-checkbox v-model:checked="mapOpt.remark">导入变量添加备注（记录来源文件名 + 导入时间）</a-checkbox>
                      <a-checkbox v-model:checked="mapOpt.markSource">自动标记来源为「批量导入」</a-checkbox>
                      <a-checkbox v-model:checked="mapOpt.sensitive">敏感值自动检测并高亮提醒</a-checkbox>
                      <a-checkbox v-model:checked="mapOpt.newConfigSet">将本次导入变量打包新建为【项目配置集】</a-checkbox>
                    </a-space>
                  </a-form-item>
                </a-form>
                <div v-if="sensitiveRows.length" class="hint-box danger">
                  <WarningOutlined />
                  <div>检测到 {{ sensitiveRows.length }} 条疑似敏感值：<span class="mono">{{ sensitiveRows.slice(0, 5).map((r) => r.targetName).join('、') }}</span></div>
                </div>
                <div class="toolbar" style="margin-top: 12px">
                  <a-button @click="mapStep = 1">上一步</a-button>
                  <div class="toolbar-right"></div>
                  <a-button type="primary" @click="goMapPreview">下一步：导入预览</a-button>
                </div>
              </div>

              <!-- 步骤4：导入预览 -->
              <div v-else-if="mapStep === 3">
                <div class="stat-grid" style="margin-bottom: 12px">
                  <div class="stat-card"><div class="stat-label">将新增</div><div class="stat-value" style="color:#00b42a">{{ mapStats.create }}</div></div>
                  <div class="stat-card"><div class="stat-label">将覆盖</div><div class="stat-value" style="color:#ff7d00">{{ mapStats.conflict }}</div></div>
                  <div class="stat-card"><div class="stat-label">跳过</div><div class="stat-value" style="color:var(--wem-text-3)">{{ mapStats.skip }}</div></div>
                  <div class="stat-card"><div class="stat-label">阻断</div><div class="stat-value" style="color:#f53f3f">{{ mapStats.blocked }}</div></div>
                </div>
                <div v-if="loopRefs.length" class="hint-box danger" style="margin-bottom: 10px">
                  <WarningOutlined />
                  <div>检测到循环变量引用，已阻断导入：<span class="mono">{{ loopRefs.join('、') }}</span></div>
                </div>
                <a-table
                  size="small" row-key="__key" :data-source="mapPreviewRows" :pagination="{ pageSize: 10, size: 'small' }"
                  :columns="previewColumns" :scroll="{ x: 640, y: 260 }" :row-class-name="importRowClass"
                >
                  <template #bodyCell="{ column, record }">
                    <template v-if="column.key === 'status'">
                      <a-tag :color="{ create: 'green', conflict: 'orange', same: 'default', blocked: 'red' }[record.status]">
                        {{ { create: '新增', conflict: '覆盖', same: '相同', blocked: '阻断' }[record.status] }}
                      </a-tag>
                    </template>
                    <template v-else-if="column.key === 'target'">
                      <a-tag :color="record.targetScope === 'machine' ? 'purple' : 'blue'">{{ record.targetScope === 'machine' ? '系统' : '用户' }}</a-tag>
                    </template>
                    <template v-else-if="column.key === 'name'"><span class="mono">{{ record.targetName }}</span></template>
                    <template v-else-if="column.key === 'value'"><span class="cell-path">{{ clip(record.value) }}</span></template>
                    <template v-else-if="column.key === 'current'">
                      <span class="diff-value-old">{{ record.current === null ? '（不存在）' : clip(record.current) }}</span>
                    </template>
                  </template>
                </a-table>
                <div class="toolbar" style="margin-top: 12px">
                  <a-button @click="mapStep = 2">上一步</a-button>
                  <div class="toolbar-right"></div>
                  <a-button type="primary" :disabled="mapStats.blocked > 0 || loopRefs.length > 0 || (mapStats.create + mapStats.conflict === 0)" :loading="importing" @click="submitMappingImport">
                    确认导入（进入草稿区）
                  </a-button>
                </div>
              </div>
            </template>
          </div>
        </div>
      </a-tab-pane>

      <!-- ==================== 批量工具 ==================== -->
      <a-tab-pane key="tools" tab="批量工具">
        <div class="split-2">
          <div class="wem-card">
            <div class="wem-card-head">
              <div class="wem-card-title"><SwapOutlined /> 批量替换工具</div>
              <span class="text-muted">批量查找变量值内的指定文本并替换，预览后写入草稿</span>
            </div>
            <div class="wem-card-body">
              <a-form layout="vertical">
                <a-row :gutter="10">
                  <a-col :span="10"><a-input v-model:value="repFind" size="small" class="mono" placeholder="查找文本（如 D:\\old\\path）" /></a-col>
                  <a-col :span="10"><a-input v-model:value="repReplace" size="small" class="mono" placeholder="替换为（如 D:\\new\\path）" /></a-col>
                  <a-col :span="4"><a-button size="small" type="primary" block @click="previewReplace">预览</a-button></a-col>
                </a-row>
                <a-checkbox v-model:checked="repCaseInsensitive" style="margin-top:8px">忽略大小写</a-checkbox>
              </a-form>
              <a-table
                v-if="repRows.length" style="margin-top: 12px" size="small" :data-source="repRows" :pagination="false"
                :columns="[{ title: '变量', key: 'name', width: 180 }, { title: '替换前', key: 'before', ellipsis: true }, { title: '替换后', key: 'after', ellipsis: true }]"
                :row-selection="{ selectedRowKeys: repKeys, onChange: (k) => (repKeys = k) }" row-key="key"
              >
                <template #bodyCell="{ column, record }">
                  <template v-if="column.key === 'name'"><span class="mono">{{ record.scope === 'machine' ? '[系统]' : '[用户]' }} {{ record.name }}</span></template>
                  <template v-else-if="column.key === 'before'"><span class="diff-value-old">{{ clip(record.before) }}</span></template>
                  <template v-else-if="column.key === 'after'"><span class="diff-value-new">{{ clip(record.after) }}</span></template>
                </template>
              </a-table>
              <a-button
                v-if="repRows.length" type="primary" size="small" style="margin-top:10px"
                :disabled="!repKeys.length" @click="applyReplace"
              >应用选中（{{ repKeys.length }}）到草稿区</a-button>
            </div>
          </div>

          <div class="wem-card">
            <div class="wem-card-head">
              <div class="wem-card-title"><DeleteOutlined /> 批量删除</div>
              <span class="text-muted">按变量名关键词批量筛选并标记删除</span>
            </div>
            <div class="wem-card-body">
              <a-form layout="vertical">
                <a-row :gutter="10">
                  <a-col :span="14"><a-input v-model:value="delKeyword" size="small" class="mono" placeholder="变量名关键词（如 OLD_ / TEST_）" /></a-col>
                  <a-col :span="10"><a-button size="small" type="primary" block danger @click="previewDelete">筛选预览</a-button></a-col>
                </a-row>
              </a-form>
              <a-table
                v-if="delRows.length" style="margin-top: 12px" size="small" :data-source="delRows" :pagination="{ pageSize: 8 }"
                :columns="[{ title: '变量', key: 'name' }, { title: '值', key: 'value', ellipsis: true }]"
                :row-selection="{ selectedRowKeys: delKeys, onChange: (k) => (delKeys = k) }" row-key="key"
              >
                <template #bodyCell="{ column, record }">
                  <template v-if="column.key === 'name'"><span class="mono">{{ record.scope === 'machine' ? '[系统]' : '[用户]' }} {{ record.name }}</span></template>
                  <template v-else-if="column.key === 'value'"><span class="cell-value">{{ clip(record.value) }}</span></template>
                </template>
              </a-table>
              <a-button
                v-if="delRows.length" danger size="small" style="margin-top:10px"
                :disabled="!delKeys.length" @click="applyDelete"
              >标记选中（{{ delKeys.length }}）为待删除</a-button>
            </div>
          </div>
        </div>
      </a-tab-pane>
    </a-tabs>

    <!-- 粘贴导入 -->
    <a-modal v-model:open="pasteOpen" title="粘贴变量内容" ok-text="解析" cancel-text="取消" width="640px" @ok="parsePaste">
      <div class="hint-box" style="margin-bottom: 10px">
        <InfoCircleOutlined />
        <div>每行一条，支持 <span class="mono">名称=值</span> 或 <span class="mono">[用户变量] / [系统变量]</span> 分段格式。</div>
      </div>
      <a-textarea v-model:value="pasteText" :rows="12" class="mono" placeholder="DB_HOST=127.0.0.1&#10;DB_PASSWORD=&quot;abc123456&quot;" />
    </a-modal>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { Modal, message } from 'ant-design-vue'
import {
  ExportOutlined, ImportOutlined, DownloadOutlined, UploadOutlined,
  FolderOpenOutlined, InfoCircleOutlined, SwapOutlined, DeleteOutlined, WarningOutlined
} from '@ant-design/icons-vue'
import { useEnvStore } from '@/store/env'
import { useUiStore } from '@/store/ui'
import api from '@/api'
import { buildScript, detectSensitive, clipText as clip, mergeImportedValue, maskSensitiveExport } from '@/lib/helpers'

const env = useEnvStore()
const ui = useUiStore()

const tab = ref('export')
const exportScope = ref('all')
const exportFormat = ref('json')
const exportMask = ref(env.config.desensitizeExport === true)
const exporting = ref(false)
const customKeys = ref([])

const importScope = ref('keep')
const conflictMode = ref('overwrite')
const importRows = ref([])
const importKeys = ref([])
const importing = ref(false)
const pasteOpen = ref(false)
const pasteText = ref('')

/* 映射向导 */
const mappingOpen = ref(false)
const mapStep = ref(1)
const mapRows = ref([])
const mapConflict = ref('overwrite')
const mapOpt = reactive({ remark: true, markSource: true, sensitive: true, newConfigSet: false })
const mapFileName = ref('')
const mapPrefix = ref('')
const mapPreviewRows = ref([])
const loopRefs = ref([])

/* 批量工具 */
const repFind = ref('')
const repReplace = ref('')
const repCaseInsensitive = ref(false)
const repRows = ref([])
const repKeys = ref([])
const delKeyword = ref('')
const delRows = ref([])
const delKeys = ref([])

const customColumns = [
  { title: '归属', key: 'scope', width: 76 },
  { title: '变量名', key: 'name', width: 200, ellipsis: true },
  { title: '变量值', key: 'value', ellipsis: true }
]

const importColumns = [
  { title: '状态', key: 'status', width: 76 },
  { title: '归属', key: 'target', width: 76 },
  { title: '变量名', key: 'name', width: 200, ellipsis: true },
  { title: '导入值', key: 'value', ellipsis: true },
  { title: '当前值', key: 'current', ellipsis: true }
]

const mapColumns = [
  { title: '源文件键名', key: 'sourceKey', width: 190 },
  { title: '映射至 WinEnv 变量名', key: 'target', width: 230 },
  { title: '归属域', key: 'scope', width: 160 },
  { title: '值', key: 'value', ellipsis: true },
  { title: '启用', key: 'enabled', width: 110 }
]

const previewColumns = [
  { title: '状态', key: 'status', width: 80 },
  { title: '归属', key: 'target', width: 76 },
  { title: '变量名', key: 'name', width: 190, ellipsis: true },
  { title: '导入值', key: 'value', ellipsis: true },
  { title: '当前值', key: 'current', ellipsis: true }
]

const customRows = computed(() =>
  ['user', 'machine'].flatMap((scope) =>
    env.working[scope].filter((i) => !i._deleted).map((i) => ({ ...i, __key: `${scope}::${i.name}` }))
  )
)

const exportCount = computed(() => {
  if (exportScope.value === 'custom') return customKeys.value.length
  if (exportScope.value === 'user') return env.counts.user
  if (exportScope.value === 'machine') return env.counts.machine
  return env.counts.total
})

const selectedImport = computed(() => importRows.value.filter((r) => importKeys.value.includes(r.__key)))
const enabledRows = computed(() => mapRows.value.filter((r) => r.enabled))
const sensitiveRows = computed(() => {
  if (env.config.detectSensitive === false) return []
  return enabledRows.value.filter((r) => detectSensitive(r.targetName, r.value).length)
})

const mapStats = computed(() => ({
  create: mapPreviewRows.value.filter((r) => r.status === 'create').length,
  conflict: mapPreviewRows.value.filter((r) => r.status === 'conflict').length,
  skip: mapPreviewRows.value.filter((r) => r.status === 'same').length,
  blocked: mapPreviewRows.value.filter((r) => r.status === 'blocked').length
}))

function selectedFromCustom() {
  return customRows.value
    .filter((r) => customKeys.value.includes(r.__key))
    .map((r) => ({ name: r.name, value: r.value, scope: r.scope }))
}

function collectExportVars() {
  if (exportScope.value === 'custom') return selectedFromCustom()
  const scopes = exportScope.value === 'all' ? ['user', 'machine'] : [exportScope.value]
  return scopes.flatMap((scope) =>
    env.working[scope].filter((i) => !i._deleted).map((i) => ({ name: i.name, value: i.value, scope }))
  )
}

/* ------------------------------ 导出 ------------------------------ */

async function doExport() {
  if (!exportCount.value) return message.warning('没有可导出的变量')
  const vars = collectExportVars()
  if (!vars.length) return message.warning('没有可导出的变量')

  const saved = await api.fs.saveFile({
    title: '导出环境变量',
    defaultPath: `EnvVars-${exportScope.value}.${exportFormat.value}`,
    filters: [{ name: exportFormat.value.toUpperCase(), extensions: [exportFormat.value] }]
  })
  if (!saved.ok || saved.data.canceled) return

  exporting.value = true
  try {
    let content = ''
    let bom = false
    const list = exportMask.value ? vars.map((v) => ({ ...v, value: mask(v.value, v.name) })) : vars

    if (['json', 'txt', 'reg'].includes(exportFormat.value)) {
      content = buildLegacy(list, exportFormat.value)
      bom = exportFormat.value !== 'json'
    } else if (exportFormat.value === 'env') {
      content = buildDotEnv(list)
    } else {
      content = buildScript(
        list.map((v) => ({ name: v.name, value: v.value, action: 'create' })),
        exportFormat.value === 'cmd' ? 'cmd' : 'ps'
      )
    }
    const res = await api.fs.writeTextFile({ file: saved.data.path, content, bom })
    if (res.ok) {
      message.success(`已导出 ${list.length} 个变量`)
      ui.tip(`导出完成：${saved.data.path}`, 'success')
    } else message.error(res.message)
  } finally {
    exporting.value = false
  }
}

function buildLegacy(vars, format) {
  if (format === 'json') {
    return JSON.stringify({ app: 'WinEnvManager', type: 'env-export', exportedAt: new Date().toISOString(), vars }, null, 2)
  }
  if (format === 'txt') {
    const lines = ['# WinEnvManager 环境变量导出', `# 时间: ${new Date().toLocaleString('zh-CN')}`, '']
    for (const scope of ['user', 'machine']) {
      const list = vars.filter((v) => v.scope === scope)
      if (list.length) {
        lines.push(scope === 'user' ? '[用户变量]' : '[系统变量]')
        for (const v of list) lines.push(`${v.name}=${v.value}`)
        lines.push('')
      }
    }
    return lines.join('\r\n')
  }
  const lines = ['Windows Registry Editor Version 5.00', '']
  for (const scope of ['user', 'machine']) {
    const list = vars.filter((v) => v.scope === scope)
    if (list.length) {
      lines.push(scope === 'user' ? '[HKEY_CURRENT_USER\\Environment]' : '[HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment]')
      for (const v of list) lines.push(`"${v.name}"="${String(v.value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
      lines.push('')
    }
  }
  return lines.join('\r\n')
}

function buildDotEnv(vars) {
  const lines = ['# 由 WinEnv管家 导出', `# ${new Date().toLocaleString('zh-CN')}`, '']
  for (const v of vars) {
    const value = String(v.value).includes('"') ? `'${v.value}'` : `"${v.value}"`
    lines.push(`${v.name.toUpperCase()}=${value}`)
  }
  return lines.join('\r\n')
}

function mask(value, name) {
  return maskSensitiveExport(name, value)
}

/* ------------------------------ 导入 ------------------------------ */

async function pickImportFile() {
  const picked = await api.fs.selectFile({
    title: '选择要导入的变量文件',
    filters: [{ name: '变量文件', extensions: ['json', 'txt', 'reg', 'env', 'properties', 'cfg', 'conf'] }]
  })
  if (!picked.ok || picked.data.canceled) return
  const read = await api.fs.readTextFile(picked.data.path)
  if (!read.ok) return message.error(read.message)
  handleImportContent(String(read.data), picked.data.path)
}

function parsePaste() {
  handleImportContent(pasteText.value, '（粘贴内容）')
  pasteOpen.value = false
}

function handleImportContent(text, source) {
  const lower = String(source || '').toLowerCase()
  const isEnvFile = lower.endsWith('.env') || lower.endsWith('.properties') || lower.endsWith('.cfg') || lower.endsWith('.conf')

  api.backup.parseText(text).then(async (res) => {
    if (!res.ok) return message.error(`解析失败：${res.message}`)

    if (isEnvFile || lower.endsWith('.txt')) {
      // 走字段映射向导
      mapFileName.value = source
      const parsed = await parseMapping(text, source)
      if (!parsed.length) return message.warning('未解析到任何变量，请检查文件内容')
      mapRows.value = parsed.map((e, idx) => ({
        __key: `${e.key}::${idx}`,
        sourceKey: e.key,
        originalKey: e.originalKey || e.key,
        value: e.value,
        line: e.line,
        issues: e.issues || [],
        targetName: e.key,
        targetScope: e.defaultScope || 'user',
        enabled: (e.issues || []).length === 0
      }))
      mappingOpen.value = true
      mapStep.value = 1
      return
    }

    // reg / json 走原预览流程
    importRows.value = res.data.entries.map((e, idx) => ({
      ...e,
      __key: `${e.scope}::${e.name}::${idx}`,
      targetScope: e.scope,
      status: 'create',
      current: null
    }))
    recalc()
    message.success(`已解析 ${res.data.total} 条变量（来源：${source}）`)
  })
}

/** 解析 .env / .properties，按规格处理键名 / 引号 / 转义 / ${VAR} -> %VAR% */
async function parseMapping(text, source) {
  const res = await api.backup.parseText(text)
  if (!res.ok) throw new Error(res.message)
  return res.data.entries
}

/* 映射操作 */
function autoMap() {
  for (const r of mapRows.value) r.targetName = String(r.sourceKey || '').toUpperCase()
  message.success('已自动映射：源键名 → 大写变量名')
}
function batchPrefix() {
  const prefix = String(mapPrefix.value || '').trim()
  if (!prefix) return message.warning('请先在旁边的输入框填写前缀，例如 PROJ_')
  let count = 0
  for (const row of mapRows.value) {
    if (!row.enabled || String(row.targetName || '').startsWith(prefix)) continue
    row.targetName = prefix + row.targetName
    count += 1
  }
  message.success(count ? `已为 ${count} 条追加前缀 ${prefix}` : '启用的变量名已经有此前缀')
}
function batchRemovePrefix() {
  const prefix = String(mapPrefix.value || '').trim()
  if (!prefix) return message.warning('请先在旁边的输入框填写要移除的前缀')
  let count = 0
  for (const row of mapRows.value) {
    if (row.enabled && prefix && String(row.targetName || '').startsWith(prefix)) {
      row.targetName = row.targetName.slice(prefix.length)
      count += 1
    }
  }
  message.success(count ? `已从 ${count} 条变量名移除前缀` : '没有启用的变量名带此前缀')
}
function batchDotToUnderscore() {
  for (const r of mapRows.value) if (r.enabled) r.targetName = r.targetName.replace(/\./g, '_')
  message.success('已将变量名中的点号替换为下划线')
}

/** 循环引用检测：A 引用 B 且 B 引用 A */
function detectLoops(rows) {
  const graph = new Map()
  for (const r of rows) {
    const refs = (String(r.value).match(/%([^%]+)%/g) || []).map((s) => s.slice(1, -1).toUpperCase())
    graph.set(r.targetName.toUpperCase(), refs)
  }
  const bad = new Set()
  for (const [k, refs] of graph.entries()) {
    for (const ref of refs) {
      if (graph.has(ref) && (graph.get(ref) || []).includes(k)) {
        bad.add(`${k} ↔ ${ref}`)
      }
    }
  }
  return [...bad]
}

function goMapPreview() {
  buildMapPreview()
  mapStep.value = 3
}

function buildMapPreview() {
  const rows = []
  for (const r of enabledRows.value) {
    const targetScope = r.targetScope === 'machine' ? 'machine' : 'user'
    const cur = currentOf(targetScope, r.targetName)
    const exists = cur !== null && cur !== undefined
    let status = 'create'
    if (exists && cur === r.value) status = 'same'
    else if (exists) status = 'conflict'
    // 非法变量名阻断
    if (/^[=]|[%]/.test(r.targetName)) status = 'blocked'
    rows.push({
      __key: r.__key,
      targetName: r.targetName,
      targetScope,
      value: r.value,
      current: exists ? cur : null,
      status
    })
  }
  mapPreviewRows.value = rows
  loopRefs.value = detectLoops(rows)
  return rows
}

async function submitMappingImport() {
  const rows = buildMapPreview()
  if (loopRefs.value.length) return message.error('存在循环引用，已阻断导入')
  let targets = rows.filter((r) => r.status !== 'same' && r.status !== 'blocked')

  // 冲突策略
  if (mapConflict.value === 'skip') {
    targets = targets.filter((r) => r.status !== 'conflict')
  } else if (mapConflict.value === 'merge') {
    for (const r of targets.filter((t) => t.status === 'conflict')) {
      const upper = r.targetName.toUpperCase()
      if (upper === 'PATH' || upper === 'PATHEXT' || upper === 'PSMODULEPATH' || String(r.current || '').includes(';') || String(r.value || '').includes(';')) {
        r.value = mergeImportedValue(r.targetName, r.current, r.value)
      } else {
        const keepNew = await new Promise((resolve) => {
          Modal.confirm({
            title: `变量 ${r.targetName} 冲突`,
            content: `当前值：${clip(r.current, 60)}\n导入值：${clip(r.value, 60)}`,
            okText: '使用导入新值',
            cancelText: '保留旧值',
            onOk: () => resolve(true),
            onCancel: () => resolve(false)
          })
        })
        if (!keepNew) r.value = r.current
      }
    }
  }
  targets = targets.filter((r) => r.value !== r.current)

  if (!targets.length) return message.info('没有需要导入的条目')

  const opts = {
    source: mapOpt.markSource ? 'import' : 'manual',
    originId: `import-${mapFileName.value}`,
    originName: `批量导入 ${mapFileName.value}`
  }
  const r = env.applyTemplateVars(targets.map((t) => ({ scope: t.targetScope, name: t.targetName, value: t.value, op: 'create' })), opts)

  // 备注
  if (mapOpt.remark) {
    for (const t of targets) {
      api.meta.set({
        scope: t.targetScope,
        name: t.targetName,
        patch: { remark: `来自 ${mapFileName.value} @ ${new Date().toLocaleString('zh-CN')}` }
      })
    }
  }

  // 打包为项目配置集
  if (mapOpt.newConfigSet) {
    const res = await api.envset.create({
      name: `导入 ${mapFileName.value}`,
      type: 'project',
      comment: '由批量导入生成',
      variables: targets.map((t) => ({ scope: t.targetScope === 'machine' ? 'system' : 'user', key: t.targetName, value: t.value, remark: '' }))
    })
    if (res.ok) message.success('已创建项目配置集')
  }

  mappingOpen.value = false
  mapRows.value = []
  message.success(`已导入 ${r.added.length} 条变量到草稿区（来源：批量导入）`)
  ui.tip(`批量导入完成：${r.added.length} 条`, 'success')
}

/* 普通导入（reg/json）相关 */
function currentOf(scope, name) {
  const item = env.findItem(scope, name)
  if (item && !item._deleted) return item.value
  const map = env.original[scope] || {}
  if (Object.prototype.hasOwnProperty.call(map, name)) return map[name]
  const upper = String(name || '').toUpperCase()
  const key = Object.keys(map).find((itemName) => itemName.toUpperCase() === upper)
  return key == null ? null : map[key]
}

function recalc() {
  for (const row of importRows.value) {
    const scope = importScope.value === 'keep' ? row.scope : importScope.value
    row.targetScope = scope
    const cur = currentOf(scope, row.name)
    const has = cur !== null && cur !== undefined
    row.current = has ? cur : null
    row.status = !has ? 'create' : cur === row.value ? 'same' : 'conflict'
  }
  importKeys.value = importRows.value
    .filter((r) => !(r.targetScope === 'machine' && !env.admin))
    .map((r) => r.__key)
}

function importRowClass(record) {
  return record.status === 'conflict' ? 'diff-row-changed' : record.status === 'create' ? 'diff-row-added' : record.status === 'blocked' ? 'row-removed' : ''
}

function clearImport() {
  importRows.value = []
  importKeys.value = []
  mappingOpen.value = false
}

async function doImport() {
  let targets = selectedImport.value.filter((r) => !(r.targetScope === 'machine' && !env.admin))
  if (importScope.value === 'machine' && !env.admin) {
    return Modal.warning({ title: '需要管理员权限', content: '全部导入到系统变量需要管理员权限，请先以管理员身份重新启动程序。' })
  }
  if (conflictMode.value === 'skip') targets = targets.filter((r) => r.status !== 'conflict')
  else if (conflictMode.value === 'merge') {
    targets = targets.map((row) => {
      if (row.status !== 'conflict') return row
      return { ...row, value: mergeImportedValue(row.name, row.current, row.value) }
    }).filter((row) => row.status !== 'conflict' || row.value !== row.current)
  }

  if (!targets.length) return message.info('没有需要导入的条目')
  const changes = targets.map((t) => ({
    action: t.status === 'conflict' ? 'update' : 'create',
    scope: t.targetScope,
    name: t.name,
    value: t.value
  }))
  const mergeNote = conflictMode.value === 'merge'
    ? '合并时，PATH、PATHEXT、PSMODULEPATH 以及带分号的值会去重追加；其它同名变量保留当前值。'
    : '同名冲突按当前策略处理。'

  Modal.confirm({
    title: `确认导入 ${changes.length} 项环境变量？`,
    content: `该操作会先进入草稿区，不会直接写入注册表；确认后统一【保存写入系统】。${mergeNote}`,
    okText: '确认导入',
    cancelText: '取消',
    onOk: async () => {
      importing.value = true
      try {
        const r = env.applyTemplateVars(changes, { source: 'import', originId: 'bulk-import', originName: '批量导入' })
        message.success(`已导入 ${r.added.length} 项变量到草稿区`)
        ui.tip(`批量导入完成，共 ${r.added.length} 项`, 'success')
        clearImport()
      } finally {
        importing.value = false
      }
    }
  })
}

/* ------------------------------ 批量工具 ------------------------------ */

function previewReplace() {
  if (!repFind.value) return message.warning('请输入查找文本')
  const rows = []
  const re = new RegExp(repFind.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), repCaseInsensitive.value ? 'gi' : 'g')
  for (const scope of ['user', 'machine']) {
    for (const item of env.working[scope]) {
      if (item._deleted) continue
      const before = String(item.value)
      const after = before.replace(re, repReplace.value)
      if (before !== after) {
        rows.push({ key: `${scope}::${item.name}`, scope, name: item.name, before, after })
      }
    }
  }
  repRows.value = rows
  repKeys.value = rows.map((r) => r.key)
  message.info(`找到 ${rows.length} 条可替换`)
}

async function applyReplace() {
  const targets = repRows.value.filter((r) => repKeys.value.includes(r.key))
  let n = 0
  for (const t of targets) {
    try {
      env.setValue(t.scope, t.name, t.after, { source: 'manual' })
      n += 1
    } catch (err) {
      message.warning(`${t.name}：${err.message}`)
    }
  }
  message.success(`已替换 ${n} 条（进入草稿区）`)
}

function previewDelete() {
  if (!delKeyword.value) return message.warning('请输入关键词')
  const kw = delKeyword.value.toLowerCase()
  const rows = []
  for (const scope of ['user', 'machine']) {
    for (const item of env.working[scope]) {
      if (item._deleted) continue
      if (item.name.toLowerCase().includes(kw)) {
        rows.push({ key: `${scope}::${item.name}`, scope, name: item.name, value: item.value })
      }
    }
  }
  delRows.value = rows
  delKeys.value = rows.map((r) => r.key)
  message.info(`筛选到 ${rows.length} 条`)
}

function applyDelete() {
  const byScope = { user: [], machine: [] }
  for (const r of delRows.value) {
    if (delKeys.value.includes(r.key)) byScope[r.scope].push(r.name)
  }
  let n = 0
  for (const [scope, names] of Object.entries(byScope)) {
    if (!names.length) continue
    try {
      env.remove(scope, names, { source: 'manual' })
      n += names.length
    } catch (err) {
      message.warning(err.message)
    }
  }
  message.success(`已标记 ${n} 条为待删除（保存写入系统后生效）`)
  delRows.value = []
  delKeys.value = []
}
</script>

<style scoped>
.mono {
  font-family: var(--wem-mono);
  font-size: 11.5px;
  word-break: break-all;
}

.danger-link {
  color: var(--wem-danger);
}

.toolbar-right {
  margin-left: auto;
}
</style>
