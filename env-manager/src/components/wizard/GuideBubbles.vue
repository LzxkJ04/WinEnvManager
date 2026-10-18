<template>
  <div v-if="open" class="guide-layer">
    <div class="guide-bubble" :class="{ danger: step === 5 }" :style="posStyle">
      <div class="wem-card">
        <div class="wem-card-head">
          <div class="wem-card-title">{{ step + 1 }} / {{ steps.length }} · {{ current.title }}</div>
        </div>
        <div class="wem-card-body">
          <p class="guide-text">{{ current.text }}</p>
          <div class="toolbar">
            <a-button @click="skipAll">跳过全部</a-button>
            <a-button type="primary" @click="next">{{ step === steps.length - 1 ? '完成' : '下一步' }}</a-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false }
})

const emit = defineEmits(['done', 'update:open'])

const steps = [
  {
    title: '全局搜索',
    text: '顶栏搜索可以找变量名、配置集、快照、开发工具和日志。点一条结果即可跳过去，不用记快捷键。',
    style: { top: '68px', right: '24px' }
  },
  {
    title: '环境变量',
    text: '左侧「用户变量」「系统变量」是日常修改的地方。改动先留在草稿，确认保存后才会写入系统。',
    style: { top: '148px', left: '248px' }
  },
  {
    title: '快照',
    text: '「变量快照 & 差异对比」用来在改动前留底，也可以和当前环境逐项对比。标成受保护的快照不会被自动清掉。',
    style: { top: '360px', left: '248px' }
  },
  {
    title: '配置集',
    text: '「环境配置集」保存开发、测试等整套变量。加载后仍在草稿里，不会马上改注册表。',
    style: { top: '268px', left: '248px' }
  },
  {
    title: '开发工具',
    text: '「开发环境管理」可以扫描本机已安装的运行时，并按规则给出变量建议。部署前先看计划，再决定要不要写入。',
    style: { top: '228px', left: '248px' }
  },
  {
    title: '高危操作提醒',
    text: '写系统变量、清空 PATH、还原快照、重启资源管理器都要再确认一次。拿不准时先做快照。这些操作不会在引导里执行。',
    style: { bottom: '56px', left: '50%', transform: 'translateX(-50%)' }
  }
]

const step = ref(0)
const current = computed(() => steps[step.value] || steps[0])
const posStyle = computed(() => current.value.style)

watch(() => props.open, (v) => { if (v) step.value = 0 })

function finish(skipped) {
  try { localStorage.setItem('wem-guide-done', '1') } catch (_) { /* 隐私模式无法写入时仍结束引导 */ }
  emit('done', { skipped: !!skipped, step: step.value })
  emit('update:open', false)
}

function next() {
  if (step.value >= steps.length - 1) finish(false)
  else step.value += 1
}

function skipAll() {
  finish(true)
}
</script>

<style scoped>
.guide-layer {
  position: fixed;
  inset: 0;
  z-index: 3000;
  background: rgba(15, 23, 42, 0.28);
}
.guide-bubble {
  position: fixed;
  z-index: 3001;
  width: 340px;
  max-width: calc(100vw - 32px);
  filter: drop-shadow(0 8px 24px rgba(22, 93, 255, 0.18));
}
.guide-bubble .wem-card {
  border-color: #165DFF;
}
.guide-bubble.danger .wem-card {
  border-color: var(--wem-danger);
}
.guide-text {
  margin: 0 0 12px;
  line-height: 1.7;
  color: var(--wem-text);
}
</style>
