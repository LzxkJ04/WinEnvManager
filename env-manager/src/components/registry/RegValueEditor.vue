<template>
  <a-modal
    v-model:open="open"
    :title="mode === 'create' ? '新建键值' : '编辑键值'"
    width="640px"
    ok-text="写入注册表"
    cancel-text="取消"
    :confirm-loading="submitting"
    :mask-closable="false"
    @ok="submit"
  >
    <div class="hint-box" style="margin-bottom: 10px">
      <InfoCircleOutlined />
      <div>
        <span class="mono">{{ path }}</span>
        <div v-if="readonly" style="margin-top: 4px">
          当前分支需要管理员权限才能修改，写入会被系统拒绝。
        </div>
      </div>
    </div>

    <a-form layout="vertical">
      <a-form-item label="值类型">
        <a-select v-model:value="form.type" size="small" @change="onTypeChange">
          <a-select-option v-for="t in typeOptions" :key="t" :value="t">
            {{ t }}<span class="type-hint">{{ typeHint(t) }}</span>
          </a-select-option>
        </a-select>
        <div v-if="form.type === 'REG_EXPAND_SZ'" class="field-hint">
          REG_EXPAND_SZ 会保留 <span class="mono">%VAR%</span> 引用原样写入，不会被展开成实际路径。
        </div>
      </a-form-item>

      <a-form-item label="值名称">
        <a-input
          v-model:value="form.name"
          size="small"
          placeholder="留空表示写入 (默认) 键值"
          :maxlength="255"
        />
        <div class="field-hint">
          <template v-if="mode === 'edit'">
            修改名称时，会先写入新名称的键值，再删除旧名称，避免中途失败丢失数据。
          </template>
          <template v-else>名称不能包含反斜杠 \，最长 255 个字符。</template>
        </div>
      </a-form-item>

      <!-- 字符串 -->
      <a-form-item v-if="isString" label="数据">
        <a-textarea
          v-model:value="form.text"
          :rows="form.type === 'REG_MULTI_SZ' ? 6 : 4"
          class="mono"
          :placeholder="form.type === 'REG_MULTI_SZ' ? '一行一条，空行会被忽略' : '%SystemRoot%\\system32'"
        />
        <div v-if="form.type === 'REG_MULTI_SZ'" class="field-hint">
          多行字符串：每行一条，写入时按 REG_MULTI_SZ 数组保存。
        </div>
      </a-form-item>

      <!-- 数值 -->
      <a-form-item v-else-if="isNumber" label="数据">
        <div class="toolbar">
          <a-input
            v-model:value="form.number"
            size="small"
            class="mono"
            style="width: 240px"
            :placeholder="form.hex ? '十六进制，如 1F4' : '十进制整数'"
          />
          <a-radio-group v-model:value="form.hex" size="small" button-style="solid">
            <a-radio-button :value="false">十进制</a-radio-button>
            <a-radio-button :value="true">十六进制</a-radio-button>
          </a-radio-group>
          <span class="text-muted" v-if="numberPreview">{{ numberPreview }}</span>
        </div>
        <div class="field-hint">
          {{ form.type === 'REG_DWORD' ? '取值范围 0 ~ 4294967295（32 位）' : '取值范围 0 ~ 18446744073709551615（64 位）' }}
        </div>
      </a-form-item>

      <!-- 二进制 -->
      <a-form-item v-else label="数据（十六进制）">
        <a-textarea
          v-model:value="form.text"
          :rows="5"
          class="mono"
          placeholder="DEADBEEF0102 或 DE AD BE EF，空格与逗号会被忽略"
        />
        <div class="field-hint" :class="{ 'is-error': hexError }">
          {{ hexError || `共 ${hexBytes} 字节，长度必须是偶数` }}
        </div>
      </a-form-item>
    </a-form>

    <div v-if="hexError || numberError" class="hint-box danger" style="margin-top: 4px">
      <WarningOutlined />
      <div>{{ hexError || numberError }}</div>
    </div>
  </a-modal>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { message } from 'ant-design-vue'
import { InfoCircleOutlined, WarningOutlined } from '@ant-design/icons-vue'

const props = defineProps({
  readonly: { type: Boolean, default: false }
})

const emit = defineEmits(['submit'])

const open = ref(false)
const mode = ref('create')
const submitting = ref(false)
const path = ref('')
const editingRow = ref(null)

const form = reactive({
  type: 'REG_EXPAND_SZ',
  name: '',
  text: '',
  number: '',
  hex: false
})

const TYPE_OPTIONS = [
  'REG_SZ', 'REG_EXPAND_SZ', 'REG_MULTI_SZ', 'REG_DWORD', 'REG_QWORD', 'REG_BINARY'
]
const typeOptions = computed(() => (mode.value === 'edit' ? [...new Set([form.type, ...TYPE_OPTIONS])] : TYPE_OPTIONS))

const isString = computed(() => form.type === 'REG_SZ' || form.type === 'REG_EXPAND_SZ' || form.type === 'REG_MULTI_SZ')
const isNumber = computed(() => form.type === 'REG_DWORD' || form.type === 'REG_QWORD')

const hexBytes = computed(() => {
  const clean = String(form.text || '').replace(/[\s,]/g, '')
  return Math.floor(clean.length / 2)
})

const hexError = computed(() => {
  if (form.type !== 'REG_BINARY') return ''
  const clean = String(form.text || '').replace(/[\s,]/g, '')
  if (!clean) return ''
  if (!/^[0-9a-fA-F]+$/.test(clean)) return '只能包含 0-9 / A-F 的十六进制字符'
  if (clean.length % 2 !== 0) return '十六进制长度必须是偶数（每字节两位）'
  return ''
})

