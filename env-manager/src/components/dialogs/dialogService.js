import { reactive } from 'vue'

export const dialogState = reactive({
  open: false,
  kind: 'info',
  title: '',
  content: '',
  detail: '',
  warning: '',
  hint: '',
  items: [],
  columns: [],
  rows: [],
  percent: 0,
  logs: '',
  maskClosable: true,
  checked: false,
  skipKey: ''
})

let resolver = null

function settle(value) {
  const done = resolver
  resolver = null
  dialogState.open = false
  dialogState.checked = false
  if (done) done(value)
}

function open(partial) {
  Object.assign(dialogState, {
    content: '',
    detail: '',
    warning: '',
    hint: '',
    items: [],
    columns: [],
    rows: [],
    percent: 0,
    logs: '',
    checked: false,
    maskClosable: true,
    skipKey: '',
    ...partial,
    open: true
  })
  return new Promise((resolve) => {
    resolver = resolve
  })
}

export function info(options = {}) {
  return open({
    kind: 'info',
    title: options.title || '提示',
    content: options.content || '',
    detail: options.detail || ''
  })
}

function popupSettings() {
  try {
    const data = JSON.parse(localStorage.getItem('wem-popup-settings') || '{}')
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

function confirmSkipKey(options) {
  if (options.skipKey === false) return ''
  const raw = options.skipKey || `${options.title || ''}\n${options.content || ''}`
  return `wem-skip:${raw}`
}

export function confirm(options = {}) {
  const allowSkip = popupSettings().allowSkipConfirm !== false
  const skipKey = allowSkip ? confirmSkipKey(options) : ''
  if (skipKey) {
    try {
      if (localStorage.getItem(skipKey) === '1') return Promise.resolve(true)
    } catch { /* 读不到就照常确认 */ }
  }
  return open({
    kind: 'confirm',
    title: options.title || '确认操作',
    content: options.content || '',
    items: options.items || [],
    skipKey
  })
}

export function danger(options = {}) {
  return open({
    kind: 'danger',
    title: options.title || '高危操作确认',
    warning: options.warning || '此操作会修改系统环境，错误配置可能导致程序无法运行。',
    columns: options.columns || [],
    rows: options.rows || [],
    hint: options.hint || '建议先创建快照，出问题可以回滚。',
    maskClosable: false
  })
}

export function preview(options = {}) {
  return open({
    kind: 'preview',
    title: options.title || '操作预览',
    content: options.content || '',
    columns: options.columns || [],
    rows: options.rows || []
  })
}

export function errorBox(options = {}) {
  return open({
    kind: 'error',
    title: options.title || '操作失败',
    content: options.message || '',
    detail: options.detail || ''
  })
}

export function askDiscard() {
  return confirm({ title: '放弃修改？', content: '表单还有未保存的修改。点确认会放弃这些修改。' })
}

export function progress(options = {}) {
  const pending = open({
    kind: 'progress',
    title: options.title || '任务执行中',
    content: options.text || '',
    maskClosable: false
  })
  return {
    promise: pending,
    update(percent, log) {
      dialogState.percent = Number(percent) || 0
      if (log) dialogState.logs += `${log}\n`
    },
    succeed(summary) {
      dialogState.kind = 'info'
      dialogState.title = '操作成功'
      dialogState.content = summary || '已完成'
      dialogState.maskClosable = true
    },
    fail(message) {
      dialogState.kind = 'error'
      dialogState.title = '操作失败'
      dialogState.content = message || '失败'
      dialogState.maskClosable = true
    },
    close() {
      settle(false)
    }
  }
}

export function acceptDialog() {
  if (dialogState.kind === 'danger' && !dialogState.checked) return
  if (dialogState.kind === 'confirm' && dialogState.checked && dialogState.skipKey) {
    try { localStorage.setItem(dialogState.skipKey, '1') } catch { /* 记不住就下次再问 */ }
  }
  settle(true)
}

export function cancelDialog() {
  settle(false)
}
