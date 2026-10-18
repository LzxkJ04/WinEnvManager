/**
 * 开发环境管理 & 环境配置集 状态仓库
 */
import { defineStore } from 'pinia'
import api from '@/api'
import { useEnvStore } from './env'

const SCAN_SETTINGS_KEY = 'wem-scan-settings'
const SCAN_CACHE_KEY = 'wem-scan-cache'
let memoryScan = null

function readSavedScanSettings() {
  try {
    const raw = localStorage.getItem(SCAN_SETTINGS_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null
  } catch {
    return null
  }
}

/** 只合并用户已经保存过的扫描附加项，避免未保存的默认值改变现有扫描。 */
function withSavedScanOptions(opts) {
  const merged = { ...(opts || {}) }
  const saved = readSavedScanSettings()
  if (!saved) return merged
  if (!('versionTimeoutSec' in merged) && Object.prototype.hasOwnProperty.call(saved, 'timeoutSec')) {
    const sec = Number(saved.timeoutSec)
    if (Number.isFinite(sec) && sec >= 1 && sec <= 30) merged.versionTimeoutSec = sec
  }
  if (!('skipNetwork' in merged) && Object.prototype.hasOwnProperty.call(saved, 'skipNetwork')) {
    merged.skipNetwork = saved.skipNetwork === true
  }
  if (!('skipUsb' in merged) && Object.prototype.hasOwnProperty.call(saved, 'skipUsb')) {
    merged.skipUsb = saved.skipUsb === true
  }
  return merged
}

function scanDeepOf(opts) {
  if (opts && opts.deep !== undefined) return !!opts.deep
  try {
    const env = useEnvStore()
    return !!(env.config && env.config.deepScan)
  } catch {
    return false
  }
}

function savedCacheMs() {
  const saved = readSavedScanSettings()
  if (!saved || !Object.prototype.hasOwnProperty.call(saved, 'cacheHours')) return 0
  const hours = Number(saved.cacheHours)
  return Number.isFinite(hours) && hours > 0 ? hours * 3600 * 1000 : 0
}

function freshScanCache(deep) {
  const maxAge = savedCacheMs()
  if (!maxAge) return null
  const now = Date.now()
  if (memoryScan && memoryScan.deep === !!deep && memoryScan.data && now - memoryScan.at < maxAge) return memoryScan.data
  try {
    const raw = localStorage.getItem(SCAN_CACHE_KEY)
    if (!raw) return null
    const cached = JSON.parse(raw)
    if (!cached || cached.deep !== !!deep || !cached.data || !Array.isArray(cached.data.items)) return null
    const at = Number(cached.at)
    if (!Number.isFinite(at) || now - at >= maxAge) return null
    memoryScan = { at, deep: !!deep, data: cached.data }
    return cached.data
  } catch {
    return null
  }
}

function writeScanCache(data, deep) {
  if (!savedCacheMs() || !data || !Array.isArray(data.items)) return
  const at = Date.now()
  memoryScan = { at, deep: !!deep, data }
  try {
    localStorage.setItem(SCAN_CACHE_KEY, JSON.stringify({ at, deep: !!deep, data }))
  } catch {
    /* 缓存写不下时仍保留本次内存结果 */
  }
}

/* ============================ 开发环境管理 ============================ */

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

  getters: {
    managedItems: (s) => (s.scanResult ? s.scanResult.items.filter((i) => i.managed && !i.ignored) : []),
    discoveredItems: (s) => (s.scanResult ? s.scanResult.items.filter((i) => !i.managed && !i.ignored) : []),
    ignoredItems: (s) => (s.scanResult ? s.scanResult.items.filter((i) => i.ignored) : []),
    categories: (s) => [...new Set(s.catalog.map((i) => i.category))],
    runningTasks: (s) => s.tasks.filter((t) => ['queued', 'running', 'paused'].includes(t.status))
  },

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
      const merged = withSavedScanOptions(opts)
      const deep = scanDeepOf(merged)
      if (!merged.manual) {
        const cached = freshScanCache(deep)
        if (cached) {
          this.scanResult = cached
          return { ok: true, data: cached, cached: true }
        }
      }
      if (this.scanning) return { ok: false, message: '扫描进行中' }
      this.scanning = true
      this.scanProgress = null
      try {
        const res = await api.devenv.scan(merged)
        if (res.ok) {
          this.scanResult = res.data
          if (res.data && !res.data.cancelled) writeScanCache(res.data, deep)
        }
        return res
      } finally {
        this.scanning = false
        this.scanProgress = null
      }
    },
    async cancelScan() {
      return api.devenv.cancelScan()
    },
    clearScanResultCache() {
      memoryScan = null
      try { localStorage.removeItem(SCAN_CACHE_KEY) } catch { /* 演示或隐私模式写不了时忽略 */ }
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
        const res = await api.devenv.audit(withSavedScanOptions(opts))
        if (res.ok) this.audit = res.data
        return res
      } finally {
        this.auditing = false
      }
    },
    /** 把审计修复方案写入草稿 */
    applyFix(issue) {
      const env = useEnvStore()
      const res = env.applyTemplateVars(issue.fix || [], { source: 'audit', originId: issue.title, originName: issue.title })
      return res
    }
  }
})

