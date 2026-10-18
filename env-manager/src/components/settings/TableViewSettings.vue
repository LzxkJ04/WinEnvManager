<template>
  <div class="wem-card">
    <div class="wem-card-head">
      <div class="wem-card-title">表格视图设置</div>
      <a-button size="small" @click="reset">恢复表格默认设置</a-button>
    </div>
    <div class="wem-card-body">
      <div class="row"><span class="row-label">行悬浮高亮</span><a-switch v-model:checked="form.rowHover" @change="save" /></div>
      <div class="row"><span class="row-label">保存列布局</span><a-switch v-model:checked="form.saveLayout" @change="save" /><span class="text-muted">列宽、顺序、显隐</span></div>
      <div class="row"><span class="row-label">记住筛选条件</span><a-switch v-model:checked="form.persistFilter" @change="save" /><span class="text-muted">默认关闭，重新打开不保留筛选</span></div>
      <div class="row">
        <span class="row-label">默认每页行数</span>
        <a-select v-model:value="form.pageSize" size="small" style="width: 120px" @change="save">
          <a-select-option :value="10">10</a-select-option>
          <a-select-option :value="20">20</a-select-option>
          <a-select-option :value="50">50</a-select-option>
          <a-select-option :value="100">100</a-select-option>
        </a-select>
      </div>
      <div class="row"><span class="row-label">虚拟滚动阈值</span><a-input-number v-model:value="form.virtualThreshold" :min="100" :max="5000" size="small" @change="save" /></div>
      <div class="row"><span class="row-label">底部汇总行</span><a-switch v-model:checked="form.showSummary" @change="save" /></div>
      <div class="row"><span class="row-label">未保存黄标</span><a-switch v-model:checked="form.inlineMark" @change="save" /></div>
      <div class="row"><span class="row-label">跨页多选</span><a-switch v-model:checked="form.crossPageSelect" @change="save" /></div>
      <div class="row"><span class="row-label">显示拖拽手柄</span><a-switch v-model:checked="form.showDragHandle" @change="save" /></div>
      <div class="row"><span class="row-label">条件格式</span><a-switch v-model:checked="form.enableFormat" @change="save" /></div>
      <div class="row"><span class="row-label">加载预设前确认</span><a-switch v-model:checked="form.confirmPresetLoad" @change="save" /></div>
    </div>
  </div>
</template>

<script setup>
import { reactive } from 'vue'
import { message } from 'ant-design-vue'

const KEY = 'wem-table-settings'
const defaults = {
  rowHover: true,
  saveLayout: true,
  persistFilter: false,
  pageSize: 50,
  virtualThreshold: 500,
  showSummary: true,
  inlineMark: true,
  crossPageSelect: true,
  showDragHandle: true,
  expandDefault: 'collapse',
  exportFormat: 'csv',
  pasteDelim: 'auto',
  enableFormat: true,
  formatValidate: true,
  confirmPresetLoad: true
}
const form = reactive({ ...defaults, ...read() })

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch (_) { return {} }
}
function save() {
  localStorage.setItem(KEY, JSON.stringify({ ...form }))
  window.dispatchEvent(new Event('wem-table-settings'))
}
function reset() {
  Object.assign(form, defaults)
  save()
  message.success('表格设置已恢复默认')
}
</script>
