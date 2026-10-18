/**
 * 环境变量核心状态仓库（v2）
 *
 * 全局统一数据逻辑：
 *  1. 所有模块（手动编辑 / 开发环境部署 / 配置集切换 / 审计修复 / 批量导入）产生的变更
 *     全部进入本仓库的内存草稿区，绝不直接写注册表；
 *  2. 草稿区分来源标记，保存时可按来源分组勾选提交；
 *  3. 单条变更可单独取消（revertChange），互斥组切换可整组回退（removeOriginChanges）；
 *  4. 撤销/重做栈保存在内存，成功写入系统后清空。
 *
 * 工作项：{ name, value, scope, origName, _isNew, _deleted }
 */
import { defineStore } from 'pinia'
import api from '@/api'

const SCOPES = ['user', 'machine']

function mapFromList(list) {
  const m = {}
  for (const item of list || []) m[item.name] = item.value
  return m
}

function makeItems(map, scope) {
  return Object.keys(map)
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    .map((name) => ({ name, value: map[name], scope, origName: name, _isNew: false, _deleted: false }))
}

function splitPath(value) {
  return String(value || '').split(';').map((s) => s.trim()).filter((s) => s !== '')
}

function joinPath(items) {
  return items.map((i) => (typeof i === 'string' ? i : i.path)).map((p) => String(p).trim()).filter(Boolean).join(';')
}

function normalizeEntry(p) {
  const t = String(p || '').trim()
  if (t.length > 3 && (t.endsWith('\\') || t.endsWith('/'))) return t.slice(0, -1)
  return t
}

