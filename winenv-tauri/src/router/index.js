import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/', redirect: '/overview' },
  { path: '/overview', name: 'overview', component: () => import('@/views/Overview.vue'), meta: { title: '环境变量总览', desc: '用户变量与系统变量统一视图' } },
  { path: '/user', name: 'user', component: () => import('@/views/Variables.vue'), meta: { title: '用户变量管理', desc: '仅影响当前用户的环境变量' } },
  { path: '/system', name: 'system', component: () => import('@/views/Variables.vue'), meta: { title: '系统变量管理', desc: '对所有用户生效，需管理员权限写入' } },
  { path: '/path', name: 'path', component: () => import('@/views/PathManager.vue'), meta: { title: 'PATH 路径专项管理', desc: '拆分、排序、去重与有效性校验' } },
  { path: '/devenv', name: 'devenv', component: () => import('@/views/DevEnv.vue'), meta: { title: '开发环境管理', desc: '环境市场 / 已安装管理 / 任务队列 / 环境审计' } },
  { path: '/envsets', name: 'envsets', component: () => import('@/views/EnvSets.vue'), meta: { title: '环境配置集', desc: '多套环境一键切换，支持互斥组' } },
  { path: '/backup', name: 'backup', component: () => import('@/views/BackupRestore.vue'), meta: { title: '备份与还原', desc: '导出 / 导入 / 自动备份管理' } },
  { path: '/snapshot', name: 'snapshot', component: () => import('@/views/Snapshots.vue'), meta: { title: '变量快照 & 差异对比', desc: '创建快照并对比环境差异' } },
  { path: '/transfer', name: 'transfer', component: () => import('@/views/ImportExport.vue'), meta: { title: '批量导入导出', desc: '批量导出与导入变量清单' } },
  { path: '/toolbox', name: 'toolbox', component: () => import('@/views/Toolbox.vue'), meta: { title: '快捷工具箱', desc: '重启资源管理器、权限检测等实用功能' } },
  { path: '/settings', name: 'settings', component: () => import('@/views/Settings.vue'), meta: { title: '程序设置', desc: '主题、草稿、开发环境、安全等选项' } },
  { path: '/about', name: 'about', component: () => import('@/views/About.vue'), meta: { title: '关于本工具', desc: '版本信息与开源声明' } }
]

export default createRouter({ history: createWebHashHistory(), routes })
export { routes }
