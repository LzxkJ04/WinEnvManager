<template>
  <a-modal
    :open="open"
    title="开始使用 WinEnv管家"
    :width="720"
    :mask-closable="false"
    :keyboard="false"
    :destroy-on-close="false"
    @update:open="onOpen"
  >
    <a-steps :current="step" size="small" class="wiz-steps">
      <a-step v-for="t in titles" :key="t" :title="t" />
    </a-steps>

    <div class="wiz-body">
      <template v-if="step === 0">
        <p>WinEnv管家用来查看和整理 Windows 环境变量。改动先进入草稿，你确认之后才写入系统。</p>
        <p>项目终端里的变量只对那一次窗口生效，不会改注册表。</p>
        <a-checkbox v-model:checked="form.agreed">我已了解：写入系统前需要确认，未确认的内容不会进注册表。</a-checkbox>
        <div v-if="!form.agreed" class="text-muted" style="margin-top: 8px">勾选后才能进入下一步。</div>
      </template>

      <template v-else-if="step === 1">
        <p>选择界面主题。可随时在顶栏或设置里再改。</p>
        <a-radio-group v-model:value="form.theme" @change="onThemeChange">
          <a-radio-button value="light">浅色</a-radio-button>
          <a-radio-button value="dark">深色</a-radio-button>
          <a-radio-button value="system">跟随系统</a-radio-button>
        </a-radio-group>
        <p class="text-muted" style="margin-top: 10px">
          <template v-if="form.themeApplied">主题已切换。</template>
          <template v-else>当前调用不了主题设置，选择会在完成时交给外层，不会假装已经写进配置。</template>
        </p>
      </template>

      <template v-else-if="step === 2">
        <p>配置、快照和日志放在用户数据目录。安装版用安装时登记的目录，便携版放在程序旁边的 UserData。</p>
        <p>这些文件只属于本工具，不会写进 Windows 目录，也不会改环境变量注册表。</p>
      </template>

      <template v-else-if="step === 3">
        <p>读取当前用户的变量不需要管理员。</p>
        <p>写入「所有用户」的系统变量才需要管理员。权限不够时会提示你，不会悄悄失败，也不会改已经拒绝的项。</p>
      </template>

      <template v-else-if="step === 4">
        <p>快照是改动前的副本。下面只是你的偏好，完成向导本身不会立刻创建快照。</p>
        <div class="wiz-checks">
          <a-checkbox v-model:checked="form.snapshot.onStart">启动程序时自动做一份快照</a-checkbox>
          <a-checkbox v-model:checked="form.snapshot.beforeWrite">写入系统前自动做一份快照</a-checkbox>
          <a-checkbox v-model:checked="form.snapshot.keepRecent">只保留最近的自动快照，受保护的不删</a-checkbox>
        </div>
      </template>

      <template v-else-if="step === 5">
        <p>扫描用来发现本机已经装好的开发工具。可以现在先勾选，稍后再到开发环境里手动扫。</p>
        <div class="wiz-checks">
          <a-checkbox v-model:checked="form.scan.installedTools">扫描本机已安装的开发工具</a-checkbox>
          <a-checkbox v-model:checked="form.scan.brokenPath">检查 PATH 里失效的路径</a-checkbox>
          <a-checkbox v-model:checked="form.scan.skipNetwork">跳过网络盘和可移动盘，避免卡住</a-checkbox>
        </div>
      </template>

      <template v-else>
        <p>可以开始了。这些选择会交给程序保存，本向导不会改注册表。</p>
        <div class="kv-list">
          <div class="kv-key">主题</div>
          <div class="kv-val">{{ themeText }}<template v-if="!form.themeApplied">（尚未写入设置）</template></div>
          <div class="kv-key">快照</div>
          <div class="kv-val">{{ snapshotText }}</div>
          <div class="kv-key">扫描</div>
          <div class="kv-val">{{ scanText }}</div>
        </div>
      </template>
    </div>

    <template #footer>
      <div class="wiz-foot">
        <a-button @click="onSkip">跳过</a-button>
        <div class="toolbar">
          <a-button :disabled="step === 0" @click="step -= 1">上一步</a-button>
          <a-button v-if="step < 6" type="primary" :disabled="step === 0 && !form.agreed" @click="next">下一步</a-button>
          <a-button v-else type="primary" :disabled="!form.agreed" @click="finish">完成</a-button>
        </div>
      </div>
    </template>
  </a-modal>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false }
})

const emit = defineEmits(['finish', 'skip', 'update:open'])

const titles = ['欢迎', '主题', '数据目录', '权限', '快照', '扫描', '完成']
const step = ref(0)
const form = reactive(blank())

const themeText = computed(() => ({ light: '浅色', dark: '深色', system: '跟随系统' }[form.theme] || '浅色'))
const snapshotText = computed(() => {
  const on = []
  if (form.snapshot.onStart) on.push('启动时')
  if (form.snapshot.beforeWrite) on.push('写入前')
  if (form.snapshot.keepRecent) on.push('自动清理')
  return on.length ? on.join('、') : '不自动快照'
})
const scanText = computed(() => {
  const on = []
  if (form.scan.installedTools) on.push('已安装工具')
  if (form.scan.brokenPath) on.push('失效路径')
  if (form.scan.skipNetwork) on.push('跳过网络盘')
  return on.length ? on.join('、') : '暂不扫描'
})

function blank() {
  return {
    agreed: false,
    theme: 'light',
    themeApplied: false,
    snapshot: { onStart: true, beforeWrite: true, keepRecent: true },
    scan: { installedTools: true, brokenPath: true, skipNetwork: true }
  }
}

function reset() {
  step.value = 0
  Object.assign(form, blank(), {
    snapshot: { onStart: true, beforeWrite: true, keepRecent: true },
    scan: { installedTools: true, brokenPath: true, skipNetwork: true }
  })
}

watch(() => props.open, (v) => { if (v) reset() })

function onOpen(v) {
  emit('update:open', v)
}

async function applyTheme(theme) {
  try {
    const mod = await import('@/store/ui')
    const ui = mod.useUiStore()
    if (ui && typeof ui.setTheme === 'function') {
      ui.setTheme(theme)
      return true
    }
  } catch (_) { /* 没有可用的 store 时只把选择放进 finish */ }
  return false
}

async function onThemeChange(e) {
  const value = (e && e.target && e.target.value) || form.theme
  form.theme = value
  form.themeApplied = await applyTheme(value)
}

function next() {
  if (step.value === 0 && !form.agreed) return
  if (step.value < 6) step.value += 1
}

async function finish() {
  if (!form.agreed) return
  form.themeApplied = await applyTheme(form.theme)
  emit('finish', {
    agreed: true,
    theme: form.theme,
    themeApplied: form.themeApplied,
    snapshot: { ...form.snapshot },
    scan: { ...form.scan }
  })
  emit('update:open', false)
}

function onSkip() {
  emit('skip')
  emit('update:open', false)
}
</script>

<style scoped>
.wiz-steps {
  margin-bottom: 16px;
}
.wiz-body {
  min-height: 168px;
  color: var(--wem-text);
  line-height: 1.7;
}
.wiz-body p {
  margin: 0 0 8px;
}
.wiz-checks {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.wiz-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
</style>
