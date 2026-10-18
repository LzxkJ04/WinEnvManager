'use strict'
/**
 * 后台任务队列
 * 支持任务类型注册、并发上限、暂停 / 继续 / 取消 / 重试、任务依赖编排、任务分组、进度推送
 */
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const path = require('node:path')
const store = require('./store')

const PERSIST_FILE = () => path.join(store.appDataDir(), 'tasks.json')

const STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  PAUSED: 'paused',
  SUCCESS: 'success',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
}

const TYPE_LABEL = {
  deploy: '环境部署',
  download: '下载',
  uninstall: '卸载',
  scan: '环境扫描',
  audit: '环境审计',
  validate: '版本校验',
  switch: '版本切换'
}

class TaskManager extends EventEmitter {
  constructor() {
    super()
    this.tasks = new Map()
    this.handlers = new Map()
    this.signals = new Map() // taskId -> { paused, cancelled }
    this.maxConcurrent = 2
    this.restore()
  }

  /* ------------------------------ 持久化 ------------------------------ */

  restore() {
    try {
      const f = PERSIST_FILE()
      if (!fs.existsSync(f)) return
      const list = JSON.parse(fs.readFileSync(f, 'utf8'))
      let keepMs = 0
      try {
        const days = Number(store.readConfig().taskLogKeepDays)
        if (Number.isFinite(days) && days > 0) keepMs = days * 86400000
      } catch (_) { keepMs = 0 }
      const done = new Set([STATUS.SUCCESS, STATUS.FAILED, STATUS.CANCELLED])
      let dropped = 0
      let changed = false
      for (const t of list) {
        // 重启后运行中的任务一律标记为失败，可手动重试
        if (t.status === STATUS.RUNNING || t.status === STATUS.QUEUED || t.status === STATUS.PAUSED) {
          t.status = STATUS.FAILED
          t.error = '程序重启导致任务中断，可重试'
          t.finishedAt = t.finishedAt || Date.now()
          changed = true
        }
        if (keepMs && done.has(t.status)) {
          const at = Number(t.finishedAt) || Number(t.createdAt) || 0
          if (at && Date.now() - at > keepMs) {
            dropped += 1
            continue
          }
        }
        t.logs = t.logs || []
        this.tasks.set(t.id, t)
      }
      if (dropped || changed) this.persist()
    } catch (_) { /* ignore */ }
  }

  /** 已结束且超过 taskLogKeepDays 的任务从队列里去掉。进行中的不删。0 或非法值表示不清理。 */
  pruneExpired() {
    let days = 0
    try { days = Number(store.readConfig().taskLogKeepDays) } catch (_) { return false }
    if (!Number.isFinite(days) || days <= 0) return false
    const keepMs = days * 86400000
    const done = new Set([STATUS.SUCCESS, STATUS.FAILED, STATUS.CANCELLED])
    let dropped = false
    for (const [id, t] of this.tasks) {
      if (!done.has(t.status)) continue
      const at = Number(t.finishedAt) || Number(t.createdAt) || 0
      if (at && Date.now() - at > keepMs) {
        this.tasks.delete(id)
        dropped = true
      }
    }
    return dropped
  }

  persist() {
    try {
      this.pruneExpired()
      store.ensureDir(store.appDataDir())
      fs.writeFileSync(PERSIST_FILE(), JSON.stringify([...this.tasks.values()], null, 2), 'utf8')
    } catch (_) { /* ignore */ }
  }

  /* ------------------------------ 注册 ------------------------------ */

  registerHandler(type, fn) {
    this.handlers.set(type, fn)
  }

  setConcurrency(n) {
    const v = Math.max(1, Math.min(5, Number(n) || 2))
    this.maxConcurrent = v
    this.pump()
    return v
  }

  /* ------------------------------ 任务操作 ------------------------------ */

