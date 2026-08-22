# EchoLog Agent README

> 本文件是 AI Agent 的产品运行手册。若你要修改 EchoLog 源码，还必须先读取仓库根的 [`AGENTS.md`](AGENTS.md) 和 `.trellis/workflow.md`。

## 目标与边界

EchoLog 是本地优先的活动记录与复盘服务。Agent 的首选工具面是 `el` CLI；支持 MCP 时可使用 `el mcp`；没有 shell 时才直接调用 HTTP API。CLI、MCP 和 Web 都是 HTTP 客户端，不得绕过 daemon 直连 PostgreSQL 或 import Core 内部模块。

所有记录、配置和识别结果保存在用户自己的 PostgreSQL。screen-understanding 原始截图只在一次请求期间存在并在 `finally` 中删除；数据库不保存 PNG、完整 prompt、模型原始响应或 API key。Provider API key 只保存在当前 macOS 用户的 Keychain。

## 选择安装路径

### v0.2.0 macOS arm64 发布包

主资产 `echolog-v0.2.0-macos-arm64-adhoc.tar.gz` 已包含源码、`dist`、锁定依赖和 `EchoLogScreenCapture.app`，不需要重新编译：

```bash
tar -xzf echolog-v0.2.0-macos-arm64-adhoc.tar.gz
cd echolog-v0.2.0-macos-arm64
cp config.yaml.example config.yaml
docker compose up -d
pnpm migrate
node dist/server/app.js
```

前置条件：Apple Silicon、macOS 14+、Node.js 22、pnpm、Docker。App 是经过严格验证的 ad-hoc 签名资产，未经过 Apple notarization；首次运行可能需要人类用户在系统设置中允许。Agent 不得绕过 Gatekeeper、修改 TCC 数据库或代替用户静默授予屏幕录制权限。

读取包内 `RELEASE-MANIFEST.json` 和 Release 同目录的 `SHA256SUMS` 后再运行。若 manifest 的 Swift 测试状态为 `skipped-xctest-unavailable`，表示打包机只有 Command Line Tools、没有完整 Xcode 的 `XCTest.framework`；这不等于测试通过，应结合 App 的 codesign、版本、架构、`status --json` 以及 Node 集成测试证据判断。

### Git 源码

```bash
git clone https://github.com/CubePlus1/echolog.git
cd echolog
pnpm install --frozen-lockfile
docker compose up -d
cp config.yaml.example config.yaml
pnpm migrate
pnpm build
node dist/server/app.js
```

portable `pnpm build` 不编译 Swift helper。macOS 本机测试可显式执行：

```bash
ECHOLOG_MACOS_ADHOC_SMOKE=1 pnpm build:macos-capture
```

## 启动后验证

```bash
curl --fail --silent http://localhost:19827/api/health
node dist/cli/index.js daemon status --json
node dist/cli/index.js plugins list --json
node dist/cli/index.js plugins doctor --json
```

若已把 wrapper 放进 `PATH`，后续使用 `el` 代替 `node dist/cli/index.js`。先读 `el --help` 和目标子命令的 `--help`；它们是参数、枚举、时间格式和示例的权威工具说明。

## CLI 契约

- 所有业务命令使用 `--json`，成功输出 API 原始 JSON，不做二次包装。
- 成功退出码为 0；连接、校验、404、409、插件诊断失败等均为非 0。
- JSON 错误体至少包含 `{"error":"..."}`，并可能带 `code`、`candidates`、`currentVersion` 等恢复信息；不要丢弃这些字段。
- `stop/pause/resume/note/cancel` 可省略 id，由服务端匹配唯一活跃记录。收到 409 与 `candidates` 时展示候选并请用户选择，禁止猜测。
- 不要把普通编码任务自动记录进 EchoLog。只有用户明确要求记录/修改，或显式调用 `$echolog:track-work` 时才执行写操作。

常用只读命令：

```bash
el status --json
el today --json
el log --json -n 50
el screen --json
el screen understanding latest --json
el screen understanding history --limit 20 --json
el plugins list --json
el plugins doctor --json
```

显式写入示例：

```bash
el start "实现 EchoLog 功能" --type project --json
el note <record-id> "完成 API 验证" --json
el stop <record-id> -n "实现和测试完成" --json
```

## MCP

本地 MCP server 由 `el mcp` 以 stdio 启动，仍然只通过 HTTP 访问 daemon。详细工具清单和 Codex 配置见 [`docs/MCP.md`](docs/MCP.md) 与 [`docs/CODEX.md`](docs/CODEX.md)。MCP 错误使用 `isError: true`，JSON text content 保留原始 API 字段。

## 配置 screen-understanding

screen-understanding 默认关闭。最安全的路径是让人类用户打开 `http://localhost:19827/screen-understanding.html`，在 Web 中完成：

1. 创建 OpenAI-compatible vision Provider；
2. 在本机 Keychain 保存 API key；
3. 测试截图并由用户授予屏幕录制权限；
4. 选择 Provider、设置周期/预算后启用；
5. 执行一次“立即识别”并检查结构化中文结果。

Agent 可以读取状态和结果：

```bash
el screen understanding settings --json
el screen understanding run --json
el screen understanding latest --json
el screen understanding history --limit 20 --json
```

Provider、Keychain、settings 和 capture test 的完整 HTTP 契约见 [`docs/API.md`](docs/API.md)。关键限制：

- Key 写入/删除、截图测试、立即识别和历史删除只允许 loopback 请求；
- daemon 永远不能调用 `request-permission`，权限必须由交互式用户动作触发；
- settings 更新是带 `expectedVersion` 的全量替换；409 时读取 `currentVersion` 后重新决策，不能盲目覆盖；
- 启用识别前必须选择存在且已有 Keychain 密钥的 Provider；
- 原始截图不得落盘、记录、转发或附在 Agent 回复中，除非用户明确要求处理当前预览且符合其隐私意图。

## 故障恢复顺序

```bash
curl --fail --silent http://localhost:19827/api/health
tail -n 100 /tmp/echolog.stderr.log
docker compose up -d
pnpm build
launchctl kickstart -k gui/$(id -u)/com.echolog.daemon
el plugins doctor --json
```

- health 失败：先看 daemon stderr；数据库错误时启动 `echolog-db` 后重启 daemon。
- CLI 行为与源码不同：通常是 `dist` 过期，重新 `pnpm build` 后重启。
- `CAPTURE_PERMISSION_REQUIRED`：请用户在系统设置里给 `EchoLog Screen Capture` 授权；不要编辑 TCC 数据库。
- Provider/Keychain 错误：保留结构化 `code`，不要输出 API key、远端响应正文或配置秘密。
- 单个插件 degraded 不应拖垮 Core；仍可继续使用主动记录功能并报告插件诊断。

## 权威资料

- HTTP API：[`docs/API.md`](docs/API.md)
- MCP 与错误形状：[`docs/MCP.md`](docs/MCP.md)
- Codex Plugin：[`docs/CODEX.md`](docs/CODEX.md)
- Bundled Plugin API：[`docs/PLUGIN_API.md`](docs/PLUGIN_API.md)
- 贡献与本机运行规则：[`AGENTS.md`](AGENTS.md)
