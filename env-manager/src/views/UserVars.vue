<template>
  <div>
    <div class="hint-box" style="margin-bottom: 14px">
      <InfoCircleOutlined />
      <div>
        用户变量存储在 <span class="mono">HKCU\Environment</span>，仅对当前登录用户生效，普通权限即可读写。
        这里的修改只保存在内存中，点击右上角「保存写入系统」后才会真正生效。
      </div>
    </div>
    <VariableTable :scopes="['user']" title="用户变量列表" />
  </div>
</template>

<script setup>
import { InfoCircleOutlined } from '@ant-design/icons-vue'
import VariableTable from '@/components/VariableTable.vue'
</script>
