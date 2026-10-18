<template>
  <div class="split-main-side">
    <!-- ============ 列表区 ============ -->
    <div class="wem-card">
      <div class="wem-card-head">
        <div class="wem-card-title">
          <ProfileOutlined />
          <span>{{ title }}</span>
          <a-tag color="blue">{{ rows.length }}</a-tag>
          <a-tag v-if="modifiedCount" color="orange">{{ modifiedCount }} 项已修改</a-tag>
        </div>
        <div class="toolbar">
          <a-input
            v-model:value="keyword"
            size="small"
            allow-clear
            placeholder="搜索变量名或变量值"
            style="width: min(208px, 100%)"
          >
            <template #prefix><SearchOutlined /></template>
          </a-input>
          <a-select v-model:value="filterMode" size="small" style="width: 132px">
            <a-select-option value="all">全部变量</a-select-option>
            <a-select-option value="user">仅用户变量</a-select-option>
            <a-select-option value="machine">仅系统变量</a-select-option>
            <a-select-option value="modified">仅已修改项</a-select-option>
          </a-select>
        </div>
      </div>

      <div class="wem-card-head" style="padding-top: 8px; padding-bottom: 8px">
        <div class="toolbar">
          <a-button type="primary" size="small" @click="openAdd">
            <template #icon><PlusOutlined /></template>
            新增变量
          </a-button>
          <a-button size="small" :disabled="!selection.length" @click="openRename">
            <template #icon><EditOutlined /></template>
            重命名
          </a-button>
          <a-button size="small" danger :disabled="!selection.length" @click="confirmDelete">
            <template #icon><DeleteOutlined /></template>
            删除{{ selection.length ? `（${selection.length}）` : '' }}
          </a-button>
          <a-dropdown :disabled="!selection.length">
            <a-button size="small" :disabled="!selection.length">
              <template #icon><CopyOutlined /></template>
              复制 <DownOutlined />
            </a-button>
            <template #overlay>
              <a-menu @click="({ key }) => copy(key)">
                <a-menu-item key="name">复制变量名</a-menu-item>
                <a-menu-item key="value">复制变量值</a-menu-item>
                <a-menu-item key="pair">复制「名称=值」</a-menu-item>
              </a-menu>
            </template>
          </a-dropdown>
          <a-button v-if="hasDeleted" size="small" @click="restoreDeleted">
            <template #icon><UndoOutlined /></template>
            取消待删除
          </a-button>
          <a-divider type="vertical" />
          <a-button size="small" @click="pasteOpen = true">
            <template #icon><SnippetsOutlined /></template>
            剪贴板导入
          </a-button>
          <a-button v-if="showPathext" size="small" @click="pathextOpen = true">
            <template #icon><FileProtectOutlined /></template>
            PATHEXT 管理
          </a-button>
        </div>
        <div class="toolbar toolbar-right">
          <a-tag v-if="!env.admin && scopes.includes('machine')" color="orange">
            <LockOutlined /> 普通权限下系统变量只读
          </a-tag>
        </div>
      </div>

      <div class="wem-card-body tight">
        <WemTable
          ref="varTable"
          :table-id="tableId"
          row-key="__key"
          :rows="rows"
          :columns="columns"
          :page-size="props.pageSize || 0"
          :capabilities="varCaps"
          :row-class="rowClassName"
          empty-text="没有匹配的环境变量"
          @selection-change="onSelectChange"
          @batch="onVarBatch"
          @row-click="onRowClick"
          @row-dblclick="focus"
          @row-context="onRowContext"
        >
          <template #cell="{ row, column }">
            <template v-if="column.key === 'name'">
              <div class="cell-tags">
              <span class="cell-name">{{ row.name }}</span>
              <a-tag v-if="row._isNew" color="green" style="margin-left: 6px">新增</a-tag>
              <a-tag v-if="row._deleted" color="red" style="margin-left: 6px">待删除</a-tag>
              <a-tag
                v-else-if="isChanged(row) && !row._isNew"
                color="orange"
                style="margin-left: 6px"
              >已修改</a-tag>
              <a-tag v-if="metaOf(row).locked" color="gold" style="margin-left: 4px"><LockOutlined /> 已锁定</a-tag>
              <a-tag v-if="metaOf(row).sensitive" color="volcano" style="margin-left: 4px"><KeyOutlined /> 敏感</a-tag>
              <a-tag v-if="metaOf(row).favorite" color="pink" style="margin-left: 4px"><StarOutlined /> 收藏</a-tag>
              <div v-if="metaOf(row).remark" class="remark-line">{{ metaOf(row).remark }}</div>
              <div v-if="metaOf(row).tags && metaOf(row).tags.length" class="remark-line">
                <a-tag v-for="t in metaOf(row).tags" :key="t" style="margin:0 4px 0 0" color="default">{{ t }}</a-tag>
              </div>
              </div>
            </template>

            <template v-else-if="column.key === 'value'">
              <a-tooltip :title="String(row.value || '（空）')" placement="topLeft" overlay-class-name="wem-tip">
                <span class="cell-value" :class="{ 'text-muted': row._deleted }">{{ displayValue(row) }}</span>
              </a-tooltip>
            </template>

            <template v-else-if="column.key === 'scope'">
              <a-tag :color="row.scope === 'machine' ? 'purple' : 'blue'">
                {{ row.scope === 'machine' ? '系统' : '用户' }}
              </a-tag>
            </template>

            <template v-else-if="column.key === 'actions'">
              <a-space size="small">
                <a-tooltip title="编辑此变量">
                  <a @click.stop="focus(row)"><EditOutlined /></a>
                </a-tooltip>
                <a-tooltip v-if="row._deleted" title="取消待删除">
                  <a @click.stop="env.restore(row.scope, [row.name])"><UndoOutlined /></a>
                </a-tooltip>
                <a-tooltip v-else title="标记删除">
                  <a class="danger-link" @click.stop="deleteOne(row)"><DeleteOutlined /></a>
                </a-tooltip>
                <a-dropdown>
                  <a @click.stop><MoreOutlined /></a>
                  <template #overlay>
                    <a-menu @click="({ key }) => rowAction(key, row)">
                      <a-menu-item key="copyName">复制变量名</a-menu-item>
                      <a-menu-item key="copyValue">复制变量值</a-menu-item>
                      <a-menu-item key="copyPair">复制「名称=值」</a-menu-item>
                      <a-menu-divider />
                      <a-menu-item key="props">备注 / 标签 / 锁定 / 收藏</a-menu-item>
                      <a-menu-item key="history">查看变更历史</a-menu-item>
                      <a-menu-item key="refs">变量引用图谱</a-menu-item>
                      <a-menu-item key="sensitive">{{ metaOf(row).sensitive ? '取消敏感标记' : '标记为敏感变量' }}</a-menu-item>
                      <a-menu-divider />
                      <a-menu-item v-if="row.scope === 'user'" key="moveToSystem">复制到系统变量</a-menu-item>
                      <a-menu-item v-else key="moveToUser">复制到用户变量</a-menu-item>
                      <a-menu-item v-if="row.name.toUpperCase() === 'PATH'" key="toPath">前往 PATH 专项管理</a-menu-item>
                    </a-menu>
                  </template>
                </a-dropdown>
              </a-space>
            </template>
          </template>
        </WemTable>
      </div>
    </div>

    <!-- ============ 详情编辑面板 ============ -->
    <div class="wem-card">
      <div class="wem-card-head">
        <div class="wem-card-title"><EditOutlined /> <span>详情编辑</span></div>
        <a-tag v-if="current" :color="current.scope === 'machine' ? 'purple' : 'blue'">
          {{ current.scope === 'machine' ? '系统变量' : '用户变量' }}
        </a-tag>
      </div>

      <div v-if="!current" class="empty-block">
        <p>请在左侧列表中<strong>双击</strong>一行，或点击「编辑」</p>
        <p class="text-muted">修改只保存在内存中，点击顶部「保存写入系统」才会生效</p>
      </div>

      <div v-else class="wem-card-body">
        <div class="hint-box" style="margin-bottom: 12px">
          <InfoCircleOutlined />
          <div>当前编辑内容仅写入内存工作集，不会立即改动注册表。</div>
        </div>

        <div style="margin-bottom: 6px" class="text-muted">变量名称</div>
        <a-input v-model:value="draftName" :disabled="!current._isNew && !!current.origName && isPathVar" size="small" />
        <div v-if="isPathVar" class="text-muted" style="margin-top: 4px; font-size: 11.5px">
          PATH 变量请前往「PATH 路径专项管理」页面按条目维护
        </div>

        <div style="margin: 12px 0 6px" class="text-muted">变量值</div>
        <a-textarea
          v-model:value="draftValue"
          :rows="isPathVar ? 8 : 4"
          :auto-size="isPathVar ? false : { minRows: 3, maxRows: 12 }"
          class="mono"
          placeholder="支持 %VARNAME% 形式引用其它变量"
        />
        <div v-if="expandedPreview" class="expand-preview">
          <div class="text-muted">展开预览（按当前内存变量只展开一层，尚未写入系统）</div>
          <div class="mono expand-text">{{ expandedPreview }}</div>
        </div>

        <div class="toolbar" style="margin-top: 12px">
          <a-button type="primary" size="small" @click="applyDraft">应用到内存</a-button>
          <a-button size="small" @click="resetDraft">还原</a-button>
          <a-button size="small" :disabled="!env.admin" @click="writeDirectly">
            立即写入系统
          </a-button>
        </div>

        <a-divider style="margin: 14px 0 12px" />

        <div class="kv-list">
          <span class="kv-key">变量名称</span>
          <span class="kv-val">{{ current.name }}</span>
          <span class="kv-key">归属域</span>
          <span class="kv-val">{{ current.scope === 'machine' ? '系统（HKLM）' : '用户（HKCU）' }}</span>
          <span class="kv-key">原始值</span>
          <span class="kv-val">{{ originalOf(current) === undefined ? '（新增变量）' : (originalOf(current) || '（空）') }}</span>
          <span class="kv-key">写入后长度</span>
          <span class="kv-val">{{ draftValue.length }} 字符</span>
          <span class="kv-key">状态</span>
          <span class="kv-val">
            <a-tag v-if="current._deleted" color="red">待删除</a-tag>
            <a-tag v-else-if="current._isNew" color="green">待新增</a-tag>
            <a-tag v-else-if="isChanged(current)" color="orange">待修改</a-tag>
            <a-tag v-else>未修改</a-tag>
          </span>
        </div>

        <template v-if="isPathVar">
          <a-divider style="margin: 14px 0 12px" />
          <div class="text-muted" style="margin-bottom: 6px">已拆分 PATH 条目（{{ pathPreview.length }} 条）</div>
          <div style="max-height: 180px; overflow: auto">
            <div v-for="(p, i) in pathPreview" :key="i" class="path-chip">
              <span class="mono">{{ p }}</span>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- 新增变量弹窗 -->
    <a-modal v-model:open="addOpen" title="新增环境变量" ok-text="确认新增" cancel-text="取消" @ok="submitAdd">
      <div class="toolbar" style="margin-bottom: 10px">
        <span class="text-muted">变量模板快速插入：</span>
        <a-select v-model:value="addTpl" size="small" style="width: 220px" placeholder="选择模板一键填充" allow-clear @change="applyAddTpl">
          <a-select-option v-for="t in tplList" :key="t.id" :value="t.id">{{ t.name }}（{{ t.desc }}）</a-select-option>
        </a-select>
      </div>
      <a-form layout="vertical" style="margin-top: 8px">
        <a-form-item label="变量名称" required>
          <a-input v-model:value="addForm.name" placeholder="例如 JAVA_HOME（不能包含 = 和 %）" class="mono" />
        </a-form-item>
        <a-form-item label="变量值">
          <a-textarea
            v-model:value="addForm.value"
            :auto-size="{ minRows: 3, maxRows: 10 }"
            class="mono"
            placeholder="支持 %VARNAME% 形式引用其它变量"
          />
        </a-form-item>
        <a-form-item label="归属域" required>
          <a-radio-group v-model:value="addForm.scope">
            <a-radio-button value="user">用户变量</a-radio-button>
            <a-radio-button value="machine" :disabled="!env.admin">系统变量{{ env.admin ? '' : '（需管理员）' }}</a-radio-button>
          </a-radio-group>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 重命名弹窗 -->
    <a-modal v-model:open="renameOpen" title="重命名环境变量" ok-text="确认重命名" cancel-text="取消" @ok="submitRename">
      <div class="hint-box warn" style="margin-bottom: 12px">
        <ExclamationCircleOutlined />
        <div>重命名会先删除原变量再创建新变量，写入后引用旧名称的程序可能失效，请谨慎操作。</div>
      </div>
      <p class="text-muted" style="margin: 0 0 6px">原名称</p>
      <a-input :value="renameForm.oldName" disabled class="mono" />
      <p class="text-muted" style="margin: 12px 0 6px">新名称</p>
      <a-input v-model:value="renameForm.newName" class="mono" />
    </a-modal>

    <!-- 属性：备注 / 标签 / 锁定 / 收藏 -->
    <a-modal v-model:open="propsOpen" title="变量属性" ok-text="保存" cancel-text="取消" @ok="submitProps">
      <div class="kv-list" style="margin-bottom: 10px">
        <span class="kv-key">变量名</span><span class="kv-val">{{ propsForm.scope }} :: {{ propsForm.name }}</span>
      </div>
      <a-form layout="vertical">
        <a-form-item label="备注（仅本工具内部保存，不写入注册表）">
          <a-textarea v-model:value="propsForm.remark" :rows="2" />
        </a-form-item>
        <a-form-item label="标签（逗号分隔，例如 代理, java, 项目A）">
          <a-input v-model:value="propsForm.tagsText" class="mono" />
        </a-form-item>
        <a-form-item>
          <a-space :size="18">
            <a-checkbox v-model:checked="propsForm.locked">锁定变量（草稿区无法编辑删除）</a-checkbox>
            <a-checkbox v-model:checked="propsForm.favorite">加入收藏</a-checkbox>
          </a-space>
        </a-form-item>
      </a-form>
      <div class="hint-box warn">
        <ExclamationCircleOutlined />
        <div>锁定的变量用于保护 PATH、JAVA_HOME 这类核心变量，解锁后才能修改。</div>
      </div>
    </a-modal>

    <!-- 变更历史 -->
    <a-modal v-model:open="historyOpen" title="变量变更历史" :footer="null" width="680px">
      <a-table
        size="small" row-key="at" :data-source="historyList" :pagination="false"
        :columns="[{ title: '时间', key: 'at', width: 160 }, { title: '操作', key: 'op', width: 80 }, { title: '值', key: 'value', ellipsis: true }]"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'at'">{{ formatTime(record.at) }}</template>
          <template v-else-if="column.key === 'op'">
            <a-tag :color="{ create: 'green', update: 'orange', delete: 'red' }[record.op] || 'default'">
              {{ { create: '新增', update: '修改', delete: '删除' }[record.op] || record.op }}
            </a-tag>
          </template>
          <template v-else><span class="mono">{{ record.value || '（空）' }}</span></template>
        </template>
      </a-table>
      <div v-if="!historyList.length" class="empty-block">本工具尚未记录该变量的变更历史（写入系统后开始记录）</div>
    </a-modal>

    <!-- 引用图谱 -->
    <a-modal v-model:open="refsOpen" :title="`引用图谱 · %${refsName}%`" :footer="null" width="720px">
      <div class="hint-box" style="margin-bottom: 10px">
        <InfoCircleOutlined />
        <div>查看当前系统中哪些变量引用了 <span class="mono">%{{ refsName }}%</span>。点击变量名可直接跳转定位。</div>
      </div>
      <div v-if="forwardRefs.length" style="margin-bottom: 10px">
        <span style="color: var(--wem-text-secondary)">当前值引用了：</span>
        <a-tag v-for="n in forwardRefs" :key="n" color="blue" style="cursor: pointer" @click="jumpToName(n, refsScope)">%{{ n }}%</a-tag>
      </div>
      <a-table
        size="small" row-key="name" :data-source="refsList" :pagination="false"
        :columns="[{ title: '归属', key: 'scope', width: 76 }, { title: '变量', key: 'name', width: 170 }, { title: '值', key: 'value', ellipsis: true }, { title: '类型', key: 'kind', width: 100 }]"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'scope'">
            <a-tag :color="record.scope === 'machine' ? 'purple' : 'blue'">{{ record.scope === 'machine' ? '系统' : '用户' }}</a-tag>
          </template>
          <template v-else-if="column.key === 'name'"><a class="mono" @click="jumpToName(record.name, record.scope)">{{ record.name }}</a></template>
          <template v-else-if="column.key === 'value'"><span class="mono">{{ record.value }}</span></template>
          <template v-else>
            <a-tag :color="record.kind === 'path-entry' ? 'cyan' : 'blue'">{{ record.kind === 'path-entry' ? 'PATH 条目' : '变量引用' }}</a-tag>
          </template>
        </template>
      </a-table>
      <div v-if="!refsList.length" class="empty-block">没有任何变量引用 %{{ refsName }}%，若长期未使用可考虑清理</div>
    </a-modal>

    <!-- 剪贴板导入 -->
    <a-modal v-model:open="pasteOpen" title="从剪贴板导入变量" ok-text="解析并加入草稿" cancel-text="取消" width="640px" @ok="submitPaste">
      <div class="hint-box" style="margin-bottom: 10px">
        <InfoCircleOutlined />
        <div>直接粘贴多行 <span class="mono">key=value</span> 文本，批量添加多条变量。每行一条，<span class="mono">#</span> 开头为注释。</div>
      </div>
      <a-form layout="horizontal" :label-col="{ span: 5 }" :wrapper-col="{ span: 16 }">
        <a-form-item label="归属域">
          <a-radio-group v-model:value="pasteScope" size="small" button-style="solid">
            <a-radio-button value="user">用户变量</a-radio-button>
            <a-radio-button value="machine" :disabled="!env.admin">系统变量</a-radio-button>
          </a-radio-group>
        </a-form-item>
      </a-form>
      <a-textarea v-model:value="pasteText" :rows="10" class="mono" placeholder="JAVA_HOME=C:\dev\soft\jdk-17&#10;MAVEN_OPTS=-Xms128m" />
      <div v-if="pastePreview.length" class="paste-preview mono">
        <div v-for="(p, i) in pastePreview" :key="i">
          {{ p.ok ? '✓' : '✗' }} {{ p.name }} = {{ clipText(p.value, 60) }}<span v-if="!p.ok" style="color:#f53f3f">（{{ p.reason }}）</span>
        </div>
      </div>
    </a-modal>

    <!-- PATHEXT 管理 -->
    <a-modal v-model:open="pathextOpen" title="PATHEXT 可执行后缀管理" ok-text="保存到草稿" cancel-text="取消" @ok="submitPathext">
      <div class="hint-box" style="margin-bottom: 10px">
        <InfoCircleOutlined />
        <div>PATHEXT 决定无扩展名命令按什么后缀查找可执行文件，例如 <span class="mono">.COM;.EXE;.BAT;.CMD</span>。修改进入草稿区，保存后生效。</div>
      </div>
      <div class="toolbar" style="margin-bottom: 8px">
        <a-input v-model:value="pathextNew" size="small" class="mono" style="width: 160px" placeholder=".PS1" @press-enter="addPathext" />
        <a-button size="small" @click="addPathext"><template #icon><PlusOutlined /></template>添加后缀</a-button>
      </div>
      <div>
        <a-tag
          v-for="e in pathextEntries" :key="e" closable color="blue" class="mono"
          @close="pathextEntries = pathextEntries.filter((x) => x !== e)"
        >{{ e }}</a-tag>
      </div>
      <div v-if="pathextInvalid.length" class="hint-box danger" style="margin-top: 10px">
        <ExclamationCircleOutlined />
        <div>非法后缀：{{ pathextInvalid.join('、') }}（必须形如 .EXE，1~8 位字母数字）</div>
      </div>
    </a-modal>

    <!-- 右键快捷菜单 -->
    <div
      v-if="contextOpen && contextRow"
      class="ctx-menu"
      :style="{ left: contextPos.x + 'px', top: contextPos.y + 'px' }"
    >
      <div class="ctx-item" @click="ctxDo('copyName')">复制变量名</div>
      <div class="ctx-item" @click="ctxDo('copyValue')">复制变量值</div>
      <div class="ctx-item" @click="ctxDo('copyPair')">复制「名称=值」</div>
      <div class="ctx-sep"></div>
      <div class="ctx-item" @click="ctxDo('props')">添加备注 / 标签</div>
      <div class="ctx-item" @click="ctxDo('lock')">{{ metaOf(contextRow).locked ? '解锁变量' : '锁定变量' }}</div>
      <div class="ctx-item" @click="ctxDo('history')">查看变更历史</div>
      <div class="ctx-item" @click="ctxDo('refs')">引用图谱</div>
    </div>

    <!-- 新增变量模板插入 -->
  </div>
