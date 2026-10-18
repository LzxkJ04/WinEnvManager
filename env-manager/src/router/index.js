import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/', redirect: '/overview' },
  { path: '/overview', name: 'overview', component: () => import('@/views/Overview.vue'), meta: { title: '环境变量总览', icon: 'DashboardOutlined' } },
  { path: '/user', name: 'user', component: () => import('@/views/UserVars.vue'), meta: { title: '用户变量管理', icon: 'UserOutlined' } },
  { path: '/system', name: 'system', component: () => import('@/views/SystemVars.vue'), meta: { title: '系统变量管理', icon: 'ClusterOutlined' } },
  { path: '/path', name: 'path', component: () => import('@/views/PathManager.vue'), meta: { title: 'PATH 路径专项管理', icon: 'NodeIndexOutlined' } },
  { path: '/devenv', name: 'devenv', component: () => import('@/views/DevEnv.vue'), meta: { title: '开发环境管理', icon: 'RocketOutlined' } },
  { path: '/registry', name: 'registry', component: () => import('@/views/Registry.vue'), meta: { title: '注册表管理', icon: 'ApartmentOutlined' } },
  { path: '/registry-backup', name: 'registry-backup', component: () => import('@/views/RegBackup.vue'), meta: { title: '注册表备份', icon: 'DatabaseOutlined' } },
  { path: '/health', name: 'health', component: () => import('@/views/Health.vue'), meta: { title: '环境健康诊断', icon: 'SafetyCertificateOutlined' } },
  { path: '/schedules', name: 'schedules', component: () => import('@/views/Schedules.vue'), meta: { title: '定时任务管理', icon: 'CalendarOutlined' } },
  { path: '/envsets', name: 'envsets', component: () => import('@/views/EnvSets.vue'), meta: { title: '环境配置集', icon: 'AppstoreOutlined' } },
  { path: '/projects', name: 'projects', component: () => import('@/views/Projects.vue'), meta: { title: '项目环境', icon: 'FolderOpenOutlined' } },
  { path: '/backup', name: 'backup', component: () => import('@/views/BackupRestore.vue'), meta: { title: '备份与还原', icon: 'DatabaseOutlined' } },
  { path: '/snapshot', name: 'snapshot', component: () => import('@/views/Snapshots.vue'), meta: { title: '变量快照 & 差异对比', icon: 'HistoryOutlined' } },
  { path: '/transfer', name: 'transfer', component: () => import('@/views/ImportExport.vue'), meta: { title: '批量导入导出', icon: 'SwapOutlined' } },
  { path: '/search', name: 'search', component: () => import('@/views/Search.vue'), meta: { title: '全局搜索', icon: 'SearchOutlined' } },
  { path: '/audit', name: 'audit', component: () => import('@/views/Audit.vue'), meta: { title: '变更审计面板', icon: 'FileSearchOutlined' } },
  { path: '/toolbox', name: 'toolbox', component: () => import('@/views/Toolbox.vue'), meta: { title: '快捷工具箱', icon: 'ToolOutlined' } },
  { path: '/settings', name: 'settings', component: () => import('@/views/Settings.vue'), meta: { title: '程序设置', icon: 'SettingOutlined' } },
  { path: '/about', name: 'about', component: () => import('@/views/About.vue'), meta: { title: '关于本工具', icon: 'InfoCircleOutlined' } }
]

export default createRouter({
  history: createWebHashHistory(),
  routes
})

export { routes }
