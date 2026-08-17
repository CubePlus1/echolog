# EchoLog

本地优先（local-first）的个人活动记录与复盘引擎——**给人用，也给 AI agent 用**。

用 `el` CLI 或 Web 控制台记录你在做什么（学习 / 项目 / 任务，支持多任务并行、暂停恢复、笔记与阻塞项）；macOS 上被动采样屏幕前台应用；每天自动汇总并生成 Markdown 日报。所有数据存在你自己的 PostgreSQL 里，不上传任何地方。

对 OpenClaw、Claude Code、Codex 等 agent，EchoLog 的设计目标是**开箱即被工具化**：CLI 就是工具面，`el --help` 就是工具说明书，`--json` 给出机器可读输出，错误一律非 0 退出码 + 结构化错误体。

![EchoLog Web 控制台封面：回声志](docs/images/echolog-web-cover.jpg)

## 功能

- **活动记录**：`start / stop / pause / resume / cancel`，类型 `learning | project | task`，标签、项目归属、结果总结；多任务并行
- **父子任务**：一个大任务可挂多层小任务；服务端防止自指/成环，CLI 与 Web 可创建、查询并查看直接子任务进度
- **笔记**：给任意记录追加 `note | blocker | next`
- **补录与编辑**：`el add --at --for`、`el edit`
- **内置插件**：screen-time 采样和追溯分类前台应用；tmux-status 通过外部 CLI 提供结构化 pane/资源观测，并以 v3 合约持久化已验证的 Agent conversation↔pane 恢复映射
- **汇总与日报**：今日/指定日汇总、日报 Markdown 生成、可同步到指定目录
- **提醒**（可选）：任务超时、空闲提醒、macOS 通知 + ntfy 推送到手机
- **四个入口，一套 REST API**：免构建的 Web 控制台、`el` CLI、本地 stdio MCP、HTTP API（`docs/API.md`）

## 快速开始

要求：Node.js ≥ 22、pnpm、Docker（跑 PostgreSQL）。

```bash
git clone https://github.com/CubePlus1/echolog.git && cd echolog
pnpm install
docker compose up -d                 # PostgreSQL 16，本机端口 5436
cp config.yaml.example config.yaml   # 按需改；apiKey 建议 openssl rand -hex 24
pnpm migrate                         # 建表
pnpm build
node dist/server/app.js              # 或开发模式 pnpm dev
```

打开 `http://localhost:19827` 即可看到 Web 控制台。

把 CLI 放进 PATH（任选其一）：

```bash
# 方式一：wrapper（推荐，重新 build 不用重装）
printf '#!/bin/sh\nexec node %s/dist/cli/index.js "$@"\n' "$PWD" | sudo tee /usr/local/bin/el >/dev/null
sudo chmod +x /usr/local/bin/el

# 方式二：直接用
node dist/cli/index.js status
```

```bash
el start "读《史记》三十页" --type learning -t 读书
el start "整理人物关系" --parent <父任务id>
el subtasks <父任务id>          # 直接子任务 + 完成进度
el note "卡在第三章" -b        # 给唯一活跃任务加阻塞项，无需 id
el stop -n "读毕，摘记三条"
el today
el report                        # 输出日报 Markdown
```

## 给 AI Agent 用

**约定**（详见仓库根的 [AGENTS.md](AGENTS.md)，agent 可直接读取）：

- 工具面 = `el` CLI。`el --help` 与各子命令 `--help` 包含语义、参数取值枚举、时间格式与示例，按工具说明书标准编写
- 机器可读：所有命令支持 `--json`，输出 API 原始 JSON，不二次包装
- 退出码契约：成功 0；连接失败 / 校验失败 / 404 / 409 等一律非 0，错误走 stderr 或 JSON 错误体 `{"error", ...}`
- 省略 id 的 `stop/pause/resume/note/cancel` 由**服务端**匹配唯一活跃记录；歧义时返回 409 和候选列表 `{"error", "candidates":[{id,title,status}]}`，按提示带 id 重试
- 无 shell 的 agent 可直接走 HTTP API（[docs/API.md](docs/API.md)）；跨机器访问带 `X-API-Key`
- 支持 MCP 的本机 agent 可注册 `el mcp`；工具清单、错误契约与 Codex 配置见 [MCP Server](docs/MCP.md)

```bash
el status --json          # 今日概览 + 活跃任务
el log --json -n 50       # 历史记录
el screen --json          # 今日屏幕使用（macOS）
el plugins list --json    # 内置插件清单与状态
el tmux status --json     # tmux-status 原始快照（插件默认禁用）
```

### Codex 集成

仓库提供一个可安装的 Codex Plugin 包：`integrations/codex/echolog`。它组合显式写入的 `$echolog:track-work`、只读复盘的 `$echolog:review-work` 和自动注册的本地 `el mcp`（8 个类型化工具）；standalone Skill 则使用无前缀名称，也保留手动 MCP 注册方式。Skills 与 MCP 都只经 HTTP API 访问 daemon，不直连数据库，也不复制服务端的唯一活跃记录和父子关系判断。