</template>

<script setup>
import { computed, h, reactive, ref, watch } from 'vue'
import { Modal, message } from 'ant-design-vue'
import {
  ProfileOutlined, SearchOutlined, PlusOutlined, EditOutlined, DeleteOutlined,
  CopyOutlined, DownOutlined, UndoOutlined, LockOutlined, InfoCircleOutlined,
  ExclamationCircleOutlined, MoreOutlined, SnippetsOutlined, FileProtectOutlined,
  StarOutlined, KeyOutlined
} from '@ant-design/icons-vue'
import { useEnvStore } from '@/store/env'
import { useUiStore } from '@/store/ui'
import WemTable from '@/components/wem-table/WemTable.vue'
import { detectSensitive, expandVars, formatTime, clipText } from '@/lib/helpers'
import api from '@/api'

const props = defineProps({
  scopes: { type: Array, default: () => ['user'] },
  title: { type: String, default: '环境变量' },
  pageSize: { type: Number, default: 0 }
})

const env = useEnvStore()
const ui = useUiStore()

const varTable = ref(null)
const varCaps = {
  inline: false,
  drag: false,
  expand: false,
  contextMenu: false,
  batchTag: false,
  batchEnable: false
}
const tableId = computed(() => `vars-${[...props.scopes].sort().join('-')}`)