export const useEnvStore = defineStore('env', {
  state: () => ({
    loading: false,
    loaded: false,
    admin: false,
    readAt: 0,

    original: { user: {}, machine: {} },
    working: { user: [], machine: [] },

    undoStack: [],
    redoStack: [],

    disabledPath: { user: [], machine: [] },

    /* v2：草稿来源标记 key = `${scope}::${NAME}` */
    changeMeta: {},
    /* v2：变量元数据（备注/锁定/标签/收藏/敏感/最近修改） */
    meta: { vars: {}, path: {} },
    /* v2：外部注册表变更检测 */
    externalChanged: false,
    externalAt: 0,

    needExplorerRestart: false,
    lastSavedAt: 0,
    lastSaveResult: null,
    lastSubmittedSources: [],
    draftRestored: false,

    config: {},
    paths: {}
  }),

  getters: {
    /** 生成提交清单，附带来源标记 */
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
              out.push({
                key, action: 'delete', scope, name: prev || cur, value: '',
                oldValue: orig[prev || cur] ?? '',
                source: (state.changeMeta[key] && state.changeMeta[key].source) || 'manual'
              })
            }
            continue
          }
          if (prev !== undefined) seen.add(prev.toUpperCase())
          if (item._isNew || prev === undefined) {
            const key = `${scope}::${cur.toUpperCase()}`
            out.push({
              key, action: 'create', scope, name: cur, value: item.value, oldValue: '',
              source: (state.changeMeta[key] && state.changeMeta[key].source) || 'manual'
            })
          } else if (prev !== cur) {
            const dk = `${scope}::${prev.toUpperCase()}`
            const ck = `${scope}::${cur.toUpperCase()}`
            const src = (state.changeMeta[ck] && state.changeMeta[ck].source) ||
                        (state.changeMeta[dk] && state.changeMeta[dk].source) || 'manual'
            out.push({ key: dk, action: 'delete', scope, name: prev, value: '', oldValue: orig[prev] ?? '', source: src })
            out.push({ key: ck, action: 'create', scope, name: cur, value: item.value, oldValue: orig[prev] ?? '', source: src })
          } else if (orig[cur] !== item.value) {
            const key = `${scope}::${cur.toUpperCase()}`
            out.push({
              key, action: 'update', scope, name: cur, value: item.value, oldValue: orig[cur] ?? '',
              source: (state.changeMeta[key] && state.changeMeta[key].source) || 'manual'
            })
          }
        }
        for (const name of Object.keys(orig)) {
          if (!seen.has(name.toUpperCase())) {
            const key = `${scope}::${name.toUpperCase()}`
            out.push({
              key, action: 'delete', scope, name, value: '', oldValue: orig[name] ?? '',
              source: (state.changeMeta[key] && state.changeMeta[key].source) || 'manual'
            })
          }
        }
      }
      return out
    },

    dirty() {
      return this.changes.length > 0
    },

    pendingCount() {
      return this.changes.length
    },

    /** 按来源分组（保存弹窗「区域1：变更来源分组」） */
    changeGroups() {
      const map = {}
      for (const c of this.changes) {
        const s = c.source || 'manual'
        map[s] = map[s] || []
        map[s].push(c)
      }
      return map
    },

    /** 只保留勾选来源后的提交清单 */
    submittedChanges() {
      return (selectedSources) => {
        const allow = new Set(selectedSources || [])
        return this.changes.filter((c) => allow.has(c.source || 'manual'))
      }
    },

    /** 草稿提交后的预览（草稿快照预览） */
    draftPreview() {
      return (selectedSources) => {
        const list = this.submittedChanges(selectedSources)
        const preview = { user: {}, machine: {} }
        for (const scope of SCOPES) preview[scope] = { ...(this.original[scope] || {}) }
        for (const c of list) {
          if (c.action === 'delete') delete preview[c.scope][c.name]
          else preview[c.scope][c.name] = c.value
        }
        return preview
      }
    },

    changedKeys(state) {
      const set = new Set()
      for (const scope of SCOPES) {
        for (const item of state.working[scope]) {
          if (item._deleted) {
            set.add(`${scope}::${(item.origName || item.name).toUpperCase()}`)
            continue
          }
          if (item._isNew) set.add(`${scope}::${item.name.toUpperCase()}`)
          else if (item.origName !== item.name || state.original[scope][item.name] !== item.value) {
            set.add(`${scope}::${item.name.toUpperCase()}`)
            if (item.origName) set.add(`${scope}::${item.origName.toUpperCase()}`)
          }
        }
        for (const name of Object.keys(state.original[scope] || {})) {
          const has = state.working[scope].some(
            (i) => (i.origName || i.name).toUpperCase() === name.toUpperCase()
          )
          if (!has) set.add(`${scope}::${name.toUpperCase()}`)
        }
      }
      return set
    },

    counts(state) {
      const alive = (scope) => state.working[scope].filter((i) => !i._deleted).length
      const user = alive('user')
      const machine = alive('machine')
      return { user, machine, total: user + machine }
    },

    pathItems(state) {
      const build = (scope) => {
        const hit = state.working[scope].find((i) => i.name.toUpperCase() === 'PATH' && !i._deleted)
        const enabled = splitPath(hit ? hit.value : '').map((p, idx) => ({
          id: `${scope}-e-${idx}`,
          path: p,
          scope,
          disabled: false,
          meta: state.meta.path[`${scope}::${p.toLowerCase()}`] || {}
        }))
        const disabled = (state.disabledPath[scope] || []).map((p, idx) => ({
          id: `${scope}-d-${idx}`,
          path: p,
          scope,
          disabled: true,
          meta: state.meta.path[`${scope}::${p.toLowerCase()}`] || {}
        }))
        return [...enabled, ...disabled]
      }
      return { user: build('user'), machine: build('machine') }
    },

    canUndo: (state) => state.undoStack.length > 0,
    canRedo: (state) => state.redoStack.length > 0
  },

  actions: {
    /* ------------------------------ 读取 ------------------------------ */

    async load({ silent = false } = {}) {
      if (!silent) this.loading = true
      try {
        const [envRes, cfgRes, metaRes] = await Promise.all([api.env.getAllEnv(), api.config.get(), api.meta.all()])
        if (!envRes.ok) throw new Error(envRes.message)
        const { user, machine, admin, readAt } = envRes.data

        this.original = { user: mapFromList(user), machine: mapFromList(machine) }
        this.working = {
          user: makeItems(this.original.user, 'user'),
          machine: makeItems(this.original.machine, 'machine')
        }
        this.admin = !!admin
        this.readAt = readAt || Date.now()
        this.clearHistory()
        this.needExplorerRestart = false
        this.loaded = true

        if (cfgRes.ok) {
          this.config = cfgRes.data.config || {}
          // 便携标记随配置下发，供横幅与设置页展示
          if (cfgRes.data.install && cfgRes.data.install.portable) this.config.installPortable = true
          this.paths = cfgRes.data.paths || {}
          this.disabledPath = {
            user: this.config.disabledPathUser || [],
            machine: this.config.disabledPathMachine || []
          }
        }
        if (metaRes.ok) {
          this.meta = { vars: metaRes.data.vars || {}, path: metaRes.data.path || {} }
        }
        if (!silent && this.config.draftAutoSave !== false && this.config.keepDraftOnExit !== false) {
          this.restoreDraft()
        }
        return true
      } finally {
        this.loading = false
      }
    },

    /** 把内存草稿写进本地配置，崩溃或退出后还能恢复。不写注册表。 */
    persistDraft() {
      if (this.config.draftAutoSave === false) return
      const payload = this.dirty
        ? {
            savedAt: Date.now(),
            working: JSON.parse(JSON.stringify(this.working)),
            changeMeta: JSON.parse(JSON.stringify(this.changeMeta)),
            disabledPath: JSON.parse(JSON.stringify(this.disabledPath))
          }
        : null
      this.config = { ...this.config, draftCache: payload }
      api.config.set({ draftCache: payload }).catch(() => {})
    },

    restoreDraft() {
      const cache = this.config.draftCache
      if (!cache || !cache.working || this.draftRestored) return false
      this.draftRestored = true
      this.working = cache.working
      this.changeMeta = cache.changeMeta || {}
      if (cache.disabledPath) this.disabledPath = cache.disabledPath
      return this.dirty
    },

    clearDraftCache() {
      this.config = { ...this.config, draftCache: null }
      api.config.set({ draftCache: null }).catch(() => {})
    },

    /* ------------------------------ 历史 ------------------------------ */

    snapshotState() {
      return {
        working: JSON.parse(JSON.stringify(this.working)),
        disabledPath: JSON.parse(JSON.stringify(this.disabledPath)),
        changeMeta: JSON.parse(JSON.stringify(this.changeMeta))
      }
    },

    pushHistory() {
      this.undoStack.push(this.snapshotState())
      const max = Number(this.config.undoMaxSteps) || 50
      if (this.undoStack.length > max) this.undoStack.shift()
      this.redoStack = []
      this.persistDraft()
    },

    undo() {
      if (!this.undoStack.length) return false
      this.redoStack.push(this.snapshotState())
      const prev = this.undoStack.pop()
      this.working = prev.working
      this.disabledPath = prev.disabledPath
      this.changeMeta = prev.changeMeta
      this.persistDraft()
      return true
    },

    redo() {
      if (!this.redoStack.length) return false
      this.undoStack.push(this.snapshotState())
      const next = this.redoStack.pop()
      this.working = next.working
      this.disabledPath = next.disabledPath
      this.changeMeta = next.changeMeta
      this.persistDraft()
      return true
    },

    clearHistory() {
      this.undoStack = []
      this.redoStack = []
    },

    async discard() {
      this.redoStack = []
      this.undoStack = []
      this.changeMeta = {}
      this.clearDraftCache()
      return this.load()
    },

    /* ------------------------------ 单变量操作 ------------------------------ */

    findItem(scope, name) {
      return this.working[scope].find((i) => i.name.toUpperCase() === String(name).toUpperCase())
    },

    tagChange(scope, name, opts) {
      if (!opts || (!opts.source && !opts.originId)) return
      const key = `${scope}::${String(name).toUpperCase()}`
      this.changeMeta[key] = {
        source: opts.source || 'manual',
        originId: opts.originId || '',
        originName: opts.originName || '',
        at: Date.now()
      }
    },

    isLocked(scope, name) {
      if (this.config && this.config.lockProtect === false) return false
      const m = this.meta.vars[`${scope}::${String(name).toUpperCase()}`]
      return !!(m && m.locked)
    },

    setValue(scope, name, value, opts) {
      const item = this.findItem(scope, name)
      if (!item) return false
      if (item.value === value) return true
      if (this.isLocked(scope, name)) throw new Error(`变量 ${name} 已锁定，请先解锁`)
      this.pushHistory()
      item.value = value
      this.tagChange(scope, name, opts)
      return true
    },

    rename(scope, oldName, newName, opts) {
      const item = this.findItem(scope, oldName)
      if (!item) throw new Error('未找到待重命名的变量')
      if (this.isLocked(scope, oldName)) throw new Error(`变量 ${oldName} 已锁定，请先解锁`)
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
      if (exist && exist._deleted) {
        this.pushHistory()
        exist._deleted = false
        exist.value = value
        this.tagChange(scope, name, opts)
        return true
      }
      this.pushHistory()
      this.working[scope].push({ name, value, scope, origName: undefined, _isNew: true, _deleted: false })
      this.tagChange(scope, name, opts)
      return true
    },

    remove(scope, names, opts) {
      const set = new Set((Array.isArray(names) ? names : [names]).map((n) => String(n).toUpperCase()))
      const targets = this.working[scope].filter((i) => set.has(i.name.toUpperCase()) && !i._deleted)
      if (!targets.length) return false
      for (const t of targets) {
        if (this.isLocked(scope, t.name)) throw new Error(`变量 ${t.name} 已锁定，请先解锁`)
      }
      this.pushHistory()
      for (const t of targets) {
        t._deleted = true
        this.tagChange(scope, t.origName || t.name, opts)
      }
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

    /** 取消单条草稿变更（保存弹窗「取消本条变更」） */
    revertChange(change) {
      const scope = change.scope
      const item = this.working[scope].find(
        (i) => i.name.toUpperCase() === String(change.name).toUpperCase() ||
               String(i.origName || '').toUpperCase() === String(change.name).toUpperCase()
      )
      if (!item) return false
      this.pushHistory()

      if (item._isNew) {
        this.working[scope] = this.working[scope].filter((i) => i !== item)
        delete this.changeMeta[`${scope}::${String(item.name).toUpperCase()}`]
        return true
      }
      if (item.origName !== item.name) {
        item.name = item.origName
        delete this.changeMeta[`${scope}::${String(item.name).toUpperCase()}`]
      }
      if (item._deleted) item._deleted = false
      const orig = this.original[scope][item.origName]
      if (orig !== undefined) item.value = orig
      return true
    },

    /** 撤销指定来源 / 指定配置集产生的全部草稿变更（互斥组切换用） */
    removeOriginChanges(originId) {
      if (!originId) return 0
      const keys = Object.keys(this.changeMeta).filter((k) => this.changeMeta[k].originId === originId)
      let n = 0
      for (const k of keys) {
        const idx = k.indexOf('::')
        const scope = k.slice(0, idx)
        const name = k.slice(idx + 2)
        if (this.revertChange({ scope, name, action: 'update' })) n += 1
      }
      for (const k of keys) delete this.changeMeta[k]
      return n
    },

    /** 批量套用变量模板（环境市场 / 配置集 / 审计修复共用入口） */
    applyTemplateVars(variables, opts = {}) {
      const added = []
      const errors = []
      for (const v of variables) {
        if (v.op === 'same') continue
        try {
          if (v.op === 'delete') {
            this.remove(v.scope, v.name, opts)
          } else if (this.findItem(v.scope, v.name)) {
            this.setValue(v.scope, v.name, v.value, opts)
          } else {
            this.add(v.scope, v.name, v.value, opts)
          }
          added.push(v)
        } catch (err) {
          errors.push(`${v.name}: ${err.message}`)
        }
      }
      return { added, errors }
    },

    /* ------------------------------ PATH 操作 ------------------------------ */

    setPathValueSilent(scope, value) {
      const item = this.working[scope].find((i) => i.name.toUpperCase() === 'PATH' && !i._deleted)
      if (!item) {
        this.working[scope].push({ name: 'Path', value, scope, origName: undefined, _isNew: true, _deleted: false })
      } else {
        item.value = value
      }
    },

    setPathItems(scope, items, opts) {
      const enabled = items.filter((i) => !i.disabled).map((i) => normalizeEntry(i.path)).filter(Boolean)
      const disabled = items.filter((i) => i.disabled).map((i) => normalizeEntry(i.path)).filter(Boolean)
      this.pushHistory()
      this.disabledPath[scope] = disabled
      this.setPathValueSilent(scope, enabled.join(';'))
      this.tagChange(scope, 'Path', opts)
      api.config.set({ [scope === 'user' ? 'disabledPathUser' : 'disabledPathMachine']: disabled }).catch(() => {})
    },

    appendPaths(scope, paths, opts) {
      const list = this.pathItems[scope].map((i) => ({ ...i, path: normalizeEntry(i.path) }))
      const exist = new Set(list.map((i) => i.path.toLowerCase()))
      const added = []
      for (const p of paths) {
        const n = normalizeEntry(p)
        if (!n || exist.has(n.toLowerCase())) continue
        exist.add(n.toLowerCase())
        list.push({ id: `${scope}-n-${Date.now()}-${added.length}`, path: n, scope, disabled: false, meta: {} })
        added.push(n)
      }
      if (added.length) this.setPathItems(scope, list, opts)
      return added
    },

    findDuplicatePaths(scope) {
      const seen = new Map()
      const dups = []
      for (const item of this.pathItems[scope]) {
        if (item.disabled) continue
        const key = normalizeEntry(item.path).toLowerCase()
        if (seen.has(key)) dups.push({ ...item, keepId: seen.get(key) })
        else seen.set(key, item.id)
      }
      return dups
    },

    removePathDuplicates(scope, dupIds) {
      const set = new Set(dupIds || [])
      this.setPathItems(scope, this.pathItems[scope].filter((i) => !set.has(i.id)))
    },

    /* ------------------------------ 写入系统 ------------------------------ */

    async save(selectedSources) {
      const list = this.submittedChanges(selectedSources || [])
      if (!list.length) return { ok: true, empty: true }
      this.loading = true
      try {
        const payload = list.map((c) => ({
          action: c.action,
          scope: c.scope,
          name: c.name,
          value: c.value,
          oldValue: c.oldValue,
          source: c.source
        }))
        const res = await api.env.applyChanges(payload)
        if (!res.ok) throw new Error(res.message)
        const failed = (res.data.results || []).filter((r) => !r.ok)
        if (failed.length) throw new Error(failed.map((f) => `${f.name}: ${f.message || '写入失败'}`).join('；'))

        this.needExplorerRestart = !!res.data.needRestartExplorer
        this.lastSaveResult = res.data
        this.lastSavedAt = Date.now()
        this.lastSubmittedSources = [...(selectedSources || [])]
        this.clearHistory()
        this.clearDraftCache()

        // 未提交的变更保留在草稿区：只清掉已提交条目的来源标记
        const submittedKeys = new Set(list.map((c) => c.key))
        for (const k of Object.keys(this.changeMeta)) {
          if (submittedKeys.has(k)) delete this.changeMeta[k]
        }
        await this.load({ silent: true })
        if (this.dirty) this.persistDraft()
        return { ok: true, results: res.data.results, needExplorerRestart: this.needExplorerRestart, count: list.length }
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
