# 注册表模块 · 开发契约（子代理必读）

本文档固定并行开发时的边界，**违反会导致合并冲突或功能失效**。

---

## 一、文件所有权（严格遵守）

| 文件 / 目录 | 归属 | 说明 |
| --- | --- | --- |
| `electron/lib/regsvc.js` | **已冻结** | 注册表底层服务，已完成并通过 26 项测试。**不要修改**，只能用它的导出函数 |
| `electron/preload.js` | **已冻结** | IPC 通道白名单已固定 52 个 `reg*` 通道。**不要修改** |
| `src/api/index.js` | 已有 Proxy 兜底 | 不要把新的域手动加进去；未定义域自动返回 `ok(null)` |
| `electron/ipc/index.js` | **已预改** | 已在最后加好 9 个 require 行。你只需创建对应文件并导出 `register(handle, ctx)` |
| `electron/ipc/registry.js` | 后端A | 注册表浏览 / 键值增删改 / 导入导出 |
| `electron/ipc/reg-backup.js` | 后端B | 备份 / 恢复 / 对比 / 依赖 / 监控 |
| `electron/ipc/reg-extra.js` | 后端C | 批量替换 / 收藏夹 / 配置打包 / 健康诊断 / 定时任务 |
| `src/views/Registry.vue` + `src/components/registry/**` | 前端A | 注册表主页面 |
| `src/views/RegBackup.vue` | 前端A | 备份管理页 |
| `src/views/Health.vue` + `src/views/Schedules.vue` | 前端B | 诊断中心 / 定时任务 |
| `src/views/Settings.vue` | **前端B 独占** | 只在末尾追加分组，不要改动既有内容 |
| `src/router/index.js` | **集成阶段统一改** | 子代理不要动，否则必然冲突 |
| `src/App.vue` | **集成阶段统一改** | 侧栏菜单，同上 |

> 需要新增路由或侧栏入口时，**不要自己改**，在交付说明里写「需要新增路由：path / name / title / icon」即可。

---

## 二、必要约定

### 2.1 IPC 处理器写法

```js
'use strict'
const regsvc = require('../lib/regsvc')
const store = require('../lib/store')

function register(handle) {
  handle('reg:roots', async () => { /* 返回纯数据 */ })
}
module.exports = { register }
```

- `handle(channel, fn)` 会自动包成 `{ ok, data }` / `{ ok:false, message }`，**不要自己包**。
- 抛 `Error` 即视为失败，前端拿到 `message`。
- 通道名必须与 `electron/preload.js` 里已有的完全一致，**不得新增或改名**。

### 2.2 注册表读写

一律使用 `regsvc`，不要自己写 PowerShell：

```js
const regsvc = require('../lib/regsvc')

regsvc.parsePath('HKCU\\Environment')     // => { ok, root, sub, full, psPath }
regsvc.listSubKeys(fullPath)               // => [{ name, fullPath, hasChildren }]
regsvc.listValues(fullPath)                // => [{ name, type, value, binary, isDefault }]
regsvc.readTree(fullPath, { maxKeys })     // => { nodes:[{path,values}], truncated, scanned }
regsvc.createKey(parentPath, keyName, values)
regsvc.setValue(fullPath, name, type, value)
regsvc.deleteValue(fullPath, name)
regsvc.deleteKey(fullPath, { recursive })
regsvc.keyExists(fullPath)
regsvc.isAdmin()
regsvc.needsAdmin(fullPath)                // 是否需要管理员才能写
regsvc.envPaths()                          // { user, machine }
regsvc.buildRegText(nodes)                 // 生成 .reg 文本
regsvc.exportReg(nodes, file, { encoding })
regsvc.parseRegFile(file)                  // => { nodes, encoding, issues }
regsvc.previewRegImport(nodes, mode)
regsvc.applyRegImport(rows)                // 带事务回滚
regsvc.search(path, keyword, opts)
regsvc.broadcastRegistryChange()
regsvc.audit(action, detail)               // 写审计，category 自动为 registry
```