  create(payload) {
    const task = {
      id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: payload.name || '未命名任务',
      type: payload.type || 'deploy',
      groupId: payload.groupId || '',
      dependsOn: payload.dependsOn || [],
      params: payload.params || {},
      maxRetries: payload.maxRetries === undefined ? 0 : Number(payload.maxRetries),
      retries: 0,
      status: STATUS.QUEUED,
      progress: 0,
      received: 0,
      total: 0,
      speed: 0,
      createdAt: Date.now(),
      startedAt: 0,
      finishedAt: 0,
      error: '',
      result: null,
      logs: []
    }
    this.tasks.set(task.id, task)
    this.log(task, '任务已创建，等待调度')
    this.persist()
    this.emitChange(task)
    this.pump()
    return task
  }

  get(id) {
    return this.tasks.get(id) || null
  }

  list(filter) {
    let list = [...this.tasks.values()]
    if (filter && filter.groupId) list = list.filter((t) => t.groupId === filter.groupId)
    if (filter && filter.status) list = list.filter((t) => t.status === filter.status)
    return list.sort((a, b) => b.createdAt - a.createdAt)
  }

  log(task, text, level = 'info') {
    task.logs = task.logs || []
    task.logs.push({ at: Date.now(), level, text })
    if (task.logs.length > 500) task.logs.shift()
    store.writeLog(level, `[任务] ${task.name}: ${text}`)
  }

  emitChange(task) {
    this.emit('change', this.public(task))
  }

  /** 发送给渲染进程的精简结构（不含超长日志） */
  public(task) {
    const t = { ...task }
    t.logs = (task.logs || []).slice(-30)
    return t
  }

  failBlocked() {
    let dirty = false
    let again = true
    while (again) {
      again = false
      for (const task of this.tasks.values()) {
        if (task.status !== STATUS.QUEUED) continue
        const broken = (task.dependsOn || [])
          .map((id) => this.tasks.get(id))
          .find((dep) => dep && (dep.status === STATUS.FAILED || dep.status === STATUS.CANCELLED))
        if (!broken) continue
        task.status = STATUS.FAILED
        task.error = `前置任务未成功：${broken.name}`
        task.finishedAt = Date.now()
        this.log(task, task.error, 'error')
        this.emitChange(task)
        dirty = true
        again = true
      }
    }
    if (dirty) this.persist()
  }

  pump() {
    this.failBlocked()
    const running = [...this.tasks.values()].filter((t) => t.status === STATUS.RUNNING).length
    let free = this.maxConcurrent - running
    if (free <= 0) return

    const ready = [...this.tasks.values()]
      .filter((t) => t.status === STATUS.QUEUED)
      .filter((t) => (t.dependsOn || []).every((depId) => {
        const dep = this.tasks.get(depId)
        return !dep || dep.status === STATUS.SUCCESS
      }))
      .sort((a, b) => a.createdAt - b.createdAt)

    for (const task of ready) {
      if (free <= 0) break
      free -= 1
      this.start(task)
    }
  }

