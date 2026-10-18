<template>
  <div ref="wrap" class="wem-table-root" :class="{ 'wem-no-row-hover': viewPrefs.rowHover === false }">
    <div class="wem-toolbar">
      <div class="wem-toolbar-left">
        <div v-if="cap.find" class="find-box">
          <a-input
            v-model:value="findQuery"
            size="small"
            allow-clear
            placeholder="查找"
            style="width: 180px"
          >
            <template #prefix><SearchOutlined /></template>
          </a-input>
          <a-button size="small" :disabled="!matches.length" @click="gotoMatch(-1)">上一个</a-button>
          <a-button size="small" :disabled="!matches.length" @click="gotoMatch(1)">下一个</a-button>
          <span class="hint">{{ findIndex >= 0 && matches.length ? findIndex + 1 : 0 }} / {{ matches.length }}</span>
          <a-checkbox v-model:checked="findCase">区分大小写</a-checkbox>
          <a-checkbox v-model:checked="findWhole">全词</a-checkbox>
        </div>
        <template v-if="cap.expand">
          <a-button size="small" @click="expandAll">全部展开</a-button>
          <a-button size="small" @click="collapseAll">全部折叠</a-button>
        </template>
        <a-button v-if="cap.format && viewPrefs.enableFormat !== false" size="small" @click="formatOpen = true">条件格式</a-button>
        <a-button v-if="cap.presets" size="small" @click="presetOpen = true">视图预设</a-button>
        <a-button v-if="cap.export" size="small" @click="openExport()">
          <template #icon><DownloadOutlined /></template>
          导出
        </a-button>
        <slot name="toolbar-extra" />
      </div>
      <div class="wem-toolbar-right">
        <a-button size="small" :disabled="!undoStack.length" @click="undo">
          <template #icon><UndoOutlined /></template>
          撤销
        </a-button>
        <a-button size="small" :disabled="!redoStack.length" @click="redo">
          <template #icon><RedoOutlined /></template>
          重做
        </a-button>
        <a-dropdown :trigger="['click']" placement="bottomRight">
          <a-button size="small">列显示</a-button>
          <template #overlay>
            <div class="menu-panel" @mousedown.stop @click.stop>
              <label v-for="col in allDataColumns" :key="col.key" class="menu-check">
                <a-checkbox
                  :checked="!layout.hidden.includes(col.key)"
                  @change="(e) => toggleColumn(col.key, e.target.checked)"
                />
                <span>{{ col.title }}</span>
              </label>
              <div v-if="!allDataColumns.length" class="hint">没有数据列</div>
            </div>
          </template>
        </a-dropdown>
        <a-dropdown :trigger="['click']" placement="bottomRight">
          <a-button size="small">列表</a-button>
          <template #overlay>
            <a-menu @click="onLayoutMenu">
              <a-sub-menu v-for="col in allDataColumns" :key="`col|${col.key}`" :title="col.title">
                <a-menu-item :key="fixKey(col.key, 'none')">不固定</a-menu-item>
                <a-menu-item :key="fixKey(col.key, 'left')">固定在左侧</a-menu-item>
                <a-menu-item :key="fixKey(col.key, 'right')">固定在右侧</a-menu-item>
              </a-sub-menu>
              <a-menu-divider />
              <a-menu-item key="reset">重置列表布局</a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </div>
    </div>

    <div v-if="showBatch" class="batch-bar">
      <span>已选 {{ selectedExisting }} 行</span>
      <a-dropdown v-if="cap.batchCopy" :trigger="['click']">
        <a-button size="small">批量复制</a-button>
        <template #overlay>
          <a-menu @click="({ key }) => copySelected(key)">
            <a-menu-item key="text">纯文本</a-menu-item>
            <a-menu-item key="tsv">TSV</a-menu-item>
          </a-menu>
        </template>
      </a-dropdown>
      <a-dropdown v-if="cap.batchExport" :trigger="['click']">
        <a-button size="small">批量导出选中</a-button>
        <template #overlay>
          <a-menu @click="({ key }) => batchExport(key)">
            <a-menu-item key="txt">TXT</a-menu-item>
            <a-menu-item key="csv">CSV</a-menu-item>
            <a-menu-item key="json">JSON</a-menu-item>
          </a-menu>
        </template>
      </a-dropdown>
      <a-button v-if="cap.batchTag" size="small" @click="emitBatch('tag')">批量标记</a-button>
      <a-button v-if="cap.batchEnable" size="small" @click="emitBatch('enable')">批量启用</a-button>
      <a-button
        v-for="act in batchActions"
        :key="act.key"
        size="small"
        :danger="!!act.danger"
        @click="emitBatch(act.key)"
      >{{ act.label }}</a-button>
      <a-button v-if="cap.batchDelete" size="small" danger @click="emitBatch('delete')">批量删除</a-button>
      <a-button size="small" @click="clearSelection">取消选择</a-button>
    </div>

    <div v-if="activeChips.length" class="filter-bar">
      <a-tag
        v-for="chip in activeChips"
        :key="chip.key"
        closable
        color="blue"
        @close.prevent="clearFilter(chip.key)"
      >{{ chip.label }}</a-tag>
      <a-button type="link" size="small" @click="clearAllFilters">清除所有筛选</a-button>
    </div>

    <div v-if="error && hasRows" class="error-bar">
      <span>{{ error }}</span>
      <a-button size="small" @click="emit('retry')">重试</a-button>
    </div>

    <a-spin :spinning="loading">
      <div v-if="error && !hasRows" class="state-block">
        <a-empty :description="error">
          <a-button type="primary" @click="emit('retry')">重试</a-button>
        </a-empty>
      </div>
      <a-table
        v-else
        :key="`${tableId}-${isVirtual ? 'v' : 'p'}`"
        class="wem-grid"
        :size="tableSize"
        :columns="antColumns"
        :data-source="tableRows"
        :row-key="getRowKey"
        :pagination="false"
        :scroll="tableScroll"
        :row-class-name="rowClassName"
        :custom-row="customRow"
        :show-expand-column="false"
        :expanded-row-keys="cap.expand ? expandedRowKeys : []"
        :row-expandable="rowExpandable"
      >
        <template #headerCell="{ column }">
          <div v-if="column.key === '__select'" class="th-box th-center">
            <a-checkbox
              :checked="allFilteredSelected"
              :disabled="!selectableKeyList.length"
              :indeterminate="someFilteredSelected && !allFilteredSelected"
              @change="(e) => toggleAll(e.target.checked)"
            />
          </div>
          <div v-else-if="column.key === '__drag' || column.key === '__expand'" class="th-box" />
          <div
            v-else
            class="th-box"
            :class="{ 'is-drop': dragOverKey === column.key }"
            @dragover.prevent="onColDragOver(userColumn(column))"
            @drop.prevent="onColDrop(userColumn(column))"
          >
            <span
              class="th-label"
              draggable="true"
              @dragstart.stop="onColDragStart(userColumn(column), $event)"
              @dragend="onColDragEnd"
              @click="onSort(userColumn(column))"
            >
              <span class="th-title">{{ column.title }}</span>
              <span v-if="sortMeta(userColumn(column))" class="sort-ind">
                <CaretUpOutlined v-if="sortMeta(userColumn(column)).order === 'asc'" />
                <CaretDownOutlined v-else />
                <i>{{ sortMeta(userColumn(column)).rank }}</i>
              </span>
            </span>
            <a-popover
              v-if="canFilter(userColumn(column))"
              :open="filterOpenKey === column.key"
              trigger="click"
              placement="bottomRight"
              @openChange="(open) => onFilterOpen(userColumn(column), open)"
            >
              <template #content>
                <div v-if="filterOpenKey === column.key" class="filter-pop" @mousedown.stop>
                  <template v-if="isTextFilter(userColumn(column))">
                    <a-input
                      v-model:value="filters[column.key].keyword"
                      size="small"
                      allow-clear
                      placeholder="关键词"
                    />
                    <div class="pop-row">
                      <a-checkbox v-model:checked="filters[column.key].exact">精确匹配</a-checkbox>
                      <a-checkbox v-model:checked="filters[column.key].caseSensitive">区分大小写</a-checkbox>
                    </div>
                    <a-input v-model:value="uniqQuery" size="small" allow-clear placeholder="搜索不重复值" />
                    <div class="value-list">
                      <label v-for="item in shownUniq" :key="item" class="menu-check">
                        <a-checkbox
                          :checked="hasFilterValue(column.key, item)"
                          @change="(e) => toggleFilterValue(column.key, item, e.target.checked)"
                        />
                        <span>{{ item }}</span>
                      </label>
                      <div v-if="!shownUniq.length" class="hint">没有可选值</div>
                    </div>
                    <div class="hint">不勾选表示不按值过滤。关键词和勾选同时生效。</div>
                  </template>
                  <template v-else-if="userColumn(column).type === 'enum'">
                    <div class="value-list">
                      <label v-for="opt in enumChoices(userColumn(column))" :key="String(opt.value)" class="menu-check">
                        <a-checkbox
                          :checked="hasFilterValue(column.key, opt.value)"
                          @change="(e) => toggleFilterValue(column.key, opt.value, e.target.checked)"
                        />
                        <span>{{ opt.label }}</span>
                      </label>
                    </div>
                  </template>
                  <template v-else-if="userColumn(column).type === 'date'">
                    <div class="pop-row">
                      <a-button size="small" :type="filters[column.key].preset === 'today' ? 'primary' : 'default'" @click="setPreset(column.key, 'today')">今天</a-button>
                      <a-button size="small" :type="filters[column.key].preset === 'd7' ? 'primary' : 'default'" @click="setPreset(column.key, 'd7')">近7天</a-button>
                      <a-button size="small" :type="filters[column.key].preset === 'd30' ? 'primary' : 'default'" @click="setPreset(column.key, 'd30')">近30天</a-button>
                    </div>
                    <div class="pop-row">
                      <input class="date-input" type="date" :value="filters[column.key].start" @input="onDateInput(column.key, 'start', $event.target.value)" />
                      <span>至</span>
                      <input class="date-input" type="date" :value="filters[column.key].end" @input="onDateInput(column.key, 'end', $event.target.value)" />
                    </div>
                  </template>
                  <template v-else>
                    <a-input v-model:value="filters[column.key].min" size="small" :placeholder="userColumn(column).type === 'size' ? '最小，可写 10MB' : '最小值'" />
                    <a-input v-model:value="filters[column.key].max" size="small" :placeholder="userColumn(column).type === 'size' ? '最大，可写 1GB' : '最大值'" />
                  </template>
                  <div class="pop-actions">
                    <a-button size="small" @click="clearFilter(column.key)">清除此列</a-button>
                  </div>
                </div>
              </template>
              <button
                type="button"
                class="th-filter"
                :class="{ on: filterOn(userColumn(column)) }"
                @mousedown.stop
              >
                <FilterOutlined />
              </button>
            </a-popover>
            <span
              v-if="cap.resize"
              class="th-resize"
              @mousedown.stop.prevent="onResizeDown(userColumn(column), $event)"
              @dragstart.prevent
            />
          </div>
        </template>

        <template #bodyCell="{ column, record }">
          <template v-if="record.__spacer">
            <div v-if="column.key === antColumns[0]?.key" :style="{ height: `${record.__h}px` }" />
          </template>
          <template v-else-if="column.key === '__select'">
            <a-checkbox
              :checked="selected.has(record[rowKey])"
              :disabled="isRowLocked(record)"
              @click.stop
              @change="(e) => toggleRow(record, e.target.checked)"
            />
          </template>
          <template v-else-if="column.key === '__drag'">
            <span
              class="drag-handle"
              draggable="true"
              title="拖拽排序"
              @click.stop
              @dragstart.stop="onRowDragStart(record, $event)"
              @dragend="onRowDragEnd"
            >
              <HolderOutlined />
            </span>
          </template>
          <template v-else-if="column.key === '__expand'">
            <button class="expand-btn" type="button" @click.stop="toggleExpand(record)">
              <CaretDownOutlined v-if="isExpanded(record)" />
              <CaretRightOutlined v-else />
            </button>
          </template>
          <template v-else>
            <div
              v-if="isEditing(record, userColumn(column))"
              :ref="setEditEl"
              class="cell-editor"
              :class="{ 'is-error': editError }"
              @mousedown.stop
            >
              <a-input v-model:value="editDraft" size="small" :status="editError ? 'error' : ''" />
              <a-button size="small" type="primary" @mousedown.stop.prevent="confirmEdit">确认</a-button>
              <a-button size="small" @mousedown.stop.prevent="cancelEdit">取消</a-button>
              <div v-if="editError" class="edit-error">{{ editError }}</div>
            </div>
            <div
              v-else
              class="cell-view"
              :data-cell-key="cellDomKey(record, userColumn(column))"
              @click.stop="emit('row-click', record)"
              @dblclick.stop="onCellDbl(record, userColumn(column))"
              @contextmenu.stop="onCellContext($event, record, userColumn(column))"
            >
              <slot
                name="cell"
                :row="record"
                :column="userColumn(column)"
                :value="rawValue(record, userColumn(column))"
              >
                <span class="cell-text" :class="{ clip: clipCell(userColumn(column)) }" :title="displayText(record, userColumn(column))">
                  <template v-for="(part, index) in highlightParts(displayText(record, userColumn(column)), isCurrentFind(record, userColumn(column)))" :key="index">
                    <mark v-if="part.hit" class="wem-hit" :class="{ current: part.current }">{{ part.text }}</mark>
                    <template v-else>{{ part.text }}</template>
                  </template>
                </span>
              </slot>
            </div>
          </template>
        </template>

        <template v-if="cap.expand" #expandedRowRender="{ record }">
          <slot name="expand" :row="record" />
        </template>

        <template #summary>
          <a-table-summary v-if="cap.summary && viewPrefs.showSummary !== false && processed.length">
            <a-table-summary-row>
              <a-table-summary-cell v-for="(col, index) in antColumns" :key="col.key" :index="index">
                <span class="summary-text" :title="summaryText(lookupCol(col))">{{ summaryText(lookupCol(col)) }}</span>
              </a-table-summary-cell>
            </a-table-summary-row>
          </a-table-summary>
        </template>

        <template #emptyText>
          <div v-if="hasRows" class="state-block">
            <p>没有匹配数据</p>
            <a-button size="small" @click="clearAllFilters">清除筛选</a-button>
          </div>
          <a-empty v-else :description="emptyText || '暂无数据'">
            <a-button v-if="emptyActionLabel" type="primary" @click="emit('empty-action')">{{ emptyActionLabel }}</a-button>
          </a-empty>
        </template>
      </a-table>
    </a-spin>

    <div class="wem-footer">
      <div class="wem-stat">
        <template v-if="cap.select">已选中 {{ selectedExisting }} / </template>
        筛选 {{ processed.length }} / 全部 {{ rows.length }}
        <template v-if="cap.select && pageSpan > 1"> · 跨 {{ pageSpan }} 页</template>
        <a-button v-if="cap.select && selectedExisting" type="link" size="small" @click="clearSelection">取消选择</a-button>
      </div>
      <div v-if="cap.page && !isVirtual && processed.length" class="wem-pager">
        <a-button size="small" :disabled="page <= 1" @click="page = 1">首页</a-button>
        <template v-if="pageCount <= 1">
          <span>第</span>
          <a-input-number :value="page" size="small" :min="1" :max="pageCount" :controls="false" style="width: 64px" @change="onPageJump" />
          <span>/ {{ pageCount }} 页</span>
        </template>
        <a-pagination
          :current="page"
          :page-size="pageSizeState"
          :total="processed.length"
          size="small"
          :show-size-changer="true"
          :page-size-options="['10', '20', '50', '100', '200']"
          :show-quick-jumper="true"
          :show-less-items="true"
          :item-render="itemRender"
          :show-total="(total) => `共 ${total} 条`"
          @change="onPager"
        />
        <a-button size="small" :disabled="page >= pageCount" @click="page = pageCount">末页</a-button>
      </div>
      <div v-else-if="isVirtual" class="hint">超过 {{ threshold }} 行，已关闭分页，只渲染可见行</div>
    </div>

    <div
      v-if="menu.open"
      ref="menuEl"
      class="ctx-menu"
      :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
      @mousedown.stop
    >
      <button type="button" class="ctx-item" :disabled="!menu.col" @click="copyCell">复制单元格</button>
      <button type="button" class="ctx-item" @click="copyRow">复制整行</button>
      <button v-if="cap.inline" type="button" class="ctx-item" @click="contextEdit">编辑</button>
      <button v-if="cap.expand" type="button" class="ctx-item" @click="contextExpand">展开</button>
      <template v-if="selectedExisting > 1">
        <div class="ctx-split" />
        <button v-if="cap.batchCopy" type="button" class="ctx-item" @click="contextBatchCopy">批量复制</button>
        <button v-if="cap.batchExport" type="button" class="ctx-item" @click="contextBatchExport">批量导出</button>
      </template>
    </div>

    <a-modal
      v-model:open="exportOpen"
      title="导出"
      ok-text="下载"
      cancel-text="取消"
      :width="720"
      @ok="downloadExport"
    >
      <div class="export-form">
        <div class="export-line">
          <span>范围</span>
          <a-button size="small" :type="exportScope === 'all' ? 'primary' : 'default'" @click="exportScope = 'all'">全部</a-button>
          <a-button size="small" :type="exportScope === 'filtered' ? 'primary' : 'default'" @click="exportScope = 'filtered'">筛选结果</a-button>
          <a-button size="small" :type="exportScope === 'selected' ? 'primary' : 'default'" @click="exportScope = 'selected'">已选</a-button>
          <span class="hint">{{ exportRows.length }} 行</span>
        </div>
        <div class="export-line">
          <span>格式</span>
          <a-button size="small" :type="exportFormat === 'csv' ? 'primary' : 'default'" @click="exportFormat = 'csv'">CSV</a-button>
          <a-button size="small" :type="exportFormat === 'txt' ? 'primary' : 'default'" @click="exportFormat = 'txt'">TXT</a-button>
          <a-button size="small" :type="exportFormat === 'json' ? 'primary' : 'default'" @click="exportFormat = 'json'">JSON</a-button>
          <a-button size="small" :type="exportFormat === 'html' ? 'primary' : 'default'" @click="exportFormat = 'html'">HTML</a-button>
        </div>
        <div class="export-line">
          <a-checkbox v-model:checked="exportHeader">含表头</a-checkbox>
          <a-checkbox v-model:checked="exportHidden">隐藏列</a-checkbox>
          <a-checkbox v-model:checked="exportStatus">状态字段</a-checkbox>
        </div>
        <div class="hint">预览前 20 行，下载包含当前范围内的全部行。</div>
        <pre class="export-preview">{{ exportPreview }}</pre>
      </div>
    </a-modal>

    <ConditionFormatModal
      v-model:open="formatOpen"
      :table-id="tableId"
      :columns="allDataColumns"
      :rules="formatRules"
      @save="onFormats"
    />
    <ViewPresetModal
      v-model:open="presetOpen"
      :table-id="tableId"
      :current="presetSnapshot"
      @load="onLoadPreset"
    />
  </div>
