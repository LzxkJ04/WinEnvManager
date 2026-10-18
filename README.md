# WinEnv管家

> Windows 环境变量与开发环境一体化管理工具。本地运行，不联网，所有变更留痕。

WinEnv管家用于集中管理用户级与系统级环境变量、PATH 条目、开发工具环境，并提供快照备份、事务级回滚与全量审计。界面基于 Electron + Vue 3，全部操作经鼠标完成，无快捷键依赖。

当前版本：**v1.1.0**

---

## 功能

### 环境变量管理
- 用户变量与系统变量统一视图，覆盖关系可直观识别
- 僵尸变量检测、断链引用检测、PATH 有效性校验
- 编辑只进草稿，点击「保存写入系统」才落盘，避免误改

### PATH 专项管理
- 拖拽排序、批量去重、逐条启用/禁用
- 每条路径可加备注，支持导出 CMD / PowerShell 脚本

### 快照与回滚
- 快照自带 SHA256 完整性校验，篡改可被发现
- 恢复走事务：任一项失败自动反向回滚，回滚仍失败则按临时快照补写
- 差异对比支持两份快照之间、快照与当前环境之间

### 环境配置集
- 一键切换多套变量组合，支持互斥组（同组只能激活一套）
- 适合 JDK / Python / Node 多版本切换场景
- 可绑定项目文件夹，进入目录时提示加载

### 项目环境
- 绑定项目目录，启动终端时注入变量，仅对当前进程生效，不写注册表
- 支持启动前脚本（CMD / PowerShell / Windows Terminal）
- 可选读取项目内 `.env`

### 批量导入导出
- 支持 reg / json / env / properties 格式
- `.env` 可视化字段映射，保存为导入模板
- 敏感变量脱敏导出

### 其他
- 全局跨页搜索：变量、配置集、快照、审计日志、工具箱
- 变更审计：只记录「写入系统」的变更，软件内无删除入口
- 完整深色 / 浅色 / 跟随系统主题
- 命令行模式：`WinEnvManager.exe --cli list|get|set|path-check`（不启动界面，与运行中的窗口互不干扰）

### 注册表管理
- 可视化浏览 HKCR / HKCU / HKLM / HKU，树节点异步加载
- 环境变量所在分支（`HKCU\Environment`、`HKLM\...\Session Manager\Environment`）自动高亮标记，支持一键定位
- 键值完整支持 REG_SZ / REG_EXPAND_SZ / REG_MULTI_SZ / REG_DWORD / REG_QWORD / REG_BINARY
- 写 `REG_EXPAND_SZ` 保持类型不降级；HKLM 分支未提权时自动只读保护
- 注册表分支备份（原生 `.reg` 或带 SHA256 校验的自定义 JSON）、事务化恢复（失败自动回滚）
- 两备份对比 / 与当前状态对比，差异按新增 / 修改 / 删除三色标记，可导出 HTML / CSV 报告
- `%VAR%` 依赖分析：识别无效引用与循环引用，反向查找引用某变量的全部注册表项
- 变更监控：轮询监听指定分支，区分「本软件」与「外部」来源
- 批量查找替换：仅字符串类型，强制预览 + 勾选 + 自动备份
- 注册表收藏夹：内置环境变量预设，支持分组管理与导入导出

### 环境健康诊断
- 一键扫描 9 类问题：PATH 重复 / 路径不存在 / 格式异常、无效引用、循环引用、注册表键值类型异常、互斥组冲突、项目文件夹丢失、工具路径失效
- 0~100 健康评分与分级统计，生成 HTML / Markdown 诊断报告
- **预览式修复**：先展示变更清单，用户确认后执行，执行前自动备份

### 定时任务
- 依托 Windows 任务计划程序，软件关闭仍可触发
- 支持四类**只读/备份**任务：系统环境快照、注册表分支备份、审计日志导出、健康诊断
- 修改类操作（变量/注册表写入）**禁止**定时执行，后端强校验

### 全软件配置打包
- 一键打包软件自身全部自定义配置（设置、视图预设、识别规则、配置集、项目、收藏夹等）
- 支持密码加密，manifest 记录版本与模块清单并附 SHA256
- 导入支持覆盖 / 合并 / 仅选中模块，导入前自动备份当前配置

---

## 安装

