# 安全说明

## 报告安全问题

如发现安全漏洞，**请不要通过公开 Issue 报告**，以免在修复前被利用。

请通过以下方式私下联系：

- 发送邮件至项目维护者（在 GitHub 个人主页可见）
- 或使用 GitHub 的 [Private vulnerability reporting](https://docs.github.com/zh/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) 功能

为便于定位，请尽量包含：

1. 受影响的版本号
2. 复现步骤
3. 影响范围（能否导致权限提升、数据泄露、任意代码执行）
4. 若可提供，附上最小复现环境

## 响应约定

| 阶段 | 目标时间 |
| ---- | ---- |
| 确认收到 | 7 天内 |
| 初步评估与影响判定 | 14 天内 |
| 修复版本发布 | 视严重程度，严重问题优先 |

修复发布后，若报告者同意，会在 Release 说明中致谢。

## 支持范围

仅对**最新发布版本**提供安全修复。历史版本不单独维护，建议升级至最新版。

## 本工具的安全边界

### 数据处理
- **不联网**。程序无遥测、无自动更新检查的网络请求，不上传任何环境变量内容。
- 全部数据保存在本地数据目录，路径见 [README](README.md#数据目录)。

### 权限模型
- 程序自身以 `asInvoker` 启动，**不自动提权**。
- 只有写入系统级环境变量需要管理员权限；未提权时该功能被禁用并提示，不会静默失败。
- 安装包（Inno Setup）以管理员权限运行，仅用于写入 ProgramFiles 与 HKLM 安装登记。

### 注册表写入范围
- `HKCU\Environment` — 用户环境变量
- `HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment` — 系统环境变量（需管理员）
- `HKLM\SOFTWARE\WinEnvManager` — 安装登记
- `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` — 仅在勾选开机自启时写入

写入 `Path` 时保持 `REG_EXPAND_SZ` 类型，不会被降级为 `REG_SZ`。

### 子进程执行
- 注册表读写通过 PowerShell `-EncodedCommand` 执行，脚本内容不经过 shell 拼接。
- 项目环境的启动前脚本在用户明确配置后才执行，属于用户自主行为。

### 安装包完整性
- 每次发布附带 `SHA256SUMS.txt`，请校验后再安装。
- 安装包**未做代码签名**，Windows SmartScreen 可能提示「未知发布者」。这是预期行为，不代表文件被篡改；请以 SHA256 校验结果为准。

## 不在安全范围内的情形

以下情况不作为安全漏洞处理：

- 用户以管理员权限运行后，自行写入破坏性的系统变量
- 用户导入来源不可信的配置文件
- 未能校验 SHA256 就运行来源不明的安装包
- 第三方修改版（非本仓库 Release 发布）