const keyword = ref('')
const filterMode = ref('all')
const selectedRowKeys = ref([])
const currentKey = ref('')
const sortState = reactive({ field: 'name', order: 'ascend' })

const draftName = ref('')
const draftValue = ref('')

const addOpen = ref(false)
const renameOpen = ref(false)
const addForm = reactive({ name: '', value: '', scope: props.scopes[0] || 'user' })
const renameForm = reactive({ oldName: '', newName: '' })

/* v2：属性 / 历史 / 引用图谱 / 剪贴板导入 / PATHEXT / 模板 */
const propsOpen = ref(false)
const propsForm = reactive({ scope: 'user', name: '', remark: '', tagsText: '', locked: false, favorite: false })
const historyOpen = ref(false)
const historyList = ref([])
const refsOpen = ref(false)
const refsName = ref('')
const refsScope = ref('user')
const refsList = ref([])
const forwardRefs = ref([])
const tablePage = ref(1)
const tablePageSize = ref(50)
const pasteOpen = ref(false)
const pasteText = ref('')
const pasteScope = ref('user')
const pathextOpen = ref(false)
const pathextNew = ref('')
const pathextEntries = ref([])
const addTpl = ref(undefined)

const showPathext = computed(() => props.scopes.includes('machine') || props.scopes.length > 1)

