<script setup>
import { ProgressRoot, ProgressIndicator } from 'reka-ui'
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps({
  value: { type: Number, default: 0 },
  class: { type: String, default: '' }
})
const cls = computed(() => cn('relative h-1.5 w-full overflow-hidden rounded-full bg-secondary', props.class))
</script>

<template>
  <ProgressRoot :model-value="value" :class="cls">
    <ProgressIndicator
      class="h-full bg-primary transition-all duration-200"
      :style="{ transform: `translateX(-${100 - (value || 0)}%)` }"
    />
  </ProgressRoot>
</template>