该 Codex Plugin 与 EchoLog Core 的 Bundled Plugin API v1 是不同层次：前者运行在 Codex 侧，后者运行在 EchoLog 服务内。personal marketplace 安装/更新、支持范围、前置条件与隐私边界见 [Codex Integration](docs/CODEX.md)。

## 配置

`config.yaml`（参考 `config.yaml.example`）：

| 段 | 说明 |
|---|---|
| `server` | 端口（默认 19827）、`apiKey`（本机豁免，非本机必带）、`serveWeb`（false = 纯 API 服务）、`corsOrigins`（跨源白名单，默认不允许跨源） |
| `database` | PostgreSQL 连接（与 docker-compose 默认值对应） |
| `plugins.screen-time` | 屏幕采样开关、频率与空闲阈值（默认启用） |
| `plugins.tmux-status` | 外部 executable、超时、采样频率、异常阈值，以及 v3 Agent conversation↔pane 恢复映射（默认禁用） |
| `sync` | 日报 Markdown 同步目标目录 |
| `notifications` | macOS 通知、ntfy 推送、超时/空闲/日报提醒规则 |

`el` 默认读取 EchoLog 安装根目录的 `config.yaml`，不会误读当前 Codex 工作目录中其他项目的同名文件。测试或多实例部署需要替代配置时，显式设置 `ECHOLOG_CONFIG_PATH=/absolute/path/to/config.yaml`。

## 常驻运行（macOS launchd 示例）

```xml
<!-- ~/Library/LaunchAgents/com.echolog.daemon.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.echolog.daemon</string>
  <key>ProgramArguments</key><array>
    <string>/usr/local/bin/node</string><string>dist/server/app.js</string>
  </array>
  <key>WorkingDirectory</key><string>/path/to/echolog</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/echolog.stdout.log</string>
  <key>StandardErrorPath</key><string>/tmp/echolog.stderr.log</string>
</dict></plist>
```

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.echolog.daemon.plist
# 更新代码后：pnpm build && launchctl kickstart -k gui/$(id -u)/com.echolog.daemon
```

## 架构

```text
Web Shell / el CLI / el mcp
        |
     HTTP API
        |
EchoLog Core (records, notes, subtasks, reports, sync)
        |
Bundled Plugin API v1
        |-- screen-time
        `-- tmux-status -> external tmux-status executable

Codex Plugin Skills -> el --json ---------^
Codex MCP host ------> el mcp ------------^
```

一切能力沉在服务端：客户端不复刻推断/校验逻辑；CLI、Web 和 MCP 都以 HTTP 瘦客户端形式接入。开发工作流由 [Trellis](.trellis/workflow.md) 管理，编码规范见 `.trellis/spec/`。

插件协议、信任边界、manifest、生命周期、迁移和错误码见
[Bundled Plugin API v1](docs/PLUGIN_API.md)。

## Web 书卷

Web 控制台是免构建的原生 JavaScript 3D 书。当前自然月固定分为四册：1–7 日、8–14 日、15–21 日、22 日至月底；此前每个自然月是一册。打开控制台时默认进入包含今天的册，目录和下方时间轴都可切换书册。

每册只挂载当前页附近的少量 sheet，历史书册按选择后加载到页面；键盘、滚轮、拖动、目录跳转、父子任务跳转、进行中任务操作和插件页面保持可用。实时循环只更新进行中任务、今日摘要和插件的 live 数据，历史记录在结构变化或写操作后刷新。

## 插件设计与功能

EchoLog Core 通过 Bundled Plugin API v1 托管内置插件。每个插件由 manifest 标识，独立注册路由、定时任务、迁移、配置校验、健康检查和 Web 资源；插件初始化、迁移或采集失败会将对应插件置为 degraded，不阻断 Core 启动或主动记录。插件 Web 模块只能通过宿主提供的同源 HTTP API 读写数据，不能直连数据库。

- **screen-time**：macOS 前台应用被动采样；按应用和规则聚合今日屏幕使用，Web 可查看分类、维护分类规则，并提供运行时 screen-understanding settings 的版本化 GET/PUT API。历史 `app_usage`、`app_rules` 数据保持兼容。
- **tmux-status**：调用外部 `tmux-status` CLI 获取结构化 pane、资源和状态观测；支持 v1/v2/v3 兼容解析、资源边界校验、幂等同步和已验证的 Agent conversation↔pane 恢复映射。插件默认关闭；不把 CPU、selected pane、进程存活或 pane 前台状态直接当作有效工时，也不保存 prompt、回复正文或 pane 内容。

插件清单、生命周期、路由、迁移、Web 贡献和错误处理详见 [Bundled Plugin API v1](docs/PLUGIN_API.md)。Codex 侧的 `$echolog:track-work`、`$echolog:review-work` 和本地 stdio MCP 是独立的集成层，说明见 [Codex Integration](docs/CODEX.md)。

## License

[MIT](LICENSE)