const pathextInvalid = computed(() =>
  pathextEntries.value.filter((e) => !/^\.[A-Za-z0-9]{1,8}$/.test(e))
)

const tplList = [
  { id: 'java', name: 'JAVA_HOME（JDK 主目录）', desc: 'JDK', vars: [{ name: 'JAVA_HOME', value: 'C:\\dev\\soft\\jdk-17' }] },
  { id: 'node', name: 'NODE_HOME（Node 主目录）', desc: 'Node', vars: [{ name: 'NODE_HOME', value: 'C:\\dev\\soft\\node-v22' }] },
  { id: 'maven', name: 'MAVEN_HOME + MAVEN_OPTS', desc: 'Maven', vars: [{ name: 'MAVEN_HOME', value: 'C:\\dev\\soft\\maven' }, { name: 'MAVEN_OPTS', value: '-Xms128m -Xmx512m' }] },
  { id: 'proxy', name: '代理变量 http_proxy / https_proxy', desc: '代理', vars: [{ name: 'http_proxy', value: 'http://127.0.0.1:7890' }, { name: 'https_proxy', value: 'http://127.0.0.1:7890' }, { name: 'no_proxy', value: 'localhost,127.0.0.1' }] },
  { id: 'gradle', name: 'GRADLE_HOME / GRADLE_USER_HOME', desc: 'Gradle', vars: [{ name: 'GRADLE_HOME', value: 'C:\\dev\\soft\\gradle' }, { name: 'GRADLE_USER_HOME', value: '%USERPROFILE%\\.gradle' }] }
]