### 方式一：安装包（推荐）
1. 下载 [WinEnvManager-Setup-1.1.0.exe](https://github.com/LzxkJ04/WinEnvManager/releases/latest/download/WinEnvManager-Setup-1.1.0.exe)
2. 双击运行，按向导完成安装
3. 默认安装位置 `C:\Program Files\WinEnvManager`

安装包特性：
- 程序本体装入 ProgramFiles
- 用户数据目录（配置 / 快照 / 日志 / 审计）默认 `%LOCALAPPDATA%\WinEnvManager`，安装时可自定义
- 可选组件：命令行工具、内置规则模板、快速上手文档
- 可选任务：桌面快捷方式、`.winenv-setting` 关联、右键菜单、开机自启

### 方式二：便携版
下载 [WinEnvManager-Portable-1.1.0.zip](https://github.com/LzxkJ04/WinEnvManager/releases/latest/download/WinEnvManager-Portable-1.1.0.zip)，解压后双击其中的 exe 直接运行，无需安装。

便携模式下用户数据跟随程序所在目录（`UserData\` 子目录），不读注册表安装信息，适合放在 U 盘或多机使用。

### 方式三：安装向导
[WinEnvManager-Wizard-1.1.0.exe](https://github.com/LzxkJ04/WinEnvManager/releases/latest/download/WinEnvManager-Wizard-1.1.0.exe) 是带前置检查的图形化封装：
- 自动检测 Windows 版本、管理员权限、WebView2、磁盘空间、运行中进程
- 支持一键修复 / 更改安装选项 / 卸载
- 后台静默调用安装引擎，无需人工干预

> 全部制品见 [Releases](https://github.com/LzxkJ04/WinEnvManager/releases/latest)，附 `SHA256SUMS.txt` 供校验。

---

## 权限说明

| 操作 | 是否需要管理员 |
| ---- | ---- |
| 读取用户变量 | 否 |
| 读写用户变量 | 否 |
| 读取系统变量 | 否 |
| 写入系统变量 | **是** |
| 快照、备份、配置集 | 否 |

未以管理员身份运行时可正常查看全部内容，写入系统级变量时会提示权限不足并禁止该部分勾选，不会静默失败。

---

## 数据目录

解析优先级：

1. **便携模式**：程序所在目录下 `UserData\`
2. **安装模式**：读取安装登记 `HKLM\SOFTWARE\WinEnvManager\UserDataRoot`，即安装时选定的目录
3. **兜底**：`%APPDATA%\win-env-manager`

目录内含：

```
config.json        程序配置
snapshots\         变量快照（支持 gzip 压缩）
logs\              运行日志（按份数与天数清理）
audit\             审计日志（按月分文件）
config-backups\    配置备份
cache\             扫描缓存
```

---

## 风险提示

**修改系统环境变量会影响整台机器。** 请阅读以下内容后再操作。

1. **务必先创建快照**。高危操作（批量删除、重置 PATH）前，程序会要求二次确认，但确认不代表可以撤销。
2. **PATH 被改坏可能导致软件无法启动**。建议保留一份可用的 PATH 备份，并了解系统恢复方式。
3. **项目环境的终端变量只在当前终端进程内有效**，关闭终端即销毁，不会污染全局环境。这是设计如此，不是缺陷。
4. **便携版不会写入系统级内容**，但读取系统变量仍然生效。
5. **本工具不联网**，不上传任何环境变量内容。敏感变量可使用脱敏导出。
6. 卸载默认**保留**用户数据目录（含快照与备份），需要清理请手动删除，或在卸载时勾选删除用户数据。

---

## 本地构建

环境要求：Node.js 18+、Python 3（仅用于生成图标）、Inno Setup 6+（仅打包安装包）、Rust 工具链（仅构建安装向导）。

```bash
# 渲染端构建
cd env-manager
npm install
node node_modules/vite/bin/vite.js build

# 生成全套图标（可选，图标已入库）
python build/make_icon.py

# 仅打便携版
node node_modules/electron-builder/cli.js --win portable --x64

# 完整发布链路：渲染端 → 便携版 → 安装包 → 安装向导
node tools/release-all.js
```

自测（不写入真实环境变量）：

```bash
# 106 项适配性自测，需便携隔离目录
WEM_PORTABLE=1 PORTABLE_EXECUTABLE_DIR=/tmp/wem electron tools/test-adapt.js
```

---

## 已知限制

- 仅支持 Windows x64，无 macOS / Linux 版本
- 安装包未做代码签名，Windows SmartScreen 可能提示「未知发布者」，选择「更多信息 → 仍要运行」即可
- `wenv.exe` 命令行工具当前只提供编译产物，源码暂未纳入本仓库
- 界面文案以简体中文为主，切换英文只影响组件语言（分页、日期、空状态）

---

## 文档

- [更新日志](CHANGELOG.md)
- [安全说明](SECURITY.md)
- [贡献指南](CONTRIBUTING.md)
- [发布流程](docs/RELEASE.md)

---

## 许可

[MIT](LICENSE)
