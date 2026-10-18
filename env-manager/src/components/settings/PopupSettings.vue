<template>
  <div class="wem-card">
    <div class="wem-card-head"><div class="wem-card-title">弹窗与提示</div></div>
    <div class="wem-card-body">
      <div class="row"><span class="row-label">高危操作必须确认</span><a-switch v-model:checked="form.forceDangerDialog" disabled /><span class="text-muted">此项保持开启</span></div>
      <div class="row"><span class="row-label">普通确认可不再提示</span><a-switch v-model:checked="form.allowSkipConfirm" @change="save" /></div>
      <div class="row"><span class="row-label">弹窗动画</span><a-switch v-model:checked="form.dialogAnim" @change="save" /></div>
      <div class="row"><span class="row-label">记住弹窗位置</span><a-switch v-model:checked="form.rememberPos" @change="save" /></div>
      <div class="row">
        <span class="row-label">遮罩透明度</span>
        <a-slider v-model:value="form.maskOpacity" :min="0.2" :max="0.8" :step="0.05" style="width: 180px" @change="save" />
      </div>
      <div class="row">
        <span class="row-label">重置</span>
        <a-button size="small" @click="clearSkips">重置全部不再提示</a-button>
        <a-button size="small" @click="clearPos">重置弹窗位置</a-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive } from 'vue'
import { message } from 'ant-design-vue'

const KEY = 'wem-popup-settings'
const defaults = { forceDangerDialog: true, allowSkipConfirm: true, dialogAnim: true, dialogCenter: true, rememberPos: true, maskOpacity: 0.45 }
const form = reactive({ ...defaults, ...read() })
applyAnim()

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch (_) { return {} }
}
function applyAnim() {
  const opacity = Number(form.maskOpacity)
  const mask = Number.isFinite(opacity) ? Math.min(0.8, Math.max(0.2, opacity)) : 0.45
  form.maskOpacity = mask
  document.documentElement.classList.toggle('wem-no-dialog-anim', form.dialogAnim === false)
  document.documentElement.style.setProperty('--wem-mask-opacity', String(mask))
}
function save() {
  form.forceDangerDialog = true
  localStorage.setItem(KEY, JSON.stringify({ ...form }))
  applyAnim()
}
function clearSkips() {
  Object.keys(localStorage).filter((k) => k.startsWith('wem-skip:')).forEach((k) => localStorage.removeItem(k))
  message.success('已清除不再提示')
}
function clearPos() {
  localStorage.removeItem('wem-dialog-pos')
  message.success('下次打开弹窗会回到默认位置')
}
</script>