const numberPreview = computed(() => {
  if (!isNumber.value) return ''
  const raw = String(form.number || '').trim()
  if (!raw) return ''
  const n = parseRawNumber(raw)
  if (n == null) return '无法解析为数字'
  return `= ${n.toLocaleString('en-US')}（0x${n.toString(16).toUpperCase()}）`
})

const numberError = computed(() => {
  if (!isNumber.value) return ''
  const raw = String(form.number || '').trim()
  if (!raw) return '请输入数值'
  const n = parseRawNumber(raw)
  if (n == null) return form.hex ? '十六进制格式不正确' : '请输入十进制整数'
  if (n < 0) return '数值不能为负数'
  if (form.type === 'REG_DWORD' && n > 4294967295) return 'REG_DWORD 取值不能超过 4294967295'
  if (form.type === 'REG_QWORD' && n > 18446744073709551615) return 'REG_QWORD 取值超出范围'
  return ''
})

function typeHint(t) {
  if (t === 'REG_SZ') return '（普通字符串）'
  if (t === 'REG_EXPAND_SZ') return '（可展开字符串，环境变量常用）'
  if (t === 'REG_MULTI_SZ') return '（多行字符串）'
  if (t === 'REG_DWORD') return '（32 位整数）'
  if (t === 'REG_QWORD') return '（64 位整数）'
  if (t === 'REG_BINARY') return '（二进制）'
  return ''
}

function parseRawNumber(raw) {
  const text = String(raw || '').trim()
  if (!text) return null
  if (form.hex || /^0x/i.test(text)) {
    const hex = text.replace(/^0x/i, '')
    if (!/^[0-9a-fA-F]+$/.test(hex)) return null
    return Number.parseInt(hex, 16)
  }
  if (!/^\d+$/.test(text)) return null
  return Number(text)
}

let lastType = 'REG_EXPAND_SZ'

/** a-select 的 change 第二个参数是 option 对象，因此自己维护上一个类型 */
function onTypeChange(next) {
  const prev = lastType
  lastType = next
  if (next === prev) return
  // 类型切换时把已有内容尽量带过去，避免用户重填
  if ((next === 'REG_DWORD' || next === 'REG_QWORD') && form.number === '') {
    if (prev === 'REG_SZ' || prev === 'REG_EXPAND_SZ') form.number = String(form.text || '').replace(/[^\d]/g, '') || ''
  }
  if ((next === 'REG_SZ' || next === 'REG_EXPAND_SZ' || next === 'REG_MULTI_SZ' || next === 'REG_BINARY') && form.text === '') {
    if (prev === 'REG_DWORD' || prev === 'REG_QWORD') form.text = String(form.number || '')
    if (prev === 'REG_BINARY') form.text = ''
  }
  form.hex = false
}

function reset() {
  form.type = 'REG_EXPAND_SZ'
  lastType = 'REG_EXPAND_SZ'
  form.name = ''
  form.text = ''
  form.number = ''
  form.hex = false
}

function openCreate(targetPath, presetName) {
  mode.value = 'create'
  path.value = targetPath
  editingRow.value = null
  reset()
  form.name = presetName || ''
  open.value = true
}

function openEdit(targetPath, row) {
  mode.value = 'edit'
  path.value = targetPath
  editingRow.value = row
  reset()
  form.type = row.type || 'REG_SZ'
  lastType = form.type
  form.name = row.name || ''
  if (form.type === 'REG_DWORD' || form.type === 'REG_QWORD') {
    const raw = String(row.value || '').trim()
    const n = /^\d+$/.test(raw) ? Number(raw) : null
    if (n == null) {
      form.hex = true
      form.number = raw.replace(/^0x/i, '')
    } else {
      form.number = String(n)
    }
  } else if (form.type === 'REG_BINARY') {
    form.text = row.binary || row.value || ''
  } else {
    form.text = row.value || ''
  }
  open.value = true
}

function submit() {
  if (props.readonly) {
    message.error('当前分支需要管理员权限才能修改')
    return
  }
  const nameInput = String(form.name || '')
  if (nameInput.trim() !== '') {
    if (nameInput.length > 255) { message.error('名称不能超过 255 个字符'); return }
    if (nameInput.includes('\\')) { message.error('名称不能包含反斜杠 \\'); return }
    if (/[\u0000-\u001f]/.test(nameInput)) { message.error('名称不能包含控制字符'); return }
  }
  let value = ''
  if (isString.value) {
    value = form.type === 'REG_MULTI_SZ'
      ? String(form.text || '').split(/\r?\n/).filter((line) => line !== '').join('\n')
      : String(form.text || '')
  } else if (isNumber.value) {
    if (numberError.value) { message.error(numberError.value); return }
    value = String(parseRawNumber(form.number))
  } else {
    if (hexError.value) { message.error(hexError.value); return }
    value = String(form.text || '').replace(/[\s,]/g, '').toUpperCase()
  }

  emit('submit', {
    mode: mode.value,
    path: path.value,
    oldName: editingRow.value ? editingRow.value.name : undefined,
    name: nameInput,
    type: form.type,
    value
  })
}

function setSubmitting(v) {
  submitting.value = v
}

function close() {
  open.value = false
}

defineExpose({ openCreate, openEdit, setSubmitting, close })
</script>

<style scoped>
.type-hint {
  color: var(--wem-text-3);
  font-size: 11px;
  margin-left: 4px;
}

.field-hint {
  font-size: 11.5px;
  color: var(--wem-text-3);
  margin-top: 4px;
  line-height: 1.5;
}

.field-hint.is-error {
  color: var(--wem-danger);
}
</style>
