<script setup>
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps({
  class: { type: String, default: '' },
  variant: { type: String, default: 'default' }, // default | secondary | outline | success | warning | destructive | info
  tone: { type: String, default: '' }
})
const map = {
  default: 'bg-primary/15 text-primary',
  secondary: 'bg-secondary text-secondary-foreground',
  outline: 'border border-border text-foreground',
  success: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  warning: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  destructive: 'bg-red-500/15 text-red-600 dark:text-red-400',
  info: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  purple: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
  cyan: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400',
  pink: 'bg-pink-500/15 text-pink-600 dark:text-pink-400',
  gold: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',
  volcano: 'bg-orange-600/15 text-orange-600 dark:text-orange-400'
}
const cls = computed(() =>
  cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap', map[props.tone || props.variant] || map.default, props.class)
)
</script>

<template>
  <span :class="cls"><slot /></span>
</template>
