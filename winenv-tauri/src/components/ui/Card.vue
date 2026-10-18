<script setup>
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps({ class: { type: String, default: '' } })
const cls = computed(() => cn('rounded-lg border border-border bg-card text-card-foreground shadow-sm', props.class))
</script>

<template>
  <div :class="cls">
    <slot />
  </div>
</template>