</template>

<script setup>
import { computed, h, nextTick, onBeforeUnmount, onMounted, onUpdated, reactive, ref, watch } from 'vue'
import { Modal, message } from 'ant-design-vue'
import {
  CaretDownOutlined,
  CaretRightOutlined,
  CaretUpOutlined,
  DownloadOutlined,
  FilterOutlined,
  HolderOutlined,
  RedoOutlined,
  SearchOutlined,
  UndoOutlined
} from '@ant-design/icons-vue'
import ConditionFormatModal from './ConditionFormatModal.vue'
import ViewPresetModal from './ViewPresetModal.vue'
import {
  applyFilters,
  applyFormats,
  autofitWidth,
  displayText,
  exportText,
  isFilterActive,
  parseSize,
  rawValue,
  sortRows
} from './tableEngine.js'
import { useEnvStore } from '@/store/env'

const props = defineProps({
  tableId: { type: String, required: true },
  columns: { type: Array, default: () => [] },
  rows: { type: Array, default: () => [] },
  rowKey: { type: String, default: 'id' },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  capabilities: { type: Object, default: () => ({}) },
  batchActions: { type: Array, default: () => [] },
  pageSize: { type: Number, default: 0 },
  emptyText: { type: String, default: '暂无数据' },
  emptyActionLabel: { type: String, default: '' },
  rowClass: { type: Function, default: null },
  rowDisabled: { type: Function, default: null }
})