function applyAddTpl(id) {
  const t = tplList.find((x) => x.id === id)
  if (!t || !t.vars.length) return
  addForm.name = t.vars[0].name
  addForm.value = t.vars[0].value
  message.info(`已填充 ${t.vars[0].name}，其余 ${t.vars.length - 1} 个变量请在提交后继续添加`)
}

function metaOf(record) {
  const m = env.meta.vars[`${record.scope}::${String(record.name).toUpperCase()}`]
  return m || {}
}

const pastePreview = computed(() => {
  const out = []
  for (const raw of String(pasteText.value || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf('=')
    if (idx <= 0) {
      out.push({ ok: false, name: line.slice(0, 20), value: '', reason: '缺少等号' })
      continue
    }
    const name = line.slice(0, idx).trim()
    let value = line.slice(idx + 1)
    if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1)
    if (!name) out.push({ ok: false, name: '', value, reason: '空变量名' })
    else if (/[=%]/.test(name)) out.push({ ok: false, name, value, reason: '变量名含非法字符' })
    else out.push({ ok: true, name, value })
  }
  return out
})

async function openProps(record) {
  propsForm.scope = record.scope
  propsForm.name = record.name
  const m = metaOf(record)
  propsForm.remark = m.remark || ''
  propsForm.tagsText = (m.tags || []).join(', ')
  propsForm.locked = !!m.locked
  propsForm.favorite = !!m.favorite
  propsOpen.value = true
}

async function submitProps() {
  const res = await api.meta.set({
    scope: propsForm.scope,
    name: propsForm.name,
    patch: {
      remark: propsForm.remark,
      tags: propsForm.tagsText.split(',').map((t) => t.trim()).filter(Boolean),
      locked: propsForm.locked,
      favorite: propsForm.favorite
    }
  })
  if (res.ok) {
    const key = `${propsForm.scope}::${String(propsForm.name).toUpperCase()}`
    env.meta.vars[key] = { ...(env.meta.vars[key] || {}), remark: propsForm.remark, locked: propsForm.locked, favorite: propsForm.favorite, tags: propsForm.tagsText.split(',').map((t) => t.trim()).filter(Boolean) }
    propsOpen.value = false
    message.success('变量属性已保存')
  } else {
    message.error(res.message)
  }
}

async function openHistory(record) {
  const res = await api.meta.history({ scope: record.scope, name: record.origName || record.name })
  historyList.value = res.ok ? res.data : []
  historyOpen.value = true
}

async function openRefs(record) {
  refsName.value = record.name
  refsScope.value = record.scope
  forwardRefs.value = [...new Set((String(record.value).match(/%([^%|=\s]+)%/g) || []).map((s) => s.slice(1, -1)))]
  const res = await api.analyze.refs({ name: record.name })
  refsList.value = res.ok ? res.data.referencedBy : []
  refsOpen.value = true
}

/** 从引用图谱跳转到目标变量：优先同域，其次任意域；长列表自动翻到所在页 */
function jumpToName(name, preferScope) {
  const up = String(name).toUpperCase()
  const list = allRows.value.filter((r) => r.name.toUpperCase() === up)
  const target = list.find((r) => r.__scope === preferScope) || list[0]
  if (!target) return message.info(`${name} 不在当前列表（可能被筛选条件隐藏）`)
  refsOpen.value = false
  currentKey.value = target.__key
  varTable.value?.revealKey(target.__key)
  message.success(`已定位到 ${target.__scope === 'machine' ? '系统' : '用户'}变量 ${target.name}`)
}

async function toggleSensitive(record) {
  const cur = metaOf(record)
  const next = !cur.sensitive
  const res = await api.meta.set({ scope: record.scope, name: record.name, patch: { sensitive: next } })
  if (res.ok) {
    const key = `${record.scope}::${String(record.name).toUpperCase()}`
    env.meta.vars[key] = { ...(env.meta.vars[key] || {}), sensitive: next }
    message.success(next ? '已标记为敏感变量，导出备份时将提示脱敏' : '已取消敏感标记')
  }
}

async function submitPaste() {
  const ok = pastePreview.value.filter((p) => p.ok)
  if (!ok.length) return message.warning('没有可导入的变量')
  let n = 0
  for (const p of ok) {
    try {
      env.add(pasteScope.value, p.name, p.value, { source: 'import', originId: 'clipboard', originName: '剪贴板导入' })
      n += 1
    } catch (err) {
      message.warning(`${p.name}：${err.message}`)
    }
  }
  pasteOpen.value = false
  pasteText.value = ''
  message.success(`已添加 ${n} 条变量到草稿区（来源：批量导入）`)
}

