/**
 * 全局 UI 状态：主题 / 状态栏提示 / 全局加载
 */
import { defineStore } from 'pinia'
import api from '@/api'

export const useUiStore = defineStore('ui', {
  state: () => ({
    theme: 'light',          // light | dark | system
    systemDark: false,
    sidebarCollapsed: false,
    statusTip: '就绪',
    statusTipType: 'info',   // info | success | warning | error
    lastAction: '',
    loading: false,
    demo: !!api.platform && !window.envAPI
  }),

  getters: {
    isDark(state) {
      if (state.theme === 'system') return state.systemDark
      return state.theme === 'dark'
    }
  },

  actions: {
    setTheme(theme) {
      this.theme = theme
      api.config.set({ theme })
    },
    async loadTheme() {
      try {
        const res = await api.config.get()
        if (res.ok && res.data?.config) {
          this.theme = res.data.config.theme || 'light'
          return res.data
        }
      } catch (_) { /* ignore */ }
      return null
    },
    toggleSystem(dark) {
      this.systemDark = dark
    },
    tip(text, type = 'info') {
      this.statusTip = text
      this.statusTipType = type
    },
    setLoading(v) {
      this.loading = v
    }
  }
})
