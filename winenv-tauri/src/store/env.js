/**
 * 环境变量核心状态仓库（草稿区 + 来源标记 + 撤销重做）
 * 与 Electron 版逻辑保持一致
 */
import { defineStore } from 'pinia'
import api from '@/api'

const SCOPES = ['user', 'machine']
const mapFromList = (list) => Object.fromEntries((list || []).map((v) => [v.name, v.value]))
const makeItems = (map, scope) =>
  Object.keys(map)
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    .map((name) => ({ name, value: map[name], scope, origName: name, _isNew: false, _deleted: false }))

export const useEnvStore = defineStore('env', {
  state: () => ({
    loading: false, loaded: false, admin: false, readAt: 0,
    original: { user: {}, machine: {} },
    working: { user: [], machine: [] },
    undoStack: [], redoStack: [],
    disabledPath: { user: [], machine: [] },
    changeMeta: {},
    meta: { vars: {}, path: {} },
    externalChanged: false,
    needExplorerRestart: false, lastSavedAt: 0,
    config: {}, paths: {}
  }),

  getters: {
    changes(state) {
      const out = []
      for (const scope of SCOPES) {
        const orig = state.original[scope] || {}
        const seen = new Set()
        for (const item of state.working[scope]) {
          const cur = item.name
          const prev = item.origName
          if (item._deleted) {
            if (!item._isNew) {
              const key = `${scope}::${(prev || cur).toUpperCase()}`
              out.push({ key, action: 'delete', scope, name: prev || cur, value: '', oldValue: orig[prev || cur] ?? '', source: state.changeMeta[key]?.source || 'manual' })
            }
            continue
          }
          if (prev !== undefined) seen.add(prev.toUpperCase())
          const srcOf = (k) => state.changeMeta[k]?.source || 'manual'
          if (item._isNew || prev === undefined) {
            const key = `${scope}::${cur.toUpperCase()}`
            out.push({ key, action: 'create', scope, name: cur, value: item.value, oldValue: '', source: srcOf(key) })
          } else if (prev !== cur) {
            const dk = `${scope}::${prev.toUpperCase()}`
            const ck = `${scope}::${cur.toUpperCase()}`
            const src = srcOf(ck) === 'manual' ? srcOf(dk) : srcOf(ck)
            out.push({ key: dk, action: 'delete', scope, name: prev, value: '', oldValue: orig[prev] ?? '', source: src })
            out.push({ key: ck, action: 'create', scope, name: cur, value: item.value, oldValue: orig[prev] ?? '', source: src })
          } else if (orig[cur] !== item.value) {
            const key = `${scope}::${cur.toUpperCase()}`
            out.push({ key, action: 'update', scope, name: cur, value: item.value, oldValue: orig[cur] ?? '', source: srcOf(key) })
          }
        }
        for (const name of Object.keys(orig)) {
          if (!seen.has(name.toUpperCase())) {
            const key = `${scope}::${name.toUpperCase()}`
            out.push({ key, action: 'delete', scope, name, value: '', oldValue: orig[name] ?? '', source: state.changeMeta[key]?.source || 'manual' })
          }
        }
      }
      return out
    },
    dirty() { return this.changes.length > 0 },
    pendingCount() { return this.changes.length },
    changeGroups() {
      const map = {}
      for (const c of this.changes) (map[c.source || 'manual'] = map[c.source || 'manual'] || []).push(c)
      return map
    },
    submittedChanges() {
      return (selected) => {
        const allow = new Set(selected || [])
        return this.changes.filter((c) => allow.has(c.source || 'manual'))
      }
    },
    draftPreview() {
      return (selected) => {
        const pv = { user: { ...this.original.user }, machine: { ...this.original.machine } }
        for (const c of this.submittedChanges(selected)) {
          if (c.action === 'delete') delete pv[c.scope][c.name]
          else pv[c.scope][c.name] = c.value
        }
        return pv
      }
    },
    counts(state) {
      const alive = (s) => state.working[s].filter((i) => !i._deleted).length
      return { user: alive('user'), machine: alive('machine'), total: alive('user') + alive('machine') }
    },
    pathItems(state) {
      const build = (scope) => {
        const hit = state.working[scope].find((i) => i.name.toUpperCase() === 'PATH' && !i._deleted)
        const enabled = String(hit ? hit.value : '').split(';').map((s) => s.trim()).filter(Boolean).map((p, i) => ({
          id: `${scope}-e-${i}`, path: p, scope, disabled: false,
          meta: state.meta.path[`${scope}::${p.toLowerCase()}`] || {}
        }))
        const disabled = (state.disabledPath[scope] || []).map((p, i) => ({
          id: `${scope}-d-${i}`, path: p, scope, disabled: true,
          meta: state.meta.path[`${scope}::${p.toLowerCase()}`] || {}
        }))
        return [...enabled, ...disabled]
      }
      return { user: build('user'), machine: build('machine') }
    },
    canUndo: (s) => s.undoStack.length > 0,
    canRedo: (s) => s.redoStack.length > 0
  },

  actions: {
    async load({ silent = false } = {}) {
      if (!silent) this.loading = true
      try {
        const [envRes, cfgRes, metaRes] = await Promise.all([api.env.getAllEnv(), api.config.get(), api.meta.all()])
        if (!envRes.ok) throw new Error(envRes.message)
        this.original = { user: mapFromList(envRes.data.user), machine: mapFromList(envRes.data.machine) }
        this.working = { user: makeItems(this.original.user, 'user'), machine: makeItems(this.original.machine, 'machine') }
        this.admin = !!envRes.data.admin
        this.readAt = envRes.data.readAt || Date.now()
        this.clearHistory()
        this.needExplorerRestart = false
        this.loaded = true
        if (cfgRes.ok) {
          this.config = cfgRes.data.config || {}
          this.paths = cfgRes.data.paths || {}
          this.disabledPath = { user: this.config.disabledPathUser || [], machine: this.config.disabledPathMachine || [] }
        }
        if (metaRes.ok) this.meta = { vars: metaRes.data.vars || {}, path: metaRes.data.path || {} }
        return true
      } finally {
        this.loading = false
      }
    },

    snapshotState() {
      return { working: JSON.parse(JSON.stringify(this.working)), disabledPath: JSON.parse(JSON.stringify(this.disabledPath)), changeMeta: JSON.parse(JSON.stringify(this.changeMeta)) }
    },
    pushHistory() {
      this.undoStack.push(this.snapshotState())
      const max = Number(this.config.undoMaxSteps) || 50
      if (this.undoStack.length > max) this.undoStack.shift()
      this.redoStack = []
    },
    undo() {
      if (!this.undoStack.length) return false
      this.redoStack.push(this.snapshotState())
      const p = this.undoStack.pop()
      this.working = p.working; this.disabledPath = p.disabledPath; this.changeMeta = p.changeMeta
      return true
    },
    redo() {
      if (!this.redoStack.length) return false
      this.undoStack.push(this.snapshotState())
      const n = this.redoStack.pop()
      this.working = n.working; this.disabledPath = n.disabledPath; this.changeMeta = n.changeMeta
      return true
    },
    clearHistory() { this.undoStack = []; this.redoStack = [] },
    async discard() { this.changeMeta = {}; return this.load() },

    findItem(scope, name) {
      return this.working[scope].find((i) => i.name.toUpperCase() === String(name).toUpperCase())
    },
    tagChange(scope, name, opts) {
      if (!opts || (!opts.source && !opts.originId)) return
      this.changeMeta[`${scope}::${String(name).toUpperCase()}`] = { source: opts.source || 'manual', originId: opts.originId || '', originName: opts.originName || '', at: Date.now() }
    },
    isLocked(scope, name) {
      return !!(this.meta.vars[`${scope}::${String(name).toUpperCase()}`]?.locked)
    },
    setValue(scope, name, value, opts) {
      const item = this.findItem(scope, name)
      if (!item || item.value === value) return true
      if (this.isLocked(scope, name)) throw new Error(`变量 ${name} 已锁定，请先解锁`)
      this.pushHistory()
      item.value = value
      this.tagChange(scope, name, opts)
      return true
    },
    rename(scope, oldName, newName, opts) {
      const item = this.findItem(scope, oldName)
      if (!item) throw new Error('未找到待重命名的变量')
      const clash = this.findItem(scope, newName)
      if (clash && clash !== item) throw new Error(`变量 ${newName} 已存在`)
      this.pushHistory()
      item.name = newName
      this.tagChange(scope, newName, opts)
      return true
    },
    add(scope, name, value, opts) {
      const exist = this.findItem(scope, name)
      if (exist && !exist._deleted) throw new Error(`变量 ${name} 已存在`)
      this.pushHistory()
      if (exist && exist._deleted) {
        exist._deleted = false
        exist.value = value
      } else {
        this.working[scope].push({ name, value, scope, origName: undefined, _isNew: true, _deleted: false })
      }
      this.tagChange(scope, name, opts)
      return true
    },
    remove(scope, names, opts) {
      const set = new Set((Array.isArray(names) ? names : [names]).map((n) => String(n).toUpperCase()))
      const targets = this.working[scope].filter((i) => set.has(i.name.toUpperCase()) && !i._deleted)
      if (!targets.length) return false
      for (const t of targets) if (this.isLocked(scope, t.name)) throw new Error(`变量 ${t.name} 已锁定，请先解锁`)
      this.pushHistory()
      for (const t of targets) { t._deleted = true; this.tagChange(scope, t.origName || t.name, opts) }
      return true
    },
    restore(scope, names) {
      const set = new Set((Array.isArray(names) ? names : [names]).map((n) => String(n).toUpperCase()))
      const targets = this.working[scope].filter((i) => set.has(i.name.toUpperCase()) && i._deleted)
      if (!targets.length) return false
      this.pushHistory()
      for (const t of targets) t._deleted = false
      return true
    },
    revertChange(change) {
      const item = this.working[change.scope].find(
        (i) => i.name.toUpperCase() === String(change.name).toUpperCase() || String(i.origName || '').toUpperCase() === String(change.name).toUpperCase()
      )
      if (!item) return false
      this.pushHistory()
      if (item._isNew) {
        this.working[change.scope] = this.working[change.scope].filter((i) => i !== item)
        delete this.changeMeta[`${change.scope}::${String(item.name).toUpperCase()}`]
        return true
      }
      if (item.origName !== item.name) {
        item.name = item.origName
        delete this.changeMeta[`${change.scope}::${String(item.name).toUpperCase()}`]
      }
      if (item._deleted) item._deleted = false
      const orig = this.original[change.scope][item.origName]
      if (orig !== undefined) item.value = orig
      return true
    },
    removeOriginChanges(originId) {
      if (!originId) return 0
      const keys = Object.keys(this.changeMeta).filter((k) => this.changeMeta[k].originId === originId)
      let n = 0
      for (const k of keys) {
        const i = k.indexOf('::')
        if (this.revertChange({ scope: k.slice(0, i), name: k.slice(i + 2), action: 'update' })) n += 1
      }
      for (const k of keys) delete this.changeMeta[k]
      return n
    },
    applyTemplateVars(variables, opts = {}) {
      const added = []
      const errors = []
      for (const v of variables) {
        if (v.op === 'same') continue
        try {
          if (v.op === 'delete') this.remove(v.scope, v.name, opts)
          else if (this.findItem(v.scope, v.name)) this.setValue(v.scope, v.name, v.value, opts)
          else this.add(v.scope, v.name, v.value, opts)
          added.push(v)
        } catch (err) {
          errors.push(`${v.name}: ${err.message}`)
        }
      }
      return { added, errors }
    },

    setPathValueSilent(scope, value) {
      const item = this.working[scope].find((i) => i.name.toUpperCase() === 'PATH' && !i._deleted)
      if (item) item.value = value
      else this.working[scope].push({ name: 'Path', value, scope, origName: undefined, _isNew: true, _deleted: false })
    },
    setPathItems(scope, items, opts) {
      this.pushHistory()
      const enabled = items.filter((i) => !i.disabled).map((i) => String(i.path).trim()).filter(Boolean)
      const disabled = items.filter((i) => i.disabled).map((i) => String(i.path).trim()).filter(Boolean)
      this.disabledPath[scope] = disabled
      this.setPathValueSilent(scope, enabled.join(';'))
      this.tagChange(scope, 'Path', opts)
      api.config.set({ [scope === 'user' ? 'disabledPathUser' : 'disabledPathMachine']: disabled })
    },
    appendPaths(scope, paths, opts) {
      const list = this.pathItems[scope].map((i) => ({ ...i, path: String(i.path).trim() }))
      const exist = new Set(list.map((i) => i.path.toLowerCase()))
      const added = []
      for (let p of paths) {
        p = String(p).trim()
        if (!p || exist.has(p.toLowerCase())) continue
        exist.add(p.toLowerCase())
        list.push({ id: `${scope}-n-${Date.now()}-${added.length}`, path: p, scope, disabled: false, meta: {} })
        added.push(p)
      }
      if (added.length) this.setPathItems(scope, list, opts)
      return added
    },
    findDuplicatePaths(scope) {
      const seen = new Map()
      const dups = []
      for (const item of this.pathItems[scope]) {
        if (item.disabled) continue
        const key = item.path.toLowerCase()
        if (seen.has(key)) dups.push({ ...item, keepId: seen.get(key) })
        else seen.set(key, item.id)
      }
      return dups
    },
    removePathDuplicates(scope, ids) {
      const set = new Set(ids || [])
      this.setPathItems(scope, this.pathItems[scope].filter((i) => !set.has(i.id)))
    },

    async save(selectedSources) {
      const list = this.submittedChanges(selectedSources || [])
      if (!list.length) return { ok: true, empty: true }
      this.loading = true
      try {
        const res = await api.env.applyChanges(
          list.map((c) => ({ action: c.action, scope: c.scope, name: c.name, value: c.value, oldValue: c.oldValue, source: c.source }))
        )
        if (!res.ok) throw new Error(res.message)
        const failed = (res.data.results || []).filter((r) => !r.ok)
        if (failed.length) throw new Error(failed.map((f) => `${f.name}: ${f.message || '写入失败'}`).join('；'))
        this.needExplorerRestart = !!res.data.needRestartExplorer
        this.lastSavedAt = Date.now()
        this.clearHistory()
        const keys = new Set(list.map((c) => c.key))
        for (const k of Object.keys(this.changeMeta)) if (keys.has(k)) delete this.changeMeta[k]
        await this.load({ silent: true })
        return { ok: true, count: list.length, needExplorerRestart: this.needExplorerRestart }
      } finally {
        this.loading = false
      }
    },
    async reloadExplorer() {
      const res = await api.env.reloadExplorer()
      if (res.ok) this.needExplorerRestart = false
      return res
    }
  }
})

export default useEnvStore
