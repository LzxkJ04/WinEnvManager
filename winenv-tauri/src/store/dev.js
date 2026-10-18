/**
 * 开发环境管理 & 环境配置集 状态仓库
 */
import { defineStore } from 'pinia'
import api from '@/api'
import { useEnvStore } from './env'

export const useDevStore = defineStore('devenv', {
  state: () => ({
    catalog: [],
    mirrors: {},
    scanning: false,
    scanProgress: null,
    scanResult: null,
    tasks: [],
    audit: null,
    auditing: false,
    rules: [],
    ruleVersion: ''
  }),
  actions: {
    async loadCatalog() {
      const res = await api.devenv.listCatalog()
      if (res.ok) {
        this.catalog = res.data.items
        this.mirrors = res.data.mirrors
      }
      return res
    },
    async loadRules() {
      const res = await api.rules.list()
      if (res.ok) {
        this.rules = res.data.rules
        this.ruleVersion = res.data.ruleVersion
      }
      return res
    },
    async scan(opts) {
      this.scanning = true
      this.scanProgress = null
      try {
        const res = await api.devenv.scan(opts)
        if (res.ok) this.scanResult = res.data
        return res
      } finally {
        this.scanning = false
        this.scanProgress = null
      }
    },
    async loadTasks() {
      const res = await api.task.list()
      if (res.ok) this.tasks = res.data
      return res
    },
    applyTaskUpdate(task) {
      const idx = this.tasks.findIndex((t) => t.id === task.id)
      if (idx >= 0) this.tasks[idx] = task
      else this.tasks.unshift(task)
    },
    async runAudit(opts) {
      this.auditing = true
      try {
        const res = await api.devenv.audit(opts)
        if (res.ok) this.audit = res.data
        return res
      } finally {
        this.auditing = false
      }
    },
    applyFix(issue) {
      const env = useEnvStore()
      return env.applyTemplateVars(issue.fix || [], { source: 'audit', originId: issue.title, originName: issue.title })
    }
  }
})

export const useSetStore = defineStore('envset', {
  state: () => ({
    sets: [],
    mutex: [],
    templates: [],
    loadedSets: []
  }),
  actions: {
    async load() {
      const [listRes, tplRes] = await Promise.all([api.envset.list(), api.envset.templates()])
      if (listRes.ok) {
        this.sets = listRes.data.sets
        this.mutex = listRes.data.mutex
      }
      if (tplRes.ok) this.templates = tplRes.data
      return listRes
    },
    async loadSet(id, { skipMutex = false } = {}) {
      const env = useEnvStore()
      const set = this.sets.find((s) => s.id === id)
      if (!set) throw new Error('配置集不存在')

      let mutexInfo = null
      if (set.mutexId && !skipMutex) {
        const group = this.mutex.find((m) => m.id === set.mutexId)
        const loadedSameGroup = this.loadedSets.filter((lid) => {
          const s = this.sets.find((x) => x.id === lid)
          return s && s.mutexId === set.mutexId && lid !== id
        })
        if (loadedSameGroup.length) {
          const names = loadedSameGroup.map((lid) => this.sets.find((x) => x.id === lid)?.name).filter(Boolean)
          if (group?.forceBlock) {
            return { blocked: true, message: `互斥组「${group.name}」已开启强制阻断，禁止同时加载多套配置（当前已加载：${names.join('、')}）` }
          }
          mutexInfo = { group, loadedNames: names, setId: id, setName: set.name, autoClean: group ? group.autoClean : true }
        }
      }

      const res = await api.envset.get(id)
      if (!res.ok) throw new Error(res.message || '读取配置集失败')
      const detail = res.data?.set ? res.data.set : res.data
      const variables = (detail.variables || []).map((v) => ({
        scope: v.scope === 'system' ? 'machine' : 'user',
        name: v.key, value: v.value, remark: v.remark || '', op: 'create'
      }))

      if (mutexInfo && mutexInfo.autoClean) {
        return { pendingMutex: mutexInfo, variables }
      }
      const r = env.applyTemplateVars(variables, { source: 'config-set', originId: id, originName: set.name })
      if (!this.loadedSets.includes(id)) this.loadedSets.push(id)
      return { added: r.added, errors: r.errors }
    },
    async confirmMutexSwitch(info) {
      const env = useEnvStore()
      let removed = 0
      for (const lid of this.loadedSets.slice()) {
        const s = this.sets.find((x) => x.id === lid)
        if (s && s.mutexId === info.group?.id && lid !== info.setId) {
          removed += env.removeOriginChanges(lid)
          this.loadedSets = this.loadedSets.filter((x) => x !== lid)
        }
      }
      const r = env.applyTemplateVars(info.variables, { source: 'config-set', originId: info.setId, originName: info.setName })
      if (!this.loadedSets.includes(info.setId)) this.loadedSets.push(info.setId)
      return { removed, added: r.added.length, errors: r.errors }
    },
    unloadSet(id) {
      const env = useEnvStore()
      const n = env.removeOriginChanges(id)
      this.loadedSets = this.loadedSets.filter((x) => x !== id)
      return n
    }
  }
})