const emit = defineEmits(['batch', 'update:rows', 'edit', 'expand', 'retry', 'empty-action', 'context', 'selection-change', 'row-click', 'row-dblclick', 'row-context'])

const CAP_KEYS = ['resize', 'sort', 'filter', 'select', 'page', 'find', 'export', 'inline', 'drag', 'expand', 'format', 'presets', 'summary', 'batchCopy', 'batchExport', 'batchTag', 'batchDelete', 'batchEnable', 'contextMenu']
const VIEW_H = 480
const ROW_H = 36
const OVERSCAN = 6

const envStore = useEnvStore()
const tableSize = computed(() => {
  const height = envStore.config && envStore.config.rowHeight
  return height === 'small' || height === 'middle' || height === 'large' ? height : 'middle'
})

const wrap = ref(null)
const menuEl = ref(null)
const layoutReady = ref(false)
const page = ref(1)
const pageSizeState = ref(initialPageSize())
const filters = ref({})
const sorts = ref([])
const selected = ref(new Set())
const expandedRowKeys = ref([])
const formatRules = ref([])
const undoStack = ref([])
const redoStack = ref([])
const findQuery = ref('')
const findCase = ref(false)
const findWhole = ref(false)
const findIndex = ref(-1)
const tableSettingsRev = ref(0)
const filterOpenKey = ref('')
const uniqQuery = ref('')
const dragColKey = ref('')
const dragOverKey = ref('')
const rowDragKey = ref(null)
const dropKey = ref(null)
const scrollTop = ref(0)
const editing = ref(null)
const editDraft = ref('')
const editError = ref('')
const editEl = ref(null)
const formatOpen = ref(false)
const presetOpen = ref(false)
const exportOpen = ref(false)
const exportScope = ref('filtered')
const exportFormat = ref('csv')
const exportHeader = ref(true)
const exportHidden = ref(false)
const exportStatus = ref(false)
const menu = reactive({ open: false, x: 0, y: 0, row: null, col: null })
const layout = reactive({ order: [], widths: {}, hidden: [], fixed: {} })

let mute = 0
let loadSeq = 0
let colDragMoved = false
let filterBase = null
let scrollEl = null
let persistQueued = false
let resizeSession = 0
let lastResizeAt = 0
let lastResizeCol = ''

const cap = computed(() => {
  const source = props.capabilities || {}
  const out = {}
  CAP_KEYS.forEach((key) => { out[key] = source[key] !== false })
  return out
})
const isAudit = computed(() => String(props.tableId || '').toLowerCase().includes('audit'))
const hasRows = computed(() => (props.rows || []).length > 0)
const normalizedColumns = computed(() => (props.columns || []).map(normalizeCol).filter(Boolean))
const colMap = computed(() => {
  const map = new Map()
  normalizedColumns.value.forEach((col) => map.set(col.key, col))
  return map
})
const allDataColumns = computed(() => layout.order.map((key) => colMap.value.get(key)).filter(Boolean))
const visibleDataColumns = computed(() => allDataColumns.value.filter((col) => !layout.hidden.includes(col.key)))
const processed = computed(() => sortRows(
  applyFilters(props.rows || [], normalizedColumns.value, filters.value),
  normalizedColumns.value,
  sorts.value
))
const threshold = computed(() => {
  tableSettingsRev.value
  const n = Number(readTableSettings().virtualThreshold)
  return Number.isFinite(n) && n >= 100 && n <= 5000 ? n : 500
})
const viewPrefs = computed(() => {
  tableSettingsRev.value
  return readTableSettings()
})
const isVirtual = computed(() => processed.value.length > threshold.value)
const pageCount = computed(() => Math.max(1, Math.ceil(processed.value.length / (pageSizeState.value || 1)) || 1))
const vStart = computed(() => (isVirtual.value ? Math.max(0, Math.floor(scrollTop.value / ROW_H) - OVERSCAN) : 0))
const vEnd = computed(() => {
  if (!isVirtual.value) return processed.value.length
  return Math.min(processed.value.length, vStart.value + Math.ceil(VIEW_H / ROW_H) + OVERSCAN * 2)
})
const pagedRows = computed(() => {
  if (isVirtual.value) return processed.value.slice(vStart.value, vEnd.value)
  if (!cap.value.page) return processed.value
  const start = (page.value - 1) * pageSizeState.value
  return processed.value.slice(start, start + pageSizeState.value)
})
const tableRows = computed(() => {
  if (!isVirtual.value) return pagedRows.value
  const rows = []
  const padTop = vStart.value * ROW_H
  const padBottom = Math.max(0, (processed.value.length - vEnd.value) * ROW_H)
  if (padTop > 0) rows.push({ __spacer: 'top', __h: padTop })
  rows.push(...pagedRows.value)
  if (padBottom > 0) rows.push({ __spacer: 'bot', __h: padBottom })
  return rows
})
const antColumns = computed(() => {
  const cols = []
  const utility = (key, width) => ({
    title: '',
    key,
    dataIndex: key,
    width,
    fixed: 'left',
    customHeaderCell: () => ({ class: 'wem-th' }),
    customCell: (record) => spacerAttrs(record)
  })
  if (cap.value.expand) cols.push(utility('__expand', 36))
  if (cap.value.drag && viewPrefs.value.showDragHandle !== false) cols.push(utility('__drag', 36))
  if (cap.value.select) cols.push(utility('__select', 42))
  visibleDataColumns.value.forEach((col) => {
    cols.push({
      title: col.title,
      key: col.key,
      dataIndex: col.dataIndex,
      width: widthOf(col),
      fixed: layout.fixed[col.key] || undefined,
      customHeaderCell: () => ({ class: 'wem-th' }),
      customCell: (record) => dataCellAttrs(record, col)
    })
  })
  return cols
})
const scrollX = computed(() => antColumns.value.reduce((sum, col) => sum + (Number(col.width) || 80), 0) + 8)
const tableScroll = computed(() => (isVirtual.value ? { x: scrollX.value, y: VIEW_H } : { x: scrollX.value }))
const filteredKeyList = computed(() => processed.value.map((row) => row?.[props.rowKey]))
const selectableKeyList = computed(() => processed.value.filter((row) => !isRowLocked(row)).map((row) => row?.[props.rowKey]))
const allFilteredSelected = computed(() => selectableKeyList.value.length > 0 && selectableKeyList.value.every((key) => selected.value.has(key)))
const someFilteredSelected = computed(() => selectableKeyList.value.some((key) => selected.value.has(key)))
const selectedExisting = computed(() => {
  const keys = new Set((props.rows || []).map((row) => row?.[props.rowKey]))
  let count = 0
  selected.value.forEach((key) => { if (keys.has(key)) count += 1 })
  return count
})
const selectedRows = computed(() => {
  const inView = processed.value.filter((row) => selected.value.has(row?.[props.rowKey]))
  const seen = new Set(inView.map((row) => row?.[props.rowKey]))
  const rest = (props.rows || []).filter((row) => selected.value.has(row?.[props.rowKey]) && !seen.has(row?.[props.rowKey]))
  return [...inView, ...rest]
})
const showBatch = computed(() => cap.value.select && selectedExisting.value > 0)
const pageSpan = computed(() => {
  const size = pageSizeState.value || 50
  const pages = new Set()
  processed.value.forEach((row, index) => {
    if (selected.value.has(row?.[props.rowKey])) pages.add(Math.floor(index / size) + 1)
  })
  return pages.size
})
const activeChips = computed(() => allDataColumns.value
  .map((col) => ({ key: col.key, label: filterChip(col) }))
  .filter((item) => item.label))
const matches = computed(() => {
  if (!cap.value.find || !findQuery.value) return []
  const list = []
  processed.value.forEach((row) => {
    visibleDataColumns.value.forEach((col) => {
      if (textHits(displayText(row, col), findQuery.value)) {
        list.push({ rowKey: row?.[props.rowKey], colKey: col.key })
      }
    })
  })
  return list
})
const currentMatch = computed(() => (findIndex.value >= 0 ? matches.value[findIndex.value] || null : null))
const uniqCache = computed(() => {
  const col = colMap.value.get(filterOpenKey.value)
  if (!col || !isTextFilter(col)) return []
  const set = new Set()
  ;(props.rows || []).forEach((row) => {
    const text = displayText(row, col)
    if (text !== '') set.add(text)
  })
  return [...set].sort((a, b) => a.localeCompare(b, 'zh')).slice(0, 300)
})
const shownUniq = computed(() => {
  const query = uniqQuery.value.trim().toLowerCase()
  if (!query) return uniqCache.value
  return uniqCache.value.filter((item) => item.toLowerCase().includes(query))
})
const presetSnapshot = computed(() => ({
  layout: {
    order: layout.order.slice(),
    widths: { ...layout.widths },
    hidden: layout.hidden.slice(),
    fixed: { ...layout.fixed }
  },
  filters: cloneData(filters.value) || {},
  sorts: cloneData(sorts.value) || [],
  formatEnabled: Object.fromEntries((formatRules.value || []).map((rule) => [rule.id, rule.enabled !== false]))
}))
const exportRows = computed(() => {
  if (exportScope.value === 'selected') return selectedRows.value
  if (exportScope.value === 'all') return props.rows || []
  return processed.value
})
const exportPreview = computed(() => exportText(
  exportRows.value.slice(0, 20),
  exportColumnPayload(),
  exportFormat.value,
  exportOptions()
))
const colSig = computed(() => normalizedColumns.value.map((col) => col.key).join('\0'))