  start(task) {
    const handler = this.handlers.get(task.type)
    if (!handler) {
      task.status = STATUS.FAILED
      task.error = `未知任务类型：${task.type}`
      this.persist()
      this.emitChange(task)
      return
    }
    const signal = { paused: false, cancelled: false }
    this.signals.set(task.id, signal)
    task.status = STATUS.RUNNING
    task.startedAt = Date.now()
    task.progress = 0
    this.log(task, '任务开始执行')
    this.persist()
    this.emitChange(task)

    const ctx = {
      signal,
      log: (text, level) => {
        this.log(task, text, level)
        this.emitChange(task)
      },
      progress: (p) => {
        if (p && typeof p === 'object') {
          if (p.percent !== undefined) task.progress = Math.max(0, Math.min(100, Number(p.percent)))
          if (p.received !== undefined) task.received = p.received
          if (p.total !== undefined) task.total = p.total
          if (p.speed !== undefined) task.speed = p.speed
          if (p.phase) task.phase = p.phase
        }
        this.emitChange(task)
      }
    }

    Promise.resolve()
      .then(() => handler(task.params, ctx))
      .then((result) => {
        task.status = STATUS.SUCCESS
        task.progress = 100
        task.finishedAt = Date.now()
        task.result = result || null
        this.log(task, '任务执行成功')
      })
      .catch((err) => {
        if (signal.cancelled) {
          task.status = STATUS.CANCELLED
          task.error = '任务已取消'
          this.log(task, '任务已取消', 'warn')
        } else if ((Number(task.retries) || 0) < task.maxRetries) {
          task.retries = (Number(task.retries) || 0) + 1
          task.status = STATUS.QUEUED
          task.error = `${err.message}（自动重试 ${task.retries}/${task.maxRetries}）`
          this.log(task, `执行失败，自动重试：${err.message}`, 'warn')
          setTimeout(() => this.pump(), 2000 * task.retries)
        } else {
          task.status = STATUS.FAILED
          task.error = err.message || String(err)
          this.log(task, `任务失败：${task.error}`, 'error')
        }
      })
      .finally(() => {
        this.signals.delete(task.id)
        this.persist()
        this.emitChange(task)
        this.pump()
      })
  }

  pause(id) {
    const t = this.tasks.get(id)
    const s = this.signals.get(id)
    if (!t || !s) return false
    if (t.status !== STATUS.RUNNING) return false
    s.paused = true
    t.status = STATUS.PAUSED
    this.log(t, '任务已暂停')
    this.persist()
    this.emitChange(t)
    return true
  }

  resume(id) {
    const t = this.tasks.get(id)
    const s = this.signals.get(id)
    if (!t) return false
    if (t.status === STATUS.PAUSED && s) {
      s.paused = false
      t.status = STATUS.RUNNING
      this.log(t, '任务已继续')
      this.persist()
      this.emitChange(t)
      return true
    }
    if (t.status === STATUS.QUEUED) {
      this.pump()
      return true
    }
    return false
  }

  cancel(id) {
    const t = this.tasks.get(id)
    const s = this.signals.get(id)
    if (!t) return false
    if (s) {
      s.cancelled = true
      s.paused = false
      return true
    }
    if (t.status === STATUS.QUEUED || t.status === STATUS.PAUSED) {
      t.status = STATUS.CANCELLED
      t.error = '任务已取消'
      t.finishedAt = Date.now()
      this.log(t, '任务已取消（未开始）', 'warn')
      this.persist()
      this.emitChange(t)
      this.pump()
      return true
    }
    return false
  }

  retry(id) {
    const t = this.tasks.get(id)
    if (!t) return false
    if (![STATUS.FAILED, STATUS.CANCELLED].includes(t.status)) return false
    t.status = STATUS.QUEUED
    t.error = ''
    t.retries = 0
    t.progress = 0
    t.finishedAt = 0
    this.log(t, '任务已重新排队')
    this.persist()
    this.emitChange(t)
    this.pump()
    return true
  }

  clearFinished() {
    let n = 0
    for (const [id, t] of [...this.tasks.entries()]) {
      if ([STATUS.SUCCESS, STATUS.CANCELLED].includes(t.status)) {
        this.tasks.delete(id)
        n += 1
      }
    }
    this.persist()
    return n
  }

  pauseAll() {
    let n = 0
    for (const t of this.tasks.values()) {
      if (t.status === STATUS.RUNNING && this.pause(t.id)) n += 1
    }
    return n
  }

  resumeAll() {
    let n = 0
    for (const t of this.tasks.values()) {
      if (t.status === STATUS.PAUSED && this.resume(t.id)) n += 1
      else if (t.status === STATUS.QUEUED) { this.pump(); n += 1 }
    }
    return n
  }
}

module.exports = { TaskManager, STATUS, TYPE_LABEL }