async function openPathext() {
  const hit = env.working.machine.find((i) => i.name.toUpperCase() === 'PATHEXT')
  pathextEntries.value = String(hit ? hit.value : '.COM;.EXE;.BAT;.CMD')
    .split(';').map((s) => s.trim()).filter(Boolean)
  pathextOpen.value = true
}

function addPathext() {
  const v = pathextNew.value.trim().toUpperCase()
  if (!v) return
  if (!/^\.[A-Za-z0-9]{1,8}$/.test(v)) return message.error('后缀必须形如 .EXE（1~8 位字母数字）')
  if (pathextEntries.value.some((x) => x.toLowerCase() === v.toLowerCase())) return message.warning('该后缀已存在')
  pathextEntries.value.push(v)
  pathextNew.value = ''
}

async function submitPathext() {
  const value = pathextEntries.value.join(';')
  const res = await api.env.validatePathext(value)
  if (!res.ok || !res.data.valid) {
    return message.error(`校验未通过：${(res.data && (res.data.invalid.join('、') + ' ' + res.data.duplicate.join('、'))) || res.message}`)
  }
  try {
    if (env.findItem('machine', 'PATHEXT')) env.setValue('machine', 'PATHEXT', value, { source: 'manual' })
    else env.add('machine', 'PATHEXT', value, { source: 'manual' })
    pathextOpen.value = false
    message.success('PATHEXT 已加入草稿区，保存写入系统后生效')
  } catch (err) {
    message.error(err.message)
  }
}

/* ------------------------------ 数据行 ------------------------------ */

const allRows = computed(() =>
  props.scopes.flatMap((scope) =>
    env.working[scope].map((item) => ({ ...item, __key: `${scope}::${item.name}`, __scope: scope }))
  )
)

const rows = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  let list = allRows.value

  if (filterMode.value === 'user') list = list.filter((r) => r.scope === 'user')
  else if (filterMode.value === 'machine') list = list.filter((r) => r.scope === 'machine')
  else if (filterMode.value === 'modified') list = list.filter((r) => isChanged(r) || r._deleted)

  if (kw) {
    list = list.filter(
      (r) => r.name.toLowerCase().includes(kw) || String(r.value).toLowerCase().includes(kw)
    )
  }

  const dir = sortState.order === 'ascend' ? 1 : -1
  return [...list].sort((a, b) => {
    if (sortState.field === 'value') return String(a.value).localeCompare(String(b.value), 'zh-CN') * dir
    if (sortState.field === 'scope') return String(a.scope).localeCompare(String(b.scope)) * dir
    return a.name.localeCompare(b.name, 'zh-CN') * dir
  })
})

const modifiedCount = computed(() => rows.value.filter((r) => isChanged(r)).length)
const hasDeleted = computed(() => allRows.value.some((r) => r._deleted))

const selection = computed(() => allRows.value.filter((r) => selectedRowKeys.value.includes(r.__key)))

const current = computed(() => allRows.value.find((r) => r.__key === currentKey.value) || null)
const isPathVar = computed(() => !!current.value && current.value.name.toUpperCase() === 'PATH')
const pathPreview = computed(() =>
  isPathVar.value ? String(draftValue.value || '').split(';').map((s) => s.trim()).filter(Boolean) : []
)

const expandedPreview = computed(() => {
  const text = String(draftValue.value || '')
  if (!/%[^%|=\s]+%/.test(text)) return ''
  const maps = { user: {}, machine: {} }
  for (const scope of ['user', 'machine']) {
    for (const v of env.working[scope] || []) maps[scope][v.name] = v.value
  }
  const scope = current.value?.scope || 'user'
  const name = String(draftName.value || current.value?.name || '').trim()
  if (name) maps[scope][name] = text
  const out = expandVars(text, maps)
  if (out === text) return '引用未能展开（目标变量不存在，或形成了自引用）'
  return out
})

const pagination = computed(() => {
  if (props.pageSize) return { pageSize: props.pageSize, size: 'small', showSizeChanger: false }
  // 性能优化：超长列表自适应分页，避免一次性渲染上千行造成卡顿
  const total = allRows.value.length
  if (total > 200) {
    return {
      current: tablePage.value, pageSize: tablePageSize.value, size: 'small', showSizeChanger: true,
      pageSizeOptions: ['50', '100', '200'],
      showTotal: (t) => `共 ${t} 项`
    }
  }
  return false
})

const columns = computed(() => {
  const cols = [
    {
      title: '变量名称',
      dataIndex: 'name',
      key: 'name',
      width: 240,
      sorter: true
    },
    { title: '变量值', dataIndex: 'value', key: 'value', sorter: true, ellipsis: true },
    {
      title: '归属',
      dataIndex: 'scope',
      key: 'scope',
      width: 78,
      sorter: true,
      hidden: props.scopes.length === 1
    },
    { title: '操作', key: 'actions', dataIndex: 'actions', width: 120, sortable: false, filterable: false, fixed: 'right' }
  ]
  return cols.filter((c) => !c.hidden)
})

/* ------------------------------ 行状态 ------------------------------ */

function isChanged(record) {
  if (!record) return false
  if (record._isNew) return true
  const set = env.changedKeys
  return set.has(`${record.scope}::${record.name}`) || set.has(`${record.scope}::${record.origName}`)
}

function rowClassName(record) {
  const cls = []
  if (record._deleted) cls.push('row-removed')
  else if (record._isNew) cls.push('row-added')
  else if (isChanged(record)) cls.push('row-modified')
  if (record.scope === 'machine' && props.scopes.length > 1) cls.push('system-row')
  if (record.__key === currentKey.value) cls.push('row-selected')
  return cls.join(' ')
}

