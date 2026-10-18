<script setup>
import { CheckboxRoot, CheckboxIndicator } from 'reka-ui'
import { Check } from 'lucide-vue-next'
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  disabled: Boolean,
  label: { type: String, default: '' },
  class: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue'])
const cls = computed(() =>
  cn('peer h-3.5 w-3.5 shrink-0 rounded border border-input bg-card shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:border-primary', props.class)
)
</script>

<template>
  <label class="inline-flex cursor-pointer select-none items-center gap-1.5 text-[12.5px]" :class="disabled ? 'opacity-50' : ''">
    <CheckboxRoot
      :model-value="modelValue"
      :disabled="disabled"
      :class="cls"
      @update:model-value="emit('update:modelValue', $event)"
    >
      <CheckboxIndicator class="flex items-center justify-center">
        <Check :size="12" stroke-width="3" />
      </CheckboxIndicator>
    </CheckboxRoot>
    <span v-if="label || $slots.default"><slot>{{ label }}</slot></span>
  </label>
</template>
