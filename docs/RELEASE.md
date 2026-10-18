# 发布流程

面向维护者的完整发布规范。目标产出：版本标签、GitHub Release、可下载制品、更新日志、发布说明、SHA256 校验文件。

全程区分 **beta 内测版** 与 **正式稳定版**。

---

## 0. 发布前检查清单

以下各项必须全部完成，任一项不满足则不得发布。

### 0.1 分支准备

1. `main` 只存稳定正式版源码，**禁止直接提交**
2. `dev` 承载日常迭代
3. 发布前从 `dev` 拉出 `release/vX.Y.Z`
4. 在 release 分支完成最终测试，bug 修复只合入该分支
5. 测试通过后：`release/vX.Y.Z` → `main`，同时合回 `dev`

### 0.2 版本号

语义化版本 `主版本.次版本.修订号`：

| 位 | 触发条件 |
| -- | -------- |
| 主版本 | 重大重构、不兼容变更 |
| 次版本 | 新增功能 |
| 修订号 | 缺陷修复、小优化 |

预发布后缀 `-beta1` 表示内测版。

**版本号必须四处同步修改，漏一处会导致安装登记与实际版本不一致：**

- `env-manager/package.json` → `version`
- `installer-web/setup.iss` → `#define MyAppVersion`
- `bootstrapper/src-tauri/tauri.conf.json` → `version`
- `bootstrapper/src-tauri/Cargo.toml` → `version`

### 0.3 打包

在 release 分支执行：

```bash
cd env-manager
node tools/release-all.js
```

链路：渲染端构建 → 便携版 → 同步安装载荷 → Inno 安装包 → Rust 安装向导 → 复制到项目根。

产出物：

| 文件 | 说明 |
| ---- | ---- |
| `env-manager/out-release/WinEnvManager-<ver>-portable.exe` | 便携版单文件 |
| `installer-web/output/WinEnvManager-v<ver>-setup.exe` | Inno 安装包 |
| `WinEnvManager-v<ver>-安装向导.exe` | 图形化安装向导 |

### 0.4 校验项

- [ ] 深色 / 浅色 / 跟随系统主题切换正常
- [ ] 安装目录逻辑：程序装 ProgramFiles，用户数据在自定义目录
- [ ] 管理员提权逻辑：未提权时系统变量写入被禁用并提示
- [ ] 核心功能冒烟：变量读写、快照、配置集互斥组、项目环境、`.env` 导入、软件识别规则
- [ ] 卸载流程：确认不删除用户数据目录内的快照与备份
- [ ] 图标一致性（`release-all.js` 会自动校验，需通过）
- [ ] 四个 exe 的任务栏图标为最新版本

### 0.5 制品标准化与校验文件

```bash
node tools/release-package.js
```

该脚本会：

1. 按规范重命名制品为 `WinEnvManager-Setup-X.Y.Z.exe` / `WinEnvManager-Portable-X.Y.Z.zip`
2. 生成便携 zip（程序本体 + 默认配置，用户数据外置）
3. 生成 `SHA256SUMS.txt`

输出目录：`release-out/vX.Y.Z/`

### 0.6 文档确认

仓库根目录需存在且为最新：

- `README.md` — 简介、功能、安装、使用、权限、风险提示
- `CHANGELOG.md` — 按版本倒序
- `LICENSE`
- `SECURITY.md` — 安全说明与漏洞反馈渠道
- `CONTRIBUTING.md` — 贡献指南
- `docs/` — 设计文档与发布文档

---

## 1. 创建标签

```bash
git checkout main
git pull
git tag -a vX.Y.Z -m "WinEnv管家 vX.Y.Z"
git push origin vX.Y.Z
```

规范：

- 标签**必须带 `v` 前缀**，GitHub Release 依赖此识别版本
- beta 版示例：`v1.0.0-beta1`

---

## 2. 创建 GitHub Release

1. 仓库主页 → 右侧 **Releases** → **Create a new release**
2. 选择刚推送的 tag
3. 标题：`WinEnv管家 vX.Y.Z`
4. 目标分支：`main`
5. 版本类型：
   - beta 内测版 → **勾选** Pre-release
   - 正式稳定版 → 不勾选，并勾选 **Set as latest release**

### 发布说明模板

```markdown
# WinEnv管家 vX.Y.Z

## 新增功能
- 条目

## 优化
- 条目

## Bug 修复
- 条目

## 下载制品
| 文件 | SHA256 |
| ---- | ------ |
| WinEnvManager-Setup-X.Y.Z.exe | 粘贴哈希 |
| WinEnvManager-Portable-X.Y.Z.zip | 粘贴哈希 |

> 校验方式见文末。

## 重要提示
1. 修改**系统环境变量需要管理员权限**，高危操作建议先创建系统快照备份。
2. 项目环境的终端注入变量仅存活于当前终端进程，关闭终端即销毁，不写入系统全局环境。
3. 用户数据（快照、配置、缓存）默认位于 `%LOCALAPPDATA%\WinEnvManager`，安装包本体位于 ProgramFiles。
4. 安装包未做代码签名，SmartScreen 可能提示「未知发布者」，请以 SHA256 校验为准。

## 文档
- [完整文档](README.md)
- [更新日志](CHANGELOG.md)
```

### 上传附件

拖拽上传 `release-out/vX.Y.Z/` 下的全部制品：

- `WinEnvManager-Setup-X.Y.Z.exe`
- `WinEnvManager-Portable-X.Y.Z.zip`
- `SHA256SUMS.txt`

**不要上传源码压缩包**，GitHub 会自动生成。

---

## 3. 发布前最终校验

- [ ] 页面排版、图片链接、附件可下载
- [ ] 版本号与哈希值正确
- [ ] Pre-release 勾选状态正确
- [ ] 风险提示文案完整
- [ ] Release 说明与 `CHANGELOG.md` 一致

确认无误 → **Publish release**。

---

## 4. 发布后

1. 在 Discussion 新建版本讨论帖，收集反馈与缺陷报告
2. 监控 Issues，归类到下一个迭代
3. 归档或删除 `release/vX.Y.Z`（按仓库策略，建议保留至下一版本发布）
4. 更新项目看板，标记本次迭代完成

---

## 版本维护

| 场景 | 策略 |
| ---- | ---- |
| 严重 bug | 在 `main` 修复，打修订版 tag（如 `v1.0.1`）发补丁 Release |
| 功能迭代 | 在 `dev` 累积，足够后新建 release 分支 |
| 历史旧版 | 不维护，建议用户升级 |

---

## 规范约束

1. Release 附件只放编译制品，**不上传源码压缩包**
2. 所有变更必须写入 `CHANGELOG.md`，Release 正文不得与之冲突
3. 正式版发布前必须完成完整冒烟测试；beta 版标注 Pre-release
4. 每次发布强制附带 SHA256 校验文件

---

## beta 版简化流程

1. 在 `dev` 分支直接打标签 `vX.Y.Z-betaN`
2. 创建 Release，勾选 Pre-release
3. 说明中写明：**内测版本，仅供测试，不建议生产环境使用**
4. 收集反馈并修复，稳定后合并到 `main` 发布正式版

---

## 回滚流程

发布后发现严重故障时：

1. 编辑该 Release，在正文**顶部加警告**说明问题与影响范围
2. 新建补丁版本修复，发布 `vX.Y.Z+1`
3. 必要时下架该版本附件
4. 在 Discussion 与 Issues 公示故障情况与修复进展

**不建议**直接删除 Release 或强制移动 tag，会导致已下载用户无法追溯。