/* ============================ 环境配置集 ============================ */

export const useSetStore = defineStore('envset', {
  state: () => ({
    sets: [],
    mutex: [],
    templates: [],
    loadedSets: []   // 已加载至草稿的配置集 id
  }),

  getters: {
    mutexById: (s) => (id) => s.mutex.find((m) => m.id === id) || null,
    loadedInMutex: (s) => (mutexId) => s.loadedSets.filter((id) => {
      const set = s.sets.find((x) => x.id === id)
      return set && set.mutexId === mutexId
    })
  },

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

    /** 加载配置集：变量进入草稿区，处理互斥组逻辑（返回需要用户确认的信息） */
    async loadSet(id, { force = false, skipMutex = false } = {}) {
      const env = useEnvStore()
      const set = this.sets.find((s) => s.id === id)
      if (!set) throw new Error('配置集不存在')

      // 互斥组校验
      let mutexInfo = null
      if (set.mutexId) {
        const group = this.mutex.find((m) => m.id === set.mutexId)
        const loadedSameGroup = this.loadedSets.filter((lid) => {
          const s = this.sets.find((x) => x.id === lid)
          return s && s.mutexId === set.mutexId && lid !== id
        })
        if (loadedSameGroup.length) {
          const names = loadedSameGroup
            .map((lid) => (this.sets.find((x) => x.id === lid) || {}).name)
            .filter(Boolean)
          if (group && group.forceBlock && !force) {
            return { blocked: true, message: `互斥组「${group.name}」已开启强制阻断，禁止同时加载多套配置（当前已加载：${names.join('、')}）` }
          }
          if (!skipMutex) {
            mutexInfo = {
              group,
              loadedNames: names,
              setId: id,
              setName: set.name,
              autoClean: group ? group.autoClean : true
            }
          }
        }
      }

      const res = await api.envset.get(id)
      if (!res.ok) throw new Error(res.message || '读取配置集失败')
      const detail = res.data && res.data.set ? res.data.set : res.data
      const variables = (detail.variables || []).map((v) => ({
        scope: v.scope === 'system' ? 'machine' : 'user',
        name: v.key,
        value: v.value,
        remark: v.remark || '',
        op: 'create'
      }))

      const result = { added: [], errors: [], mutexInfo }
      if (!mutexInfo || !mutexInfo.autoClean) {
        const r = env.applyTemplateVars(variables, { source: 'config-set', originId: id, originName: set.name })
        result.added = r.added
        result.errors = r.errors
      } else if (mutexInfo) {
        result.pendingMutex = mutexInfo
        result.variables = variables
      } else {
        const r = env.applyTemplateVars(variables, { source: 'config-set', originId: id, originName: set.name })
        result.added = r.added
        result.errors = r.errors
      }

      if (!result.pendingMutex && !this.loadedSets.includes(id)) this.loadedSets.push(id)
      return result
    },

    /** 互斥组确认切换：清空旧配置集草稿 → 加载新配置集 */
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

    /** 卸载配置集草稿 */
    unloadSet(id) {
      const env = useEnvStore()
      const n = env.removeOriginChanges(id)
      this.loadedSets = this.loadedSets.filter((x) => x !== id)
      return n
    }
  }
})
