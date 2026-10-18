<template>
  <div>
    <div v-if="!env.admin" class="hint-box warn" style="margin-bottom: 14px">
      <LockOutlined />
      <div style="display: flex; align-items: center; gap: 12px; flex: 1">
        <div style="flex: 1">
          当前为<b>普通用户权限</b>，可以查看系统变量，但<b>无法写入或删除</b>。
          系统变量存放在 <span class="mono">HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment</span>。
        </div>
        <a-button type="primary" size="small" @click="elevate">
          <template #icon><RocketOutlined /></template>
          以管理员身份重启
        </a-button>
      </div>
    </div>
    <div v-else class="hint-box" style="margin-bottom: 14px">
      <SafetyCertificateOutlined />
      <div>
        当前为<b>管理员权限</b>，系统变量可自由读写。修改系统变量会影响本机所有用户，
        写入后建议重启资源管理器让新变量立即生效。
      </div>
    </div>
    <VariableTable :scopes="['machine']" title="系统变量列表" />
  </div>
</template>

<script setup>
import { Modal, message } from 'ant-design-vue'
import { LockOutlined, RocketOutlined, SafetyCertificateOutlined } from '@ant-design/icons-vue'
import VariableTable from '@/components/VariableTable.vue'
import { useEnvStore } from '@/store/env'
import api from '@/api'

const env = useEnvStore()

function elevate() {
  Modal.confirm({
    title: '以管理员身份重新启动？',
    content: '将弹出 UAC 授权窗口。确认后以管理员权限启动新窗口，当前窗口会自动关闭。',
    okText: '提权重启',
    cancelText: '取消',
    onOk: async () => {
      const res = await api.tool.elevate()
      if (!res.ok) message.error(res.message)
    }
  })
}
</script>