function displayValue(record) {
  const v = String(record.value ?? '')
  if (!v) return '（空）'
  if (record.name.toUpperCase() === 'PATH') {
    const n = v.split(';').filter(Boolean).length
    return `${n} 条路径 · ${v.length} 字符`
  }
  return v.length > 160 ? v.slice(0, 160) + '…' : v
}

function onRowClick(record) {
  currentKey.value = record.__key
}

function onRowContext(payload) {
  const record = payload?.row
  if (!record) return
  currentKey.value = record.__key
  contextRow.value = record
  contextPos.x = payload.x || 0
  contextPos.y = payload.y || 0
  contextOpen.value = true
}

function onVarBatch(payload) {
  if (payload?.action !== 'delete') return
  selectedRowKeys.value = (payload.rows || []).map((row) => row.__key)
  confirmDelete()
}

const contextOpen = ref(false)
const contextRow = ref(null)
const contextPos = reactive({ x: 0, y: 0 })

function ctxDo(key) {
  contextOpen.value = false
  if (contextRow.value) rowAction(key, contextRow.value)
}

function originalOf(record) {
  const key = record.origName || (record._isNew ? undefined : record.name)
  if (key === undefined) return undefined
  const map = env.original[record.scope] || {}
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined
}

function getCheckboxProps() {
  return {}
}

function onSelectChange(keys) {
  selectedRowKeys.value = keys
}

function onTableChange(pag, _filters, sorter) {
  sortState.field = sorter.field || 'name'
  sortState.order = sorter.order || 'ascend'
  if (pag?.current) tablePage.value = pag.current
  if (pag?.pageSize) tablePageSize.value = pag.pageSize
}

/* ------------------------------ 编辑面板 ------------------------------ */

function focus(record) {
  currentKey.value = record.__key
  draftName.value = record.name
  draftValue.value = String(record.value ?? '')
}

function resetDraft() {
  if (!current.value) return
  draftName.value = current.value.name
  draftValue.value = String(current.value.value ?? '')
}

function applyDraft() {
  if (!current.value) return
  const rec = current.value
  const nameChanged = draftName.value.trim() !== rec.name
  try {
    if (nameChanged) {
      if (isPathVar.value) throw new Error('PATH 变量不支持重命名')
      env.rename(rec.scope, rec.name, draftName.value.trim())
      currentKey.value = `${rec.scope}::${draftName.value.trim()}`
    }
    env.setValue(rec.scope, draftName.value.trim(), draftValue.value)
    message.success('已应用到内存，记得点击「保存写入系统」')
    ui.tip(`变量 ${draftName.value.trim()} 的修改已暂存`, 'warning')
  } catch (err) {
    message.error(err.message)
  }
}

async function writeDirectly() {
  if (!current.value) return
  if (!env.admin && current.value.scope === 'machine') {
    Modal.confirm({
      title: '普通权限无法写入系统变量',
      content: '要不要以管理员身份重新启动程序？重启后系统变量将变为可写。',
      okText: '提权重启',
      cancelText: '取消',
      onOk: async () => {
        const res = await api.tool.elevate()
        if (res.ok) message.info('已启动管理员实例，当前窗口即将关闭')
      }
    })
    return
  }
  const res = await api.env.writeOne({
    name: draftName.value.trim(),
    value: draftValue.value,
    scope: current.value.scope
  })
  if (res.ok) {
    message.success('已直接写入系统')
    await env.load()
    ui.tip(`变量 ${draftName.value.trim()} 已写入系统`, 'success')
  } else {
    Modal.error({ title: '写入失败', content: res.message })
  }
}

/* ------------------------------ 增删改查 ------------------------------ */

function openAdd() {
  addForm.name = ''
  addForm.value = ''
  addForm.scope = props.scopes.includes('machine') && env.admin ? 'machine' : (props.scopes[0] || 'user')
  addOpen.value = true
}

function submitAdd() {
  const name = addForm.name.trim()
  if (!name) return message.error('请输入变量名称')
  if (/[=%]/.test(name)) return message.error('变量名称不能包含 = 或 %')
  try {
    env.add(addForm.scope, name, addForm.value)
    addOpen.value = false
    message.success(`已新增 ${name}（尚未写入系统）`)
    ui.tip(`新增变量 ${name}，已暂存`, 'warning')
    currentKey.value = `${addForm.scope}::${name}`
    draftName.value = name
    draftValue.value = addForm.value
  } catch (err) {
    message.error(err.message)
  }
}

function openRename() {
  const targets = selection.value.filter((r) => !r._deleted)
  if (targets.length !== 1) return message.warning('请选择且仅选择 1 个变量进行重命名')
  renameForm.oldName = targets[0].name
  renameForm.newName = targets[0].name
  renameOpen.value = true
}

function submitRename() {
  const name = renameForm.newName.trim()
  if (!name) return message.error('请输入新名称')
  if (/[=%]/.test(name)) return message.error('变量名称不能包含 = 或 %')
  const rec = selection.value[0]
  try {
    env.rename(rec.scope, renameForm.oldName, name)
    renameOpen.value = false
    message.success('已重命名（写入系统后生效）')
  } catch (err) {
    message.error(err.message)
  }
}

function deleteOne(record) {
  if (record.scope === 'machine' && !env.admin) {
    return message.warning('普通权限下不能删除系统变量，请先以管理员身份重启')
  }
  const run = () => {
    env.remove(record.scope, [record.name])
    selectedRowKeys.value = selectedRowKeys.value.filter((k) => k !== record.__key)
    varTable.value?.setSelection(selectedRowKeys.value)
    message.success('已标记待删除')
  }
  if (record.scope === 'machine' && env.config.confirmDanger === false) return run()
  Modal.confirm({
    title: '确认标记删除该变量？',
    content: `变量「${record.name}」将被标记为待删除，点击「保存写入系统」后才会真正从注册表移除。`,
    okText: '标记删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: run
  })
}

