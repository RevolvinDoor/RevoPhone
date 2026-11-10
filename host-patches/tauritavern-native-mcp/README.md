# TauriTavern 原生 MCP 扩展接口补丁

此补丁与 RevoPhone 1.2.4 配套，基于当前工作区的 TauriTavern 2.4.0 源码。**这是源码补丁，不是可安装的宿主更新。仅更新 RevoPhone 不能让已安装的 TauriTavern 获得 Rust commands。**

## 改动

新增正式 Project Contract：`window.__TAURITAVERN__.api.mcp.remote`（version 1）。

- `discover({endpoint, headers?, protocolVersion?})`：原生发现完整工具目录。
- `call({connection, nativeName, argumentsJson}, {signal?})`：原生执行工具，返回已有 KnownResponse/NotSent/OutcomeUnknown DTO。
- 连接信息和 OAuth headers 每次临时传入，不创建注册项、不写入目录或凭据文件、不发布给 Agent/Legacy。
- 复用现有 `McpService`、`McpGateway`、HTTP pool、取消 registry 和结果转换。管理器 testCall 共用取消与参数校验，原有权限语义保留。没有 Fish 专用 Rust 网络实现。

RevoPhone 在 TauriTavern 中只使用这条原生路径。旧宿主会提示缺少接口，不再尝试会被官方 Origin 检查拒绝的网页调用。OAuth 登录和刷新仍由 RevoPhone 管理，现有角色和播放器继续使用。

## 应用与构建

本工作区的 TauriTavern 源码已经应用这些修改；不要再向同一份已修改的源码重复应用补丁。以下命令供另一份匹配基线的干净源码使用：

```powershell
git apply --check --ignore-space-change <补丁文件的绝对路径>
git apply --ignore-space-change <补丁文件的绝对路径>
pnpm install --frozen-lockfile
pnpm run check
pnpm run tauri:build:portable
```

补丁文件是本目录的 `tauritavern-2.4.0-mcp-remote.patch`。`baseline.json` 记录所依据源文件的 SHA-256；版本相同但源码不同时应先审阅差异。Windows 构建需要项目要求的 Rust/Cargo、MSVC/Windows SDK 等构建环境；其他平台沿用宿主已有构建入口。

重建并安装宿主后，更新 RevoPhone 至 1.2.4，保留或重新完成 Fish 授权，再点「刷新工具信息」。页面应显示“MCP 请求由 TauriTavern 原生客户端发送”，之后才测试短句生成与积分扣减。

## 本次验证与限制

- 宿主 MCP 前端契约测试通过，覆盖取消、输入快照和原生结果保留；新增 Rust 用例检查临时授权不写入注册项和大整数不被改写。
- 宿主 `pnpm run check` 已通过平台身份、前端约束、TypeScript、Lint 和日志边界阶段，在 Rust 边界检查处因本机缺少 `cargo` 停止。Rust 用例、Clippy、Rust 编译和安装包构建均未完成。
- RevoPhone 相关模拟测试通过，覆盖原生路由、旧宿主无接口时停止、下载不携带 Bearer、未知付费结果不重试。
- 未安装或替换用户正在运行的宿主，未操作 Android 实机，未使用用户账户或积分生成语音；真实原生请求与扣费验收仍待重建后的宿主完成。
