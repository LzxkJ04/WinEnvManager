<script setup>
import { TabsRoot, TabsList, TabsTrigger, TabsContent } from 'reka-ui'

defineProps({
  modelValue: { type: String, default: '' },
  tabs: { type: Array, default: () => [] } // [{ key, label }]
})
const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <TabsRoot :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)">
    <TabsList class="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
      <TabsTrigger
        v-for="t in tabs"
        :key="t.key"
        :value="t.key"
        class="rounded-md px-3 py-1 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm"
      >
        {{ t.label }}
      </TabsTrigger>
    </TabsList>
    <TabsContent
      v-for="t in tabs"
      :key="'c' + t.key"
      :value="t.key"
      class="mt-3 focus:outline-none"
    >
      <slot :name="t.key" />
    </TabsContent>
  </TabsRoot>
</template>
