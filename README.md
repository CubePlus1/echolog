# EchoLog

本地优先（local-first）的个人活动记录与复盘引擎——**给人用，也给 AI agent 用**。

用 `el` CLI 或 Web 控制台记录你在做什么（学习 / 项目 / 任务，支持多任务并行、暂停恢复、笔记与阻塞项）；macOS 上被动采样屏幕前台应用；每天自动汇总并生成 Markdown 日报。所有数据存在你自己的 PostgreSQL 里，不上传任何地方。

对 OpenClaw、Claude Code、Codex 等 agent，EchoLog 的设计目标是**开箱即被工具化**：CLI 就是工具面，`el --help` 就是工具说明书，`--json` 给出机器可读输出，错误一律非 0 退出码 + 结构化错误体。

## 功能

- **活动记录**：`start / stop / pause / resume / cancel`，类型 `learning | project | task`，标签、项目归属、结果总结；多任务并行
- **笔记**：给任意记录追加 `note | blocker | next`
- **补录与编辑**：`el add --at --for`、`el edit`
- **屏幕使用**（macOS）：每 5 秒采样前台应用，落成连续片段；分类规则在**查询时**计算——改规则即可追溯重分全部历史
- **汇总与日报**：今日/指定日汇总、日报 Markdown 生成、可同步到指定目录
- **提醒**（可选）：任务超时、空闲提醒、macOS 通知 + ntfy 推送到手机
- **三个界面，一套 REST API**：免构建的 Web 控制台、`el` CLI、HTTP API（`docs/API.md`）

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

```bash
el status --json          # 今日概览 + 活跃任务
el log --json -n 50       # 历史记录
el screen --json          # 今日屏幕使用（macOS）
```

## 配置

`config.yaml`（参考 `config.yaml.example`）：

| 段 | 说明 |
|---|---|
| `server` | 端口（默认 19827）、`apiKey`（本机豁免，非本机必带）、`serveWeb`（false = 纯 API 服务）、`corsOrigins`（跨源白名单，默认不允许跨源） |
| `database` | PostgreSQL 连接（与 docker-compose 默认值对应） |
| `tracker` | 屏幕采样开关与频率（仅 macOS） |
| `sync` | 日报 Markdown 同步目标目录 |
| `notifications` | macOS 通知、ntfy 推送、超时/空闲/日报提醒规则 |

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

```
web (vanilla JS, 免构建)  ─┐
                            ├─→  src/server (Fastify, /api/*)  ─→  src/core (领域逻辑, Drizzle + PostgreSQL)
src/cli (el, HTTP 瘦客户端) ─┘
```

一切能力沉在服务端：客户端不复刻推断/校验逻辑，新客户端（包括未来的 MCP 适配层）以 HTTP 瘦客户端形式接入即可。开发工作流由 [Trellis](.trellis/workflow.md) 管理，编码规范见 `.trellis/spec/`。

## License

[MIT](LICENSE)
