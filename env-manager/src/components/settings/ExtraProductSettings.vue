<template>
  <div class="wem-card">
    <div class="wem-card-head"><div class="wem-card-title">搜索、引导与项目</div></div>
    <div class="wem-card-body">
      <a-collapse :bordered="false">
        <a-collapse-panel key="search" header="全局搜索">
          <div class="row"><span class="row-label">保存搜索历史</span><a-switch v-model:checked="search.saveHistory" @change="saveSearch" /></div>
          <div class="row"><span class="row-label">历史条数</span><a-input-number v-model:value="search.historyMax" :min="5" :max="50" size="small" @change="saveSearch" /></div>
          <div class="row"><span class="row-label">输入停顿毫秒</span><a-input-number v-model:value="search.searchDelay" :min="80" :max="1000" size="small" @change="saveSearch" /></div>
        </a-collapse-panel>
        <a-collapse-panel key="guide" header="启动与引导">
          <div class="row"><span class="row-label">启动打开总览</span><a-switch v-model:checked="startup.showDashboard" @change="saveStartup" /></div>
          <div class="row"><a-button size="small" @click="resetGuide">重置新手引导</a-button><span class="text-muted">下次进入主界面重新播放</span></div>
        </a-collapse-panel>
        <a-collapse-panel key="project" header="项目环境">
          <div class="row"><span class="row-label">默认继承全局变量</span><a-switch v-model:checked="project.inheritGlobal" @change="saveProject" /></div>
          <div class="row"><span class="row-label">启动前预览变量</span><a-switch v-model:checked="project.previewBeforeLaunch" @change="saveProject" /></div>
          <div class="row"><span class="row-label">检查文件夹是否存在</span><a-switch v-model:checked="project.watchFolder" @change="saveProject" /></div>
        </a-collapse-panel>
        <a-collapse-panel key="snap" header="快照与备份">
          <div class="row"><span class="row-label">快照压缩</span><a-switch v-model:checked="snap.compress" @change="saveSnap" /></div>
          <div class="row"><span class="row-label">最多保留</span><a-input-number v-model:value="snap.snapshotKeep" :min="5" :max="500" size="small" @change="saveSnap" /><span class="text-muted">条，受保护的不自动删</span></div>
          <div class="row"><span class="row-label">校验哈希</span><a-switch v-model:checked="snap.hashCheck" @change="saveSnap" /></div>
        </a-collapse-panel>
        <a-collapse-panel key="scan" header="开发工具识别">
          <div class="row"><span class="row-label">缓存小时</span><a-input-number v-model:value="scan.cacheHours" :min="1" :max="168" size="small" @change="saveScan" /></div>
          <div class="row"><span class="row-label">版本命令超时秒</span><a-input-number v-model:value="scan.timeoutSec" :min="1" :max="30" size="small" @change="saveScan" /></div>
          <div class="row"><span class="row-label">跳过网络盘</span><a-switch v-model:checked="scan.skipNetwork" @change="saveScan" /></div>
          <div class="row"><span class="row-label">跳过 U 盘</span><a-switch v-model:checked="scan.skipUsb" @change="saveScan" /></div>
        </a-collapse-panel>
      </a-collapse>
    </div>
  </div>
</template>

<script setup>
import { reactive, watch } from 'vue'
import { message } from 'ant-design-vue'
import api from '@/api'
import { useEnvStore } from '@/store/env'

const env = useEnvStore()
const search = reactive({ saveHistory: true, historyMax: 20, searchDelay: 200, auditSearch: false, ...read('wem-search-settings') })
const startup = reactive({ showDashboard: true, ...read('wem-startup-settings') })
const project = reactive({ inheritGlobal: true, previewBeforeLaunch: true, watchFolder: true, launchTimeoutSec: 15, ...read('wem-project-settings') })
const savedSnap = read('wem-snapshot-settings')
const snap = reactive({
  compress: env.config.snapshotCompress === true,
  snapshotKeep: Number(env.config.snapshotMax) > 0 ? Number(env.config.snapshotMax) : 50,
  hashCheck: savedSnap && Object.prototype.hasOwnProperty.call(savedSnap, 'hashCheck') ? savedSnap.hashCheck !== false : true
})
watch(() => env.config.snapshotCompress, (v) => { snap.compress = v === true })
watch(() => env.config.snapshotMax, (v) => {
  const n = Number(v)
  if (Number.isFinite(n) && n >= 5 && n <= 500) snap.snapshotKeep = n
})
const scan = reactive({ cacheHours: 24, timeoutSec: 5, skipNetwork: true, skipUsb: false, ...read('wem-scan-settings') })

function read(key) {
  try { return JSON.parse(localStorage.getItem(key) || '{}') } catch (_) { return {} }
}
function write(key, form) {
  localStorage.setItem(key, JSON.stringify({ ...form }))
}
function saveSearch() { write('wem-search-settings', search) }
function saveStartup() { write('wem-startup-settings', startup) }
function saveProject() { write('wem-project-settings', project) }
async function saveSnap() {
  const prev = read('wem-snapshot-settings')
  write('wem-snapshot-settings', { ...(prev && typeof prev === 'object' ? prev : {}), hashCheck: snap.hashCheck === true })
  const keep = Math.min(500, Math.max(5, Number(snap.snapshotKeep) || 50))
  const res = await api.config.set({ snapshotCompress: snap.compress === true, snapshotMax: keep })
  if (res && res.ok) {
    env.config.snapshotCompress = snap.compress === true
    env.config.snapshotMax = keep
  } else if (res && res.message) {
    message.error(res.message)
  }
}
function saveScan() { write('wem-scan-settings', scan) }
function resetGuide() {
  localStorage.removeItem('wem-guide-done')
  message.success('已重置新手引导，下次进入主界面会重新播放')
}
</script>