**关键约束**：写 `REG_EXPAND_SZ` 必须用 `regsvc.setValue(..., 'REG_EXPAND_SZ', ...)`，它内部用 `ExpandString`。自己写会降级成 `REG_SZ`。

### 2.3 审计日志

```js
store.appendAudit({
  origin: 'GUI',
  category: 'registry',        // 新模块统一用 registry / config / health / schedule
  action: 'registryCreateKey', // 见下表
  ...自定义字段
})
```

约定好的 action 名（前端按这些筛选，**不要自创**）：

| action | 含义 |
| --- | --- |
| `registryCreateKey` | 新建项 |
| `registryEditValue` | 编辑键值 |
| `registryDeleteValue` | 删除键值 |
| `registryDeleteKey` | 删除项 |
| `registryBackup` | 分支备份 |
| `registryRestore` | 备份恢复 |
| `registryRestoreRolledBack` | 恢复回滚 |
| `registryImportReg` | 导入 REG |
| `registryImportRolledBack` | 导入回滚 |
| `registryExportReg` | 导出 REG |
| `registryCompare` | 备份对比 |
| `registryDependency` | 依赖分析 |
| `registryWatchStart` / `registryWatchStop` | 监听启停 |
| `registryWatchEvent` | 捕获外部变更 |
| `registryBatchReplace` | 批量查找替换 |
| `registryFavorite` | 收藏夹增删改 |
| `configPackExport` / `configPackImport` | 全配置打包 |
| `healthScan` / `healthFix` | 健康诊断 |
| `scheduleCreate` / `scheduleUpdate` / `scheduleRemove` / `scheduleRun` | 定时任务 |

### 2.4 数据目录

全部走 `store`，不要自己拼路径：

```js
store.appDataDir()          // 用户数据根目录
store.ensureAll()
```

新增子目录约定：

| 目录 | 用途 |
| --- | --- |
| `<appData>/registryBackup/` | 注册表分支备份（.reg 与 .json） |
| `<appData>/registryBackup/watch/` | 监控日志 |
| `<appData>/configPack/` | 全配置打包 |
| `<appData>/health/` | 诊断报告与基线 |

`store.ensureAll()` 里需要补建目录的话，**在 reg-*.js 内自行 `store.ensureDir()`**，不要改 `store.js`。

### 2.5 前端约定

- 表格**必须**用 `@/components/wem-table/WemTable.vue`，props 见 `tableId / columns / rows / rowKey / loading / error / capabilities / batchActions / pageSize / rowClass`。
- 高危确认**必须**用 `@/components/dialogs/dialogService.js` 的导出方法，不要自己写 Modal：
  ```js
  import { confirmDanger, info } from '@/components/dialogs/dialogService'
  ```
  先读该文件确认实际导出名，只用已存在的。
- 主题：不要写死颜色。用 CSS 变量（`--wem-primary`、`--wem-card`、`--wem-border`、`--wem-text`、`--wem-text-2`、`--wem-text-3`）与 `html[data-theme='dark']` 覆盖。主色 `#165DFF`。
- 路由用 `createWebHashHistory`，跳转 `router.push('/registry')`。
- 状态用 Pinia（`src/store/`）。新 store 文件放在 `src/store/`，命名 `registry.js` / `health.js` / `schedule.js`。

### 2.6 请求方式

```js
import { api } from '@/api'
const res = await api.reg.values(path)
if (!res.ok) { /* res.message */ }
const data = res.data
```

**注意**：`api.reg.values(path)` 传单个参数时，主进程收到的就是 `path` 本身（不是对象）。多参数请传对象。

---

## 三、交付要求

1. 每个后端文件写完必须 `node --check` 通过。
2. 前端写完必须能通过 `node node_modules/vite/bin/vite.js build`（在 `env-manager/` 下，约 5 秒）。
3. **不要执行** `git commit`、`git push`、打包命令。
4. **不要修改** 上面标记「已冻结」「集成阶段统一改」的文件。
5. 交付时说明：新建了哪些文件、需要新增哪些路由、有哪些未完成的边界情况。
