<script setup>
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps({
  variant: { type: String, default: 'default' }, // default | secondary | outline | ghost | destructive | link
  size: { type: String, default: 'default' },    // default | sm | lg | icon
  class: { type: String, default: '' },
  disabled: Boolean,
  type: { type: String, default: 'button' }
})

const variants = {
  default: 'bg-primary text-primary-foreground shadow-sm hover:opacity-90',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  outline: 'border border-border bg-card hover:bg-accent hover:text-accent-foreground',
  ghost: 'hover:bg-accent hover:text-accent-foreground',
  destructive: 'bg-destructive text-destructive-foreground hover:opacity-90',
  link: 'text-primary underline-offset-4 hover:underline'
}
const sizes = {
  default: 'h-8 px-3 py-1.5 text-[12.5px]',
  sm: 'h-7 rounded-md px-2.5 text-[12px]',
  lg: 'h-10 rounded-md px-6 text-sm',
  icon: 'h-8 w-8'
}
const cls = computed(() =>
  cn(
    'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 cursor-pointer select-none',
    variants[props.variant] || variants.default,
    sizes[props.size] || sizes.default,
    props.class
  )
)
</script>

<template>
  <button :type="type" :class="cls" :disabled="disabled">
    <slot />
  </button>
</template>