watch(() => props.pageSize, (value) => {
  if (value) pageSizeState.value = value
})
watch(() => envStore.config && envStore.config.pageSize, (value) => {
  if (props.pageSize || Number(readTableSettings().pageSize) > 0) return
  const next = Number(value)
  if (Number.isFinite(next) && next >= 10 && next <= 200) pageSizeState.value = next
})
watch(tableSettingsRev, () => {
  if (props.pageSize) return
  const next = initialPageSize()
  if (next === pageSizeState.value) return
  pageSizeState.value = next
  if (page.value > pageCount.value) page.value = pageCount.value
})
const filterSig = computed(() => JSON.stringify(compactFilters(filters.value)))
watch(filterSig, () => {
  if (!mute) page.value = 1
})
watch(sorts, () => {
  if (!mute) page.value = 1
})
watch([() => processed.value.length, pageSizeState], () => {
  if (page.value > pageCount.value) page.value = pageCount.value
})
watch(page, () => {
  if (viewPrefs.value.crossPageSelect !== false || !cap.value.select || isVirtual.value) return
  const visible = new Set(pagedRows.value.map((row) => row?.[props.rowKey]))
  const next = [...selected.value].filter((key) => visible.has(key))
  if (next.length !== selected.value.size) selected.value = new Set(next)
})
watch(() => props.tableId, () => {
  undoStack.value = []
  redoStack.value = []
  selected.value = new Set()
  expandedRowKeys.value = []
  findQuery.value = ''
  findIndex.value = -1
  page.value = 1
  editing.value = null
  menu.open = false
  loadLayout()
})
watch(colSig, (value, prev) => {
  if (!prev || !layoutReady.value) return
  syncColumnKeys()
  persistLayout()
})
watch(selected, (set) => {
  emit('selection-change', [...set])
})
watch(() => props.rows, (list) => {
  const keys = new Set((list || []).map((row) => row?.[props.rowKey]))
  const locked = new Set((list || []).filter((row) => isRowLocked(row)).map((row) => row?.[props.rowKey]))
  if ([...selected.value].some((key) => !keys.has(key) || locked.has(key))) {
    selected.value = new Set([...selected.value].filter((key) => keys.has(key) && !locked.has(key)))
  }
  const nextExpanded = expandedRowKeys.value.filter((key) => keys.has(key))
  if (nextExpanded.length !== expandedRowKeys.value.length) expandedRowKeys.value = nextExpanded
})
watch([findQuery, findCase, findWhole], () => { findIndex.value = -1 })
watch(matches, (list) => {
  if (findIndex.value >= list.length) findIndex.value = -1
})
watch(scrollTop, async (value) => {
  if (!isVirtual.value) return
  await nextTick()
  const el = wrap.value?.querySelector('.ant-table-body')
  if (el && Math.abs(el.scrollTop - value) > ROW_H) el.scrollTop = value
})

function onTableSettingsChange() {
  tableSettingsRev.value += 1
}
onMounted(async () => {
  await loadLayout()
  layoutReady.value = true
  document.addEventListener('mousedown', onDocMouseDown)
  window.addEventListener('wem-table-settings', onTableSettingsChange)
  bindBodyScroll()
})
onUpdated(bindBodyScroll)
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMouseDown)
  window.removeEventListener('wem-table-settings', onTableSettingsChange)
  if (scrollEl) scrollEl.removeEventListener('scroll', onBodyScroll)
})

function itemRender({ type, originalElement }) {
  if (type === 'prev') return h('span', '上一页')
  if (type === 'next') return h('span', '下一页')
  return originalElement
}

function initialPageSize() {
  if (props.pageSize) return props.pageSize
  const local = Number(readTableSettings().pageSize)
  if (Number.isFinite(local) && local > 0) return local
  const globalSize = Number(envStore.config && envStore.config.pageSize)
  return Number.isFinite(globalSize) && globalSize >= 10 && globalSize <= 200 ? globalSize : 50
}