function confirmDelete() {
  const targets = selection.value.filter((r) => !r._deleted)
  if (!targets.length) return message.warning('请先选择要删除的变量')
  const blocked = targets.filter((r) => r.scope === 'machine' && !env.admin)
  if (blocked.length) {
    return Modal.warning({
      title: '存在无法删除的系统变量',
      content: `以下系统变量需要管理员权限：${blocked.map((b) => b.name).join('、')}`
    })
  }
  const run = () => {
    const byScope = {}
    for (const t of targets) (byScope[t.scope] = byScope[t.scope] || []).push(t.name)
    for (const [scope, names] of Object.entries(byScope)) env.remove(scope, names)
    selectedRowKeys.value = []
    varTable.value?.clearSelection()
    message.success(`已标记 ${targets.length} 个变量待删除`)
    ui.tip(`已标记 ${targets.length} 个变量待删除，保存后生效`, 'warning')
  }
  if (targets.every((t) => t.scope === 'machine') && env.config.confirmDanger === false) return run()
  Modal.confirm({
    title: `确认标记删除 ${targets.length} 个变量？`,
    width: 560,
    content: () =>
      h(
        'div',
        { style: 'max-height:220px;overflow:auto' },
        targets.map((t) =>
          h(
            'div',
            { key: t.__key, class: 'mono', style: 'font-size:12px;padding:2px 0' },
            `· [${t.scope === 'machine' ? '系统' : '用户'}] ${t.name}`
          )
        )
      ),
    okText: '全部标记删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: run
  })
}

function restoreDeleted() {
  for (const scope of ['user', 'machine']) {
    const names = env.working[scope].filter((i) => i._deleted && !i._isNew).map((i) => i.name)
    if (names.length) env.restore(scope, names)
  }
  message.success('已取消全部待删除标记')
}

/* ------------------------------ 复制与行操作 ------------------------------ */

async function copyToClipboard(text, label) {
  try {
    await navigator.clipboard.writeText(text)
    message.success(`已复制${label}`)
  } catch (_) {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    message.success(`已复制${label}`)
  }
}

function copy(key) {
  const targets = selection.value
  if (!targets.length) return
  const text =
    key === 'name'
      ? targets.map((t) => t.name).join('\r\n')
      : key === 'value'
        ? targets.map((t) => t.value).join('\r\n')
        : targets.map((t) => `${t.name}=${t.value}`).join('\r\n')
  const label = key === 'name' ? '变量名' : key === 'value' ? '变量值' : '「名称=值」'
  copyToClipboard(text, ` ${targets.length} 项${label}`)
}

function rowAction(key, record) {
  if (key === 'copyName') copyToClipboard(record.name, '变量名')
  else if (key === 'copyValue') copyToClipboard(String(record.value), '变量值')
  else if (key === 'copyPair') copyToClipboard(`${record.name}=${record.value}`, '「名称=值」')
  else if (key === 'moveToSystem' || key === 'moveToUser') {
    const targetScope = key === 'moveToSystem' ? 'machine' : 'user'
    if (targetScope === 'machine' && !env.admin) return message.warning('复制到系统变量需要管理员权限')
    try {
      env.add(targetScope, record.name, record.value)
      message.success(`已复制到${targetScope === 'machine' ? '系统' : '用户'}变量（待保存）`)
    } catch (err) {
      message.error(err.message)
    }
  } else if (key === 'toPath') {
    location.hash = '#/path'
  } else if (key === 'props') {
    openProps(record)
  } else if (key === 'history') {
    openHistory(record)
  } else if (key === 'refs') {
    openRefs(record)
  } else if (key === 'sensitive') {
    toggleSensitive(record)
  } else if (key === 'lock') {
    const next = !metaOf(record).locked
    api.meta.set({ scope: record.scope, name: record.name, patch: { locked: next } }).then((res) => {
      if (res.ok) {
        const k = `${record.scope}::${String(record.name).toUpperCase()}`
        env.meta.vars[k] = { ...(env.meta.vars[k] || {}), locked: next }
        message.success(next ? `已锁定 ${record.name}，草稿区将无法编辑删除` : `已解锁 ${record.name}`)
      } else message.error(res.message)
    })
  }
}

/* 选中项变化时同步右侧面板 */
watch(
  () => env.working,
  () => {
    if (currentKey.value && !allRows.value.some((r) => r.__key === currentKey.value)) {
      currentKey.value = ''
    } else if (current.value && !draftName.value) {
      resetDraft()
    }
  },
  { deep: true }
)

watch(currentKey, () => {
  if (current.value) {
    draftName.value = current.value.name
    draftValue.value = String(current.value.value ?? '')
  }
})

defineExpose({ focus, rows })
</script>

<style scoped>
.danger-link {
  color: var(--wem-danger);
}

.danger-link:hover {
  color: #ff7875;
}

.path-chip {
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--wem-card-alt);
  border: 1px solid var(--wem-border);
  margin-bottom: 5px;
  font-size: 12px;
  word-break: break-all;
}

.expand-preview {
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--wem-card-alt);
  border: 1px solid var(--wem-border);
}

.expand-text {
  margin-top: 4px;
  max-height: 96px;
  overflow: auto;
  word-break: break-all;
  white-space: pre-wrap;
}

.remark-line {
  flex: 1 0 100%;
  font-size: 11px;
  color: var(--wem-text-3);
  margin-top: 2px;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ctx-menu {
  position: fixed;
  z-index: 2000;
  min-width: 168px;
  background: var(--wem-card);
  border: 1px solid var(--wem-border);
  border-radius: 8px;
  box-shadow: var(--wem-shadow-lg);
  padding: 5px;
}

.ctx-item {
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12.5px;
  cursor: pointer;
  color: var(--wem-text);
}

.ctx-item:hover {
  background: rgba(22, 93, 255, 0.09);
}

.ctx-sep {
  height: 1px;
  background: var(--wem-border);
  margin: 4px 2px;
}

.paste-preview {
  max-height: 150px;
  overflow: auto;
  border: 1px solid var(--wem-border);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 11.5px;
  background: var(--wem-card-alt);
  line-height: 1.7;
}
</style>
