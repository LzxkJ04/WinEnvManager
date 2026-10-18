<script setup>
import { SwitchRoot, SwitchThumb } from 'reka-ui'
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  disabled: Boolean,
  class: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue'])
const rootCls = computed(() =>
  cn('peer inline-flex h-4.5 w-8 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-50', props.modelValue ? 'bg-primary' : 'bg-input', props.class)
)
</script>

<template>
  <SwitchRoot
    :model-value="modelValue"
    :disabled="disabled"
    :class="rootCls"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <SwitchThumb
      :class="cn('pointer-events-none block h-3.5 w-3.5 rounded-full bg-white shadow-sm ring-0 transition-transform', modelValue ? 'translate-x-4' : 'translate-x-0.5')"
    />
  </SwitchRoot>
</template>
