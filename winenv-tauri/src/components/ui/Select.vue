<script setup>
import { SelectRoot, SelectTrigger, SelectValue, SelectPortal, SelectContent, SelectViewport, SelectItem, SelectItemText, SelectItemIndicator } from 'reka-ui'
import { Check, ChevronDown } from 'lucide-vue-next'

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  options: { type: Array, default: () => [] }, // [{ label, value }]
  placeholder: { type: String, default: '请选择' },
  disabled: Boolean,
  clearable: Boolean,
  class: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <SelectRoot
    :model-value="modelValue"
    :disabled="disabled"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <SelectTrigger
      :class="`inline-flex h-8 ${props.class || 'w-44'} items-center justify-between gap-1 rounded-md border border-input bg-card px-2.5 py-1 text-[12.5px] shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50`"
    >
      <SelectValue :placeholder="placeholder" class="truncate" />
      <ChevronDown :size="14" class="text-muted-foreground" />
    </SelectTrigger>
    <SelectPortal>
      <SelectContent position="popper" class="z-50 max-h-72 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl">
        <SelectViewport class="p-1">
          <SelectItem
            v-for="o in options"
            :key="o.value"
            :value="o.value"
            class="relative flex cursor-pointer select-none items-center rounded-md py-1.5 pl-7 pr-2 text-[12.5px] outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
          >
            <SelectItemText>{{ o.label }}</SelectItemText>
            <SelectItemIndicator class="absolute left-2 inline-flex">
              <Check :size="13" />
            </SelectItemIndicator>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
