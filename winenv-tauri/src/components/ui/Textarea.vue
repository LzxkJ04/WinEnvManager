<script setup>
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps({
  class: { type: String, default: '' },
  modelValue: { type: String, default: '' },
  rows: { type: Number, default: 3 },
  placeholder: { type: String, default: '' },
  disabled: Boolean
})
const emit = defineEmits(['update:modelValue'])
const cls = computed(() =>
  cn(
    'flex w-full rounded-md border border-input bg-card px-2.5 py-1.5 text-[12.5px] shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
    props.class
  )
)
</script>

<template>
  <textarea
    :class="cls"
    :rows="rows"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    @input="emit('update:modelValue', $event.target.value)"
  />
</template>
