# 贡献指南

感谢参与改进 WinEnv管家。本项目专注 Windows 环境变量管理，改动环境变量存在真实风险，因此合并标准偏保守。

## 分支模型

| 分支 | 用途 |
| ---- | ---- |
| `main` | 稳定正式版源码，**禁止直接提交** |
| `dev` | 日常开发，新功能在此累积 |
| `release/vX.Y.Z` | 发布候选，只接受 bug 修复 |

流程：

1. 从 `dev` 切出特性分支：`feat/简短说明` 或 `fix/简短说明`
2. 完成后向 `dev` 发起 Pull Request
3. 累积足够功能后，从 `dev` 拉 `release/vX.Y.Z`
4. 在 release 分支完成测试，合并到 `main`，再合并回 `dev`

## 提交信息

采用约定式提交，首行不超过 72 字符：

```
<类型>: <简短说明>
```

类型：

- `feat` 新功能
- `fix` 缺陷修复
- `perf` 性能优化
- `refactor` 重构（不改行为）
- `docs` 文档
- `build` 构建 / 打包
- `test` 测试

示例：

```
fix: 保存弹窗引用了未定义的 selected 导致只剩遮罩
feat: PATH 条目支持备注
```

## 代码约定

### 进程边界
- 渲染进程**不得**直接访问 Node API。
- 新增主进程能力时，三处必须同步修改：
  1. `env-manager/electron/ipc/*` — IPC 实现
  2. `env-manager/electron/preload.js` — 暴露接口
  3. `env-manager/src/api/index.js` — 前端调用与浏览器演示降级

漏改任一处会导致打包后功能不可用，但开发环境不报错。

### 注册表读写
- 统一使用 PowerShell `-EncodedCommand`，脚本内先设 `[Console]::OutputEncoding = UTF8`，回读按 UTF-8 解码。
- 不要解析 `reg.exe` 的文本输出，中文变量名会乱码。
- 写 `Path` 必须保持 `REG_EXPAND_SZ`：

```powershell
Set-ItemProperty -Type ExpandString   # 正确
[Environment]::SetEnvironmentVariable(..., 'Machine')   # 错误，会降级成 REG_SZ
```

### 前端状态
- 编辑只进 Pinia 内存，调用「保存写入系统」才落盘。
- 删除是标记待删除，提交时才真正执行。

### 主题
- 新增样式需同时覆盖 `html[data-theme]` 与 antd `darkAlgorithm`，只改一处会出现「样式变了但组件没变」。

## 测试要求

涉及环境变量读写的改动，**不得**用真实环境变量做测试。使用便携隔离目录：

```bash
cd env-manager
WEM_PORTABLE=1 PORTABLE_EXECUTABLE_DIR=/tmp/wem-test \
  node node_modules/electron/cli.js tools/test-adapt.js
```

要求：

- 提交前 106 项自测全部通过
- 测试结束确认真实 `config.json`、任务、日志、快照目录与环境变量未被改动
- 界面改动请附截图（`node node_modules/electron/cli.js tools/shot.js` 可批量生成）

## 图标资源

图标由脚本生成，**不要手工替换 ico/png**：

```bash
cd env-manager
python build/make_icon.py    # 生成全套图标并同步到各消费方
```

生成后确认以下文件哈希一致：

- `env-manager/build/icon.ico`
- `env-manager/public/icon.ico`
- `installer-web/pkg/WinEnvManager.ico`
- `bootstrapper/src-tauri/icons/icon.ico`

`tools/release-all.js` 会在打包前自动校验，不一致直接中止。

## 文档要求

- 功能变更必须同步更新 `CHANGELOG.md`
- Release 说明与 `CHANGELOG.md` 内容必须一致
- 新增配置项需在 README 的对应章节说明

## Issue 规范

提交缺陷时请包含：

- 版本号（关于页面可见）
- Windows 版本
- 是否以管理员身份运行
- 复现步骤与预期行为
- 相关日志（数据目录下 `logs\`）

**涉及系统环境变量的缺陷，请附上操作前的快照导出**，便于定位。
