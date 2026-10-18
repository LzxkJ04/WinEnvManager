<script setup>
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps({
  class: { type: String, default: '' },
  modelValue: { type: [String, Number], default: '' },
  type: { type: String, default: 'text' },
  placeholder: { type: String, default: '' },
  disabled: Boolean,
  readonly: Boolean
})
const emit = defineEmits(['update:modelValue', 'change', 'keydown'])
const cls = computed(() =>
  cn(
    'flex h-8 w-full rounded-md border border-input bg-card px-2.5 py-1 text-[12.5px] shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
    props.class
  )
)
</script>

<template>
  <input
    :type="type"
    :class="cls"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :readonly="readonly"
    @input="emit('update:modelValue', $event.target.value)"
    @change="emit('change', $event)"
    @keydown="emit('keydown', $event)"
  />
</template>