function readTableSettings() {
  try {
    const raw = localStorage.getItem('wem-table-settings')
    const data = raw ? JSON.parse(raw) : {}
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

function readJson(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function cloneData(value) {
  return JSON.parse(JSON.stringify(value ?? null))
}

function colKey(col) {
  return col?.key || col?.dataIndex
}

function normalizeCol(col) {
  const key = colKey(col)
  if (!key) return null
  return { ...col, key, dataIndex: col.dataIndex || key, title: col.title || key, type: col.type || 'text' }
}

function userColumn(column) {
  return colMap.value.get(column?.key) || null
}

function lookupCol(column) {
  if (!column || String(column.key).startsWith('__')) return column
  return colMap.value.get(column.key) || column
}

function emptyFilter() {
  return { keyword: '', exact: false, caseSensitive: false, values: [], min: '', max: '', start: '', end: '', preset: '' }
}

function defaultMin(col) {
  if (Number.isFinite(Number(col?.minWidth))) return Number(col.minWidth)
  const blob = `${col?.key || ''} ${col?.dataIndex || ''} ${col?.title || ''}`
  if (/值|value|path|content/i.test(blob)) return 180
  if (/名|name|title|key/i.test(blob)) return 120
  return 80
}

function defaultMax(col) {
  return Number.isFinite(Number(col?.maxWidth)) ? Number(col.maxWidth) : 640
}

function defaultWidth(col) {
  if (Number.isFinite(Number(col?.width))) return Number(col.width)
  const blob = `${col?.key || ''} ${col?.dataIndex || ''} ${col?.title || ''}`
  if (/值|value|path|content/i.test(blob)) return 240
  if (/名|name|title|key/i.test(blob)) return 160
  return 140
}

function widthOf(col) {
  const saved = Number(layout.widths[col.key])
  if (Number.isFinite(saved) && saved > 0) return saved
  return defaultWidth(col)
}

function applyDefaultLayout() {
  const cols = normalizedColumns.value
  layout.order = cols.map((col) => col.key)
  layout.widths = {}
  layout.hidden = cols.filter((col) => col.visible === false).map((col) => col.key)
  const fixed = {}
  cols.forEach((col) => {
    if (col.fixed === 'left' || col.fixed === 'right') fixed[col.key] = col.fixed
  })
  layout.fixed = fixed
}

function normalizeSaved(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const src = raw.layout && typeof raw.layout === 'object'
    ? { ...raw.layout, filters: raw.filters ?? raw.layout.filters }
    : raw
  const hasOrder = Array.isArray(src.order) && src.order.length > 0
  const hasWidths = !!src.widths && typeof src.widths === 'object' && Object.keys(src.widths).length > 0
  const hasHidden = Array.isArray(src.hidden) && src.hidden.length > 0
  const hasFixed = !!src.fixed && typeof src.fixed === 'object' && Object.keys(src.fixed).length > 0
  const hasFilters = !!src.filters && typeof src.filters === 'object' && Object.keys(src.filters).length > 0
  if (!hasOrder && !hasWidths && !hasHidden && !hasFixed && !hasFilters) return null
  return src
}

function applySaved(saved) {
  const keys = new Set(normalizedColumns.value.map((col) => col.key))
  if (Array.isArray(saved.order) && saved.order.length) {
    const order = saved.order.filter((key) => keys.has(key))
    layout.order.forEach((key) => { if (!order.includes(key)) order.push(key) })
    layout.order = order
  }
  if (saved.widths && typeof saved.widths === 'object') layout.widths = { ...saved.widths }
  if (Array.isArray(saved.hidden)) layout.hidden = saved.hidden.filter((key) => keys.has(key))
  if (saved.fixed && typeof saved.fixed === 'object') {
    const fixed = {}
    const known = new Set(saved.order || [])
    layout.order.forEach((key) => {
      if (saved.fixed[key] === 'left' || saved.fixed[key] === 'right') fixed[key] = saved.fixed[key]
      else if (!known.has(key)) {
        const col = colMap.value.get(key)
        if (col?.fixed === 'left' || col?.fixed === 'right') fixed[key] = col.fixed
      }
    })
    layout.fixed = fixed
  }
  if (readTableSettings().persistFilter === true && saved.filters && typeof saved.filters === 'object') {
    filters.value = saved.filters
  }
}

function packFixedOrder() {
  const left = []
  const mid = []
  const right = []
  layout.order.forEach((key) => {
    if (layout.fixed[key] === 'left') left.push(key)
    else if (layout.fixed[key] === 'right') right.push(key)
    else mid.push(key)
  })
  layout.order = [...left, ...mid, ...right]
}

function ensureOneVisible() {
  const visible = layout.order.filter((key) => !layout.hidden.includes(key))
  if (!visible.length && layout.order[0]) {
    layout.hidden = layout.hidden.filter((key) => key !== layout.order[0])
  }
}

function syncColumnKeys() {
  const keys = normalizedColumns.value.map((col) => col.key)
  const set = new Set(keys)
  const order = layout.order.filter((key) => set.has(key))
  keys.forEach((key) => {
    if (order.includes(key)) return
    const col = colMap.value.get(key)
    if (col?.fixed === 'right') order.push(key)
    else if (col?.fixed === 'left') order.splice(order.filter((item) => layout.fixed[item] === 'left').length, 0, key)
    else order.splice(order.length - order.filter((item) => layout.fixed[item] === 'right').length, 0, key)
    if (col?.visible === false) layout.hidden = [...layout.hidden, key]
    if (col?.fixed === 'left' || col?.fixed === 'right') layout.fixed = { ...layout.fixed, [key]: col.fixed }
  })
  layout.order = order
  layout.hidden = layout.hidden.filter((key) => set.has(key))
  const fixed = {}
  Object.keys(layout.fixed).forEach((key) => { if (set.has(key)) fixed[key] = layout.fixed[key] })
  layout.fixed = fixed
  packFixedOrder()
  ensureOneVisible()
}

async function loadLayout() {
  const seq = ++loadSeq
  const id = props.tableId
  mute += 1
  applyDefaultLayout()
  filters.value = {}
  sorts.value = []
  const allowLayout = readTableSettings().saveLayout !== false
  const local = allowLayout ? readJson(`wem-table-layout:${id}`) : null
  let remote = null
  const loader = allowLayout && typeof window !== 'undefined' ? window.envAPI?.table?.load : null
  if (typeof loader === 'function') {
    try { remote = await loader(id) } catch { remote = null }
  }
  if (seq !== loadSeq) {
    mute -= 1
    return
  }
  applyDefaultLayout()
  const saved = normalizeSaved(remote) || normalizeSaved(local)
  if (saved) applySaved(saved)
  packFixedOrder()
  ensureOneVisible()
  const storedFormats = readJson(`wem-format:${id}`)
  formatRules.value = Array.isArray(storedFormats) ? storedFormats : []
  mute -= 1
  persistLayout()
}

function persistLayout() {
  if (readTableSettings().saveLayout === false) return
  if (mute || persistQueued) return
  persistQueued = true
  const id = props.tableId
  queueMicrotask(() => {
    persistQueued = false
    if (mute || id !== props.tableId) return
    const data = {
      order: layout.order.slice(),
      widths: { ...layout.widths },
      hidden: layout.hidden.slice(),
      fixed: { ...layout.fixed }
    }
    if (readTableSettings().persistFilter === true) data.filters = cloneData(filters.value)
    try { localStorage.setItem(`wem-table-layout:${id}`, JSON.stringify(data)) } catch { /* 配额不足时忽略 */ }
    const save = window.envAPI?.table?.save
    if (typeof save === 'function') {
      try { save(id, data) } catch { /* 远端失败不阻断界面 */ }
    }
  })
}

function makeSnapshot() {
  return {
    layout: {
      order: layout.order.slice(),
      widths: { ...layout.widths },
      hidden: layout.hidden.slice(),
      fixed: { ...layout.fixed }
    },
    filters: cloneData(filters.value) || {},
    sorts: cloneData(sorts.value) || [],
    rows: (props.rows || []).slice()
  }
}

function remember(snapshot) {
  if (mute) return
  undoStack.value = [...undoStack.value, snapshot].slice(-20)
  redoStack.value = []
}

function pushHistory() {
  remember(makeSnapshot())
}

function applySnapshot(snapshot) {
  mute += 1
  layout.order = (snapshot.layout?.order || []).slice()
  layout.widths = { ...(snapshot.layout?.widths || {}) }
  layout.hidden = (snapshot.layout?.hidden || []).slice()
  layout.fixed = { ...(snapshot.layout?.fixed || {}) }
  filters.value = cloneData(snapshot.filters) || {}
  sorts.value = cloneData(snapshot.sorts) || []
  packFixedOrder()
  ensureOneVisible()
  const same = snapshot.rows.length === props.rows.length && snapshot.rows.every((row, index) => row === props.rows[index])
  mute -= 1
  persistLayout()
  if (!same) emit('update:rows', snapshot.rows.slice())
}

function undo() {
  if (!undoStack.value.length) return
  const past = undoStack.value[undoStack.value.length - 1]
  undoStack.value = undoStack.value.slice(0, -1)
  redoStack.value = [...redoStack.value, makeSnapshot()].slice(-20)
  applySnapshot(past)
}

function redo() {
  if (!redoStack.value.length) return
  const next = redoStack.value[redoStack.value.length - 1]
  redoStack.value = redoStack.value.slice(0, -1)
  undoStack.value = [...undoStack.value, makeSnapshot()].slice(-20)
  applySnapshot(next)
}

function toggleColumn(key, visible) {
  if (!visible) {
    const remain = layout.order.filter((item) => item !== key && !layout.hidden.includes(item))
    if (!remain.length) {
      message.warning('至少保留一列')
      return
    }
    pushHistory()
    layout.hidden = [...layout.hidden, key]
  } else {
    pushHistory()
    layout.hidden = layout.hidden.filter((item) => item !== key)
  }
  persistLayout()
}

function setFixed(key, side) {
  pushHistory()
  const fixed = { ...layout.fixed }
  if (side === 'left' || side === 'right') fixed[key] = side
  else delete fixed[key]
  layout.fixed = fixed
  packFixedOrder()
  persistLayout()
}

function fixKey(key, side) {
  return `fix|${encodeURIComponent(key)}|${side}`
}

function onLayoutMenu({ key }) {
  if (key === 'reset') {
    confirmReset()
    return
  }
  const parts = String(key).split('|')
  if (parts[0] !== 'fix' || parts.length < 3) return
  const col = decodeURIComponent(parts[1])
  setFixed(col, parts[2] === 'none' ? null : parts[2])
}

function confirmReset() {
  Modal.confirm({
    title: '重置列表布局',
    content: '列宽、列顺序、显示隐藏和固定列会恢复默认，筛选和行数据保持不变。',
    okText: '重置',
    cancelText: '取消',
    onOk: () => {
      pushHistory()
      applyDefaultLayout()
      packFixedOrder()
      ensureOneVisible()
      persistLayout()
    }
  })
}

function onColDragStart(col, event) {
  if (!col) return
  colDragMoved = false
  dragColKey.value = col.key
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', col.key)
}

function onColDragOver(col) {
  if (!col || !dragColKey.value || dragColKey.value === col.key) return
  colDragMoved = true
  dragOverKey.value = col.key
}

function onColDrop(col) {
  const from = dragColKey.value
  dragColKey.value = ''
  dragOverKey.value = ''
  if (!col || !from || from === col.key) return
  colDragMoved = true
  moveColumn(from, col.key)
}

function onColDragEnd() {
  dragColKey.value = ''
  dragOverKey.value = ''
}

function moveColumn(fromKey, toKey) {
  if (fromKey === toKey) return
  const order = layout.order.filter((key) => key !== fromKey)
  const toIndex = order.indexOf(toKey)
  if (toIndex < 0) return
  pushHistory()
  order.splice(toIndex, 0, fromKey)
  const toFix = layout.fixed[toKey] || null
  const fromFix = layout.fixed[fromKey] || null
  if (toFix !== fromFix) {
    const fixed = { ...layout.fixed }
    if (toFix) fixed[fromKey] = toFix
    else delete fixed[fromKey]
    layout.fixed = fixed
  }
  layout.order = order
  packFixedOrder()
  persistLayout()
}

function onSort(col) {
  if (colDragMoved) {
    colDragMoved = false
    return
  }
  if (!col || !canSort(col)) return
  pushHistory()
  const key = col.key
  const current = sorts.value.slice()
  if (current[0]?.key === key) {
    sorts.value = current[0].order === 'asc'
      ? [{ key, order: 'desc' }, ...current.slice(1)]
      : current.slice(1)
  } else {
    const rest = current.filter((item) => item.key !== key)
    sorts.value = [{ key, order: 'asc' }, ...rest].slice(0, 3)
  }
}

function canSort(col) {
  return !!(col && cap.value.sort && col.sortable !== false)
}

function canFilter(col) {
  return !!(col && cap.value.filter && col.filterable !== false)
}

function sortMeta(col) {
  if (!col) return null
  const index = sorts.value.findIndex((item) => item.key === col.key)
  if (index < 0) return null
  return { rank: index + 1, order: sorts.value[index].order }
}

function isTextFilter(col) {
  return !!col && col.type !== 'number' && col.type !== 'size' && col.type !== 'date' && col.type !== 'enum'
}

function filterOn(col) {
  if (!col) return false
  return isFilterActive(filters.value[col.key], col.type || 'text')
}

function onFilterOpen(col, open) {
  if (!col) return
  if (open) {
    filterBase = cloneData(filters.value) || {}
    if (!filters.value[col.key]) filters.value = { ...filters.value, [col.key]: emptyFilter() }
    uniqQuery.value = ''
    filterOpenKey.value = col.key
    return
  }
  if (filterOpenKey.value === col.key) filterOpenKey.value = ''
  stripInactiveFilters()
  const now = cloneData(filters.value) || {}
  if (filterBase && JSON.stringify(now) !== JSON.stringify(compactFilters(filterBase))) {
    const past = makeSnapshot()
    past.filters = filterBase
    remember(past)
  }
  filterBase = null
  persistLayout()
}

function compactFilters(source) {
  const next = {}
  Object.entries(source || {}).forEach(([key, filter]) => {
    const col = colMap.value.get(key)
    if (isFilterActive(filter, col?.type || 'text')) next[key] = filter
  })
  return next
}

function stripInactiveFilters() {
  filters.value = compactFilters(filters.value)
}

function hasFilterValue(key, value) {
  return (filters.value[key]?.values || []).map(String).includes(String(value))
}

function toggleFilterValue(key, value, checked) {
  const filter = filters.value[key]
  if (!filter) return
  const values = new Set((filter.values || []).map(String))
  if (checked) values.add(String(value))
  else values.delete(String(value))
  filter.values = [...values]
}

function setPreset(key, preset) {
  const filter = filters.value[key]
  if (!filter) return
  filter.preset = filter.preset === preset ? '' : preset
  if (filter.preset) {
    filter.start = ''
    filter.end = ''
  }
}

function onDateInput(key, field, value) {
  const filter = filters.value[key]
  if (!filter) return
  filter.preset = ''
  filter[field] = value
}

function clearFilter(key) {
  if (!filters.value[key]) {
    if (filterOpenKey.value === key) filterOpenKey.value = ''
    return
  }
  const inside = filterOpenKey.value === key
  if (!inside) pushHistory()
  const next = { ...filters.value }
  delete next[key]
  filters.value = next
  if (inside) filterOpenKey.value = ''
  else persistLayout()
}

function clearAllFilters() {
  if (!Object.keys(filters.value).length) return
  pushHistory()
  filterBase = null
  filters.value = {}
  filterOpenKey.value = ''
  persistLayout()
}

function filterChip(col) {
  const filter = filters.value[col.key]
  if (!filter || !isFilterActive(filter, col.type || 'text')) return ''
  if (col.type === 'date') {
    if (filter.preset === 'today') return `${col.title}：今天`
    if (filter.preset === 'd7') return `${col.title}：近7天`
    if (filter.preset === 'd30') return `${col.title}：近30天`
    return `${col.title}：${filter.start || '…'} ~ ${filter.end || '…'}`
  }
  if (col.type === 'number' || col.type === 'size') {
    return `${col.title}：${filter.min === '' || filter.min == null ? '…' : filter.min} ~ ${filter.max === '' || filter.max == null ? '…' : filter.max}`
  }
  if (col.type === 'enum') return `${col.title}：${filter.values.length} 项`
  const bits = []
  if (filter.keyword) bits.push(filter.exact ? `=${filter.keyword}` : filter.keyword)
  if (filter.values?.length) bits.push(`${filter.values.length} 个值`)
  return `${col.title}：${bits.join('，')}`
}

function enumChoices(col) {
  if (col?.enumOptions?.length) return col.enumOptions.map((item) => ({ value: item.value, label: item.label }))
  const map = new Map()
  ;(props.rows || []).forEach((row) => {
    const value = rawValue(row, col)
    if (value == null || value === '') return
    if (!map.has(String(value))) map.set(String(value), displayText(row, col) || String(value))
  })
  return [...map].map(([value, label]) => ({ value, label }))
}

function onResizeDown(col, event) {
  if (!col || !cap.value.resize) return
  const now = Date.now()
  if (lastResizeCol === col.key && now - lastResizeAt < 350) {
    lastResizeAt = 0
    lastResizeCol = ''
    resizeSession += 1
    onResizeDbl(col)
    return
  }
  lastResizeAt = now
  lastResizeCol = col.key
  const session = ++resizeSession
  const startX = event.clientX
  const startW = widthOf(col)
  const min = defaultMin(col)
  const max = defaultMax(col)
  let moved = false
  const move = (ev) => {
    if (session !== resizeSession) return
    const delta = ev.clientX - startX
    if (!moved && Math.abs(delta) < 3) return
    if (!moved) {
      moved = true
      pushHistory()
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    }
    layout.widths[col.key] = Math.round(Math.max(min, Math.min(max, startW + delta)))
  }
  const up = () => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    if (session !== resizeSession) return
    if (moved) persistLayout()
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}

function onResizeDbl(col) {
  if (!col) return
  pushHistory()
  const texts = [col.title, ...processed.value.map((row) => displayText(row, col))]
  layout.widths[col.key] = autofitWidth(texts, { minWidth: defaultMin(col), maxWidth: defaultMax(col) })
  persistLayout()
}

function isRowLocked(row) {
  return typeof props.rowDisabled === 'function' && !!props.rowDisabled(row)
}

function toggleAll(checked) {
  const next = new Set(selected.value)
  processed.value.forEach((row) => {
    if (isRowLocked(row)) return
    const key = row?.[props.rowKey]
    if (checked) next.add(key)
    else next.delete(key)
  })
  selected.value = next
}

function toggleRow(row, checked) {
  if (isRowLocked(row)) return
  const next = new Set(selected.value)
  const key = row?.[props.rowKey]
  if (checked) next.add(key)
  else next.delete(key)
  selected.value = next
}

function clearSelection() {
  selected.value = new Set()
}

function setSelection(keys) {
  const rows = props.rows || []
  const byKey = new Map(rows.map((row) => [row?.[props.rowKey], row]))
  selected.value = new Set((keys || []).filter((key) => {
    const row = byKey.get(key)
    return row && !isRowLocked(row)
  }))
}

function revealKey(key) {
  const index = processed.value.findIndex((row) => row?.[props.rowKey] === key)
  if (index < 0) return false
  if (isVirtual.value) {
    scrollTop.value = Math.max(0, index * ROW_H - ROW_H)
  } else if (cap.value.page) {
    page.value = Math.floor(index / pageSizeState.value) + 1
  }
  return true
}

function onPager(nextPage, nextSize) {
  if (nextSize && nextSize !== pageSizeState.value) {
    pageSizeState.value = nextSize
    page.value = 1
    return
  }
  page.value = nextPage || 1
}

function onPageJump(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return
  page.value = Math.min(pageCount.value, Math.max(1, Math.round(n)))
}

function emitBatch(action) {
  emit('batch', { action, rows: selectedRows.value.slice() })
}

async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
    message.success('已复制到剪贴板')
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.left = '-9999px'
    document.body.appendChild(area)
    area.select()
    document.execCommand('copy')
    area.remove()
    message.success('已复制到剪贴板')
  }
}

function downloadBlob(filename, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function exportColumnPayload() {
  return allDataColumns.value.map((col) => ({
    ...col,
    visible: !layout.hidden.includes(col.key),
    hidden: layout.hidden.includes(col.key)
  }))
}

function exportOptions() {
  return {
    includeHeader: exportHeader.value,
    includeHidden: exportHidden.value,
    includeStatus: exportStatus.value
  }
}

function visibleExportColumns() {
  return visibleDataColumns.value.map((col) => ({ ...col, visible: true }))
}

async function copySelected(kind) {
  const rows = selectedRows.value
  if (!rows.length) return
  const text = kind === 'tsv'
    ? exportText(rows, visibleExportColumns(), 'txt', { includeHeader: true })
    : rows.map((row) => visibleDataColumns.value.map((col) => displayText(row, col)).join(' | ')).join('\r\n')
  await writeClipboard(text)
  emitBatch(kind === 'tsv' ? 'copy-tsv' : 'copy-text')
}

function batchExport(format) {
  const rows = selectedRows.value
  if (!rows.length) {
    message.warning('请先选择要导出的行')
    return
  }
  const text = exportText(rows, visibleExportColumns(), format, { includeHeader: true, includeHidden: false, includeStatus: false })
  const mime = format === 'json' ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8'
  downloadBlob(`${props.tableId}-selected.${format}`, format === 'csv' || format === 'txt' ? `\uFEFF${text}` : text, mime)
  emitBatch(`export-${format}`)
}

function openExport(scope) {
  exportScope.value = scope || (selectedExisting.value ? 'selected' : (activeChips.value.length ? 'filtered' : 'all'))
  exportOpen.value = true
}

function downloadExport() {
  if (exportScope.value === 'selected' && !selectedRows.value.length) {
    message.warning('请先选择要导出的行')
    return Promise.reject()
  }
  const text = exportText(exportRows.value, exportColumnPayload(), exportFormat.value, exportOptions())
  const ext = exportFormat.value
  const mime = ext === 'json' ? 'application/json;charset=utf-8' : ext === 'html' ? 'text/html;charset=utf-8' : 'text/plain;charset=utf-8'
  const body = ext === 'csv' || ext === 'txt' ? `\uFEFF${text}` : text
  downloadBlob(`${props.tableId}.${ext}`, body, mime)
  message.success('已开始下载')
}

function onRowDragStart(row, event) {
  rowDragKey.value = row?.[props.rowKey]
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', String(rowDragKey.value))
}

function onRowDragEnd() {
  rowDragKey.value = null
  dropKey.value = null
}

function onRowDrop(row) {
  const from = rowDragKey.value
  const to = row?.[props.rowKey]
  rowDragKey.value = null
  dropKey.value = null
  if (from == null || from === to) return
  const list = processed.value.slice()
  const fromIndex = list.findIndex((item) => item?.[props.rowKey] === from)
  const toIndex = list.findIndex((item) => item?.[props.rowKey] === to)
  if (fromIndex < 0 || toIndex < 0) return
  pushHistory()
  const next = list.slice()
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  const set = new Set(next.map((item) => item?.[props.rowKey]))
  const queue = next.slice()
  const full = (props.rows || []).map((item) => (set.has(item?.[props.rowKey]) ? queue.shift() : item))
  if (sorts.value.length) {
    sorts.value = []
    message.info('已按拖拽结果重排，并取消当前排序')
  }
  emit('update:rows', full)
}

function isExpanded(row) {
  return expandedRowKeys.value.includes(row?.[props.rowKey])
}

function toggleExpand(row, silent) {
  const key = row?.[props.rowKey]
  if (isExpanded(row)) expandedRowKeys.value = expandedRowKeys.value.filter((item) => item !== key)
  else expandedRowKeys.value = [...expandedRowKeys.value, key]
  if (!silent) emit('expand', row)
}

function expandAll() {
  expandedRowKeys.value = processed.value.map((row) => row?.[props.rowKey])
}

function collapseAll() {
  expandedRowKeys.value = []
}

function rowExpandable(record) {
  return cap.value.expand && !record?.__spacer
}

function escapeReg(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function textHits(text, query) {
  if (!query) return false
  if (!findWhole.value) {
    const source = findCase.value ? String(text) : String(text).toLowerCase()
    const sample = findCase.value ? query : query.toLowerCase()
    return source.includes(sample)
  }
  const re = new RegExp(`(?:^|[^\\w\\u4e00-\\u9fff])${escapeReg(query)}(?:$|[^\\w\\u4e00-\\u9fff])`, findCase.value ? '' : 'i')
  return re.test(String(text))
}

function highlightParts(text, current) {
  const query = findQuery.value
  const str = text == null ? '' : String(text)
  if (!query || !cap.value.find) return [{ text: str, hit: false }]
  const flags = findCase.value ? 'g' : 'gi'
  const re = findWhole.value
    ? new RegExp(`(?<![\\w\\u4e00-\\u9fff])${escapeReg(query)}(?![\\w\\u4e00-\\u9fff])`, flags)
    : new RegExp(escapeReg(query), flags)
  const parts = []
  let last = 0
  let matched = re.exec(str)
  while (matched) {
    if (matched.index > last) parts.push({ text: str.slice(last, matched.index), hit: false })
    parts.push({ text: matched[0], hit: true, current })
    last = matched.index + matched[0].length
    if (!matched[0]) break
    matched = re.exec(str)
  }
  if (!parts.length) return [{ text: str, hit: false }]
  if (last < str.length) parts.push({ text: str.slice(last), hit: false })
  return parts
}

function isCurrentFind(row, col) {
  return !!(currentMatch.value && col && currentMatch.value.rowKey === row?.[props.rowKey] && currentMatch.value.colKey === col.key)
}

function cellDomKey(row, col) {
  return `${row?.[props.rowKey]}::${col?.key || ''}`
}

function gotoMatch(delta) {
  const list = matches.value
  if (!list.length) {
    message.info('没有匹配')
    return
  }
  if (findIndex.value < 0) findIndex.value = delta < 0 ? list.length - 1 : 0
  else findIndex.value = (findIndex.value + delta + list.length) % list.length
  revealMatch(list[findIndex.value])
}

function revealMatch(match) {
  const index = processed.value.findIndex((row) => row?.[props.rowKey] === match.rowKey)
  if (index < 0) return
  if (isVirtual.value) {
    const top = Math.max(0, index * ROW_H - ROW_H)
    scrollTop.value = top
    nextTick(() => {
      const el = wrap.value?.querySelector('.ant-table-body')
      if (el) el.scrollTop = top
    })
  } else if (cap.value.page) {
    page.value = Math.floor(index / pageSizeState.value) + 1
  }
  nextTick(() => {
    const selector = `[data-cell-key="${CSS.escape(cellDomKey({ [props.rowKey]: match.rowKey }, { key: match.colKey }))}"]`
    wrap.value?.querySelector(selector)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  })
}

function clipCell(col) {
  return isVirtual.value || col?.ellipsis !== false
}

function isEditing(row, col) {
  return !!(editing.value && col && editing.value.rowKey === row?.[props.rowKey] && editing.value.colKey === col.key)
}

function setEditEl(el) {
  if (el) editEl.value = el
}

function validateEdit(col, value) {
  const text = value == null ? '' : String(value)
  const key = col?.key || col?.dataIndex
  const field = col?.dataIndex
  if ((key === 'name' || key === 'key' || field === 'name' || field === 'key') && !text.trim()) return '名称不能为空'
  if (text.includes('=') || /[\r\n]/.test(text)) return '不能包含等号或换行'
  return ''
}

function onCellDbl(row, col) {
  if (cap.value.inline && col?.editable === true) beginEdit(row, col)
  else emit('row-dblclick', row)
}

function onCellContext(event, row, col) {
  if (row?.__spacer) return
  event.preventDefault()
  if (cap.value.contextMenu) openMenu(event, row, col)
  else emit('row-context', { row, column: col, x: event.clientX, y: event.clientY })
}

function beginEdit(row, col) {
  if (!cap.value.inline || !col || col.editable !== true) return
  if (editing.value && !confirmEdit()) return
  editing.value = { rowKey: row?.[props.rowKey], colKey: col.key }
  const value = rawValue(row, col)
  editDraft.value = value == null ? '' : String(value)
  editError.value = ''
}

function confirmEdit() {
  const current = editing.value
  if (!current) return true
  const col = colMap.value.get(current.colKey)
  const row = (props.rows || []).find((item) => item?.[props.rowKey] === current.rowKey)
  const error = col ? validateEdit(col, editDraft.value) : ''
  if (error) {
    editError.value = error
    return false
  }
  editError.value = ''
  editing.value = null
  if (row && col) emit('edit', { row, key: col.key, value: editDraft.value })
  return true
}

function cancelEdit() {
  editing.value = null
  editError.value = ''
}

function openMenu(event, row, col) {
  if (!cap.value.contextMenu || row?.__spacer) return
  event.preventDefault()
  menu.open = true
  menu.x = event.clientX
  menu.y = event.clientY
  menu.row = row
  menu.col = col || null
  nextTick(() => {
    const el = menuEl.value
    if (!el) return
    const rect = el.getBoundingClientRect()
    menu.x = Math.max(4, Math.min(menu.x, window.innerWidth - rect.width - 8))
    menu.y = Math.max(4, Math.min(menu.y, window.innerHeight - rect.height - 8))
  })
}

function onDocMouseDown(event) {
  const target = event.target
  if (menu.open && menuEl.value && !menuEl.value.contains(target)) menu.open = false
  if (editing.value && editEl.value && !editEl.value.contains(target)) confirmEdit()
}

async function copyCell() {
  if (!menu.row || !menu.col) return
  await writeClipboard(displayText(menu.row, menu.col))
  emit('context', { action: 'copyCell', row: menu.row, rows: [menu.row] })
  menu.open = false
}

async function copyRow() {
  if (!menu.row) return
  const text = visibleDataColumns.value.map((col) => displayText(menu.row, col)).join('\t')
  await writeClipboard(text)
  emit('context', { action: 'copyRow', row: menu.row, rows: [menu.row] })
  menu.open = false
}

function contextEdit() {
  const row = menu.row
  const col = menu.col?.editable ? menu.col : visibleDataColumns.value.find((item) => item.editable)
  menu.open = false
  if (!row || !col) {
    message.info('没有可编辑的列')
    return
  }
  beginEdit(row, col)
  emit('context', { action: 'edit', row, rows: [row] })
}

function contextExpand() {
  const row = menu.row
  menu.open = false
  if (!row) return
  toggleExpand(row)
  emit('context', { action: 'expand', row, rows: [row] })
}

function contextBatchCopy() {
  copySelected('text')
  emit('context', { action: 'batchCopy', row: menu.row, rows: selectedRows.value.slice() })
  menu.open = false
}

function contextBatchExport() {
  openExport('selected')
  emit('context', { action: 'batchExport', row: menu.row, rows: selectedRows.value.slice() })
  menu.open = false
}

function summaryText(col) {
  if (!col) return ''
  if (String(col.key).startsWith('__')) return col.key === antColumns.value[0]?.key ? '汇总' : ''
  const list = processed.value
  if (col.type === 'number' || col.type === 'size') {
    let sum = 0
    let count = 0
    list.forEach((row) => {
      const n = col.type === 'size' ? parseSize(rawValue(row, col)) : Number(rawValue(row, col))
      if (Number.isFinite(n)) {
        sum += n
        count += 1
      }
    })
    if (!count) return '—'
    return col.type === 'size' ? `合计 ${formatBytes(sum)}` : `合计 ${formatNumber(sum)}`
  }
  if (col.type === 'enum') {
    const counts = new Map()
    list.forEach((row) => {
      const label = displayText(row, col) || '（空）'
      counts.set(label, (counts.get(label) || 0) + 1)
    })
    return [...counts].map(([label, count]) => `${label} ${count}`).join(' · ') || '—'
  }
  const uniq = new Set()
  list.forEach((row) => {
    const text = displayText(row, col)
    if (text !== '') uniq.add(text)
  })
  return `唯一 ${uniq.size}`
}

function formatNumber(value) {
  if (Number.isInteger(value)) return String(value)
  return String(Math.round(value * 1000) / 1000)
}

function formatBytes(value) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let n = value
  let index = 0
  while (Math.abs(n) >= 1024 && index < units.length - 1) {
    n /= 1024
    index += 1
  }
  return `${formatNumber(n)} ${units[index]}`
}

function spacerAttrs(record) {
  if (!record?.__spacer) return {}
  return { style: { height: `${record.__h}px`, padding: 0, border: 'none', lineHeight: 0 } }
}

function dataCellAttrs(record, col) {
  if (record?.__spacer) return spacerAttrs(record)
  const style = cap.value.format && viewPrefs.value.enableFormat !== false
    ? applyFormats(rawValue(record, col), record, col, formatRules.value, { audit: isAudit.value, columns: normalizedColumns.value })
    : {}
  const cls = []
  if (clipCell(col)) cls.push('wem-ellipsis')
  if (isCurrentFind(record, col)) cls.push('wem-find-cell')
  return { style, class: cls.join(' ') }
}

function getRowKey(record) {
  if (record?.__spacer) return `spacer-${record.__spacer}`
  return record?.[props.rowKey]
}

function rowClassName(record) {
  if (record?.__spacer) return 'wem-spacer'
  const cls = []
  if (cap.value.select && selected.value.has(record?.[props.rowKey])) cls.push('wem-row-selected')
  if (dropKey.value != null && dropKey.value === record?.[props.rowKey]) cls.push('wem-row-drop')
  if (currentMatch.value && currentMatch.value.rowKey === record?.[props.rowKey]) cls.push('wem-find-row')
  if (typeof props.rowClass === 'function') {
    const extra = props.rowClass(record)
    if (extra) {
      const text = viewPrefs.value.inlineMark === false
        ? String(extra).split(/\s+/).filter((name) => name && name !== 'row-modified').join(' ')
        : extra
      if (text) cls.push(text)
    }
  }
  return cls.join(' ')
}

function customRow(record) {
  if (record?.__spacer) return { style: { height: `${record.__h}px` } }
  return {
    onClick: () => emit('row-click', record),
    onDblclick: () => emit('row-dblclick', record),
    onContextmenu: (event) => {
      if (cap.value.contextMenu) openMenu(event, record, null)
      else {
        event.preventDefault()
        emit('row-context', { row: record, x: event.clientX, y: event.clientY })
      }
    },
    onDragover: (event) => {
      if (!cap.value.drag || rowDragKey.value == null) return
      event.preventDefault()
      dropKey.value = record?.[props.rowKey]
    },
    onDrop: (event) => {
      if (!cap.value.drag) return
      event.preventDefault()
      onRowDrop(record)
    }
  }
}

function onFormats(rules) {
  formatRules.value = Array.isArray(rules) ? rules : []
}

function applyLoadedPreset(preset) {
  pushHistory()
  if (preset.layout) {
    applySaved({ ...preset.layout, filters: readTableSettings().persistFilter === true ? preset.filters : undefined })
    packFixedOrder()
    ensureOneVisible()
  }
  filters.value = preset.filters ? cloneData(preset.filters) || {} : {}
  sorts.value = Array.isArray(preset.sorts) ? cloneData(preset.sorts) || [] : []
  if (preset.formatEnabled && typeof preset.formatEnabled === 'object') {
    formatRules.value = (formatRules.value || []).map((rule) => (
      Object.prototype.hasOwnProperty.call(preset.formatEnabled, rule.id)
        ? { ...rule, enabled: !!preset.formatEnabled[rule.id] }
        : rule
    ))
    try { localStorage.setItem(`wem-format:${props.tableId}`, JSON.stringify(formatRules.value)) } catch { /* ignore */ }
    const saveExtras = window.envAPI?.table?.saveExtras
    if (typeof saveExtras === 'function') {
      try { saveExtras(props.tableId, { formats: formatRules.value }) } catch { /* ignore */ }
    }
  }
  persistLayout()
}

function onLoadPreset(preset) {
  if (!preset) return
  if (readTableSettings().confirmPresetLoad === false) {
    applyLoadedPreset(preset)
    return
  }
  Modal.confirm({
    title: '加载视图预设',
    content: `确定加载预设「${preset.name || '未命名'}」？当前列布局和筛选会被替换。`,
    okText: '加载',
    cancelText: '取消',
    onOk: () => applyLoadedPreset(preset)
  })
}

function onBodyScroll(event) {
  const top = event.target.scrollTop
  if (Math.abs(top - scrollTop.value) < 1) return
  scrollTop.value = top
}

function bindBodyScroll() {
  if (!isVirtual.value) {
    if (scrollEl) {
      scrollEl.removeEventListener('scroll', onBodyScroll)
      scrollEl = null
    }
    return
  }
  const body = wrap.value?.querySelector('.ant-table-body')
  if (body === scrollEl) return
  if (scrollEl) scrollEl.removeEventListener('scroll', onBodyScroll)
  scrollEl = body || null
  if (scrollEl) scrollEl.addEventListener('scroll', onBodyScroll, { passive: true })
}

defineExpose({ clearSelection, setSelection, revealKey })
</script>

<style scoped>
.wem-table-root {
  min-width: 0;
  color: var(--wem-text);
  font-size: var(--wem-fs);
}

.wem-toolbar,
.wem-toolbar-left,
.wem-toolbar-right,
.find-box,
.batch-bar,
.filter-bar,
.export-line,
.pop-row,
.pop-actions,
.wem-footer,
.wem-pager {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.wem-toolbar {
  justify-content: space-between;
  margin-bottom: 8px;
}

.wem-toolbar-right {
  margin-left: auto;
}

.hint {
  color: var(--wem-text-3);
  font-size: 12px;
}

.batch-bar {
  margin-bottom: 8px;
  padding: 6px 8px;
  border: 1px solid var(--wem-border);
  border-radius: 8px;
  background: rgba(22, 93, 255, 0.06);
}

.filter-bar {
  margin-bottom: 8px;
}

.error-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  padding: 8px 10px;
  border: 1px solid var(--wem-danger);
  border-radius: 8px;
  color: var(--wem-danger);
  background: var(--wem-mark-removed);
}

.state-block {
  padding: 24px 8px;
  text-align: center;
  color: var(--wem-text-2);
}

.wem-footer {
  justify-content: space-between;
  margin-top: 8px;
}

.wem-stat {
  color: var(--wem-text-2);
}

.menu-panel,
.filter-pop {
  min-width: 180px;
  max-width: 320px;
  padding: 8px;
  background: var(--wem-card);
}

.menu-check {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  color: var(--wem-text);
}

.value-list {
  max-height: 180px;
  margin-top: 6px;
  overflow: auto;
}

.filter-pop {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.th-box {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  height: 36px;
  padding: 0 12px 0 8px;
  user-select: none;
}

.th-box.is-drop {
  box-shadow: inset 0 -2px 0 var(--wem-primary);
}

.th-center {
  justify-content: center;
  padding-right: 8px;
}

.th-label {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
  cursor: grab;
}

.th-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sort-ind {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  color: var(--wem-primary);
  font-style: normal;
  font-size: 11px;
}

.sort-ind i {
  font-style: normal;
}

.th-filter {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  color: var(--wem-text-3);
  background: transparent;
  cursor: pointer;
}

.th-filter.on,
.th-filter:hover {
  color: var(--wem-primary);
}

.th-resize {
  position: absolute;
  top: 0;
  right: 0;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  z-index: 4;
}

.th-resize::after {
  content: '';
  position: absolute;
  top: 8px;
  bottom: 8px;
  right: 2px;
  width: 1px;
  background: transparent;
}

.th-resize:hover::after {
  background: var(--wem-primary);
}

.cell-view,
.cell-text {
  min-width: 0;
}

.cell-text.clip {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell-editor {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.cell-editor :deep(.ant-input) {
  flex: 1;
  min-width: 0;
}

.cell-editor.is-error :deep(.ant-input) {
  border-color: var(--wem-danger);
}

.edit-error {
  position: absolute;
  z-index: 2;
  margin-top: 28px;
  color: var(--wem-danger);
  font-size: 12px;
  white-space: nowrap;
}

.drag-handle,
.expand-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  color: var(--wem-text-3);
  background: transparent;
  cursor: pointer;
}

.drag-handle {
  cursor: grab;
}

.wem-hit {
  padding: 0 1px;
  border-radius: 2px;
  color: inherit;
  background: #ffe58f;
}

.wem-hit.current {
  color: #fff;
  background: var(--wem-primary);
}

.summary-text {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--wem-text-2);
}

.ctx-menu {
  position: fixed;
  z-index: 2000;
  min-width: 148px;
  padding: 4px;
  border: 1px solid var(--wem-border);
  border-radius: 8px;
  background: var(--wem-card);
  box-shadow: var(--wem-shadow-lg);
}

.ctx-item {
  display: block;
  width: 100%;
  padding: 6px 10px;
  border: 0;
  border-radius: 6px;
  color: var(--wem-text);
  text-align: left;
  background: transparent;
  cursor: pointer;
}

.ctx-item:hover:not(:disabled) {
  background: rgba(22, 93, 255, 0.08);
}

.ctx-item:disabled {
  color: var(--wem-text-3);
  cursor: default;
}

.ctx-split {
  height: 1px;
  margin: 4px 0;
  background: var(--wem-border);
}

.export-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.export-preview {
  max-height: 240px;
  margin: 0;
  padding: 8px;
  overflow: auto;
  border: 1px solid var(--wem-border);
  border-radius: 8px;
  color: var(--wem-text);
  background: var(--wem-card-alt);
  font-family: var(--wem-mono);
  font-size: 12px;
  white-space: pre-wrap;
}

.date-input {
  height: 24px;
  padding: 0 6px;
  border: 1px solid var(--wem-border-strong);
  border-radius: 6px;
  color: var(--wem-text);
  background: var(--wem-card);
}

:deep(.wem-grid .ant-table) {
  color: var(--wem-text);
  background: var(--wem-card);
}

:deep(.wem-grid .ant-table-thead > tr > th) {
  position: relative;
  height: 36px;
  padding: 0 !important;
  color: var(--wem-text-2) !important;
  background: var(--wem-card-alt) !important;
  border-bottom: 1px solid var(--wem-border) !important;
}

:deep(.wem-grid .ant-table-tbody > tr:not(.wem-spacer) > td) {
  height: 36px;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
  color: var(--wem-text);
  background: var(--wem-card);
  border-bottom: 1px solid var(--wem-border) !important;
  overflow: hidden;
}

:deep(.wem-grid .ant-table-tbody > tr:hover > td) {
  background: var(--wem-card-alt);
}

.wem-no-row-hover:deep(.wem-grid .ant-table-tbody > tr:hover:not(.wem-row-selected) > td) {
  background: var(--wem-card);
}

:deep(.wem-grid .ant-table-tbody > tr.wem-row-selected > td) {
  box-shadow: inset 3px 0 0 var(--wem-primary);
  background: rgba(22, 93, 255, 0.1);
}

:deep(.wem-grid tr.wem-row-drop > td) {
  box-shadow: inset 0 -2px 0 var(--wem-primary);
}

:deep(.wem-grid td.wem-find-cell) {
  outline: 1px solid var(--wem-primary);
  outline-offset: -2px;
}

:deep(.wem-grid tr.wem-spacer),
:deep(.wem-grid tr.wem-spacer > td) {
  padding: 0 !important;
  border: 0 !important;
  background: transparent !important;
  line-height: 0 !important;
  pointer-events: none;
}

:deep(.ant-table-summary) {
  background: var(--wem-card-alt);
}
</style>
