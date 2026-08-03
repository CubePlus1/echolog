# EchoLog

本地优先（local-first）的个人活动记录与复盘引擎——**给人用，也给 AI agent 用**。

用 `el` CLI 或 Web 控制台记录你在做什么（学习 / 项目 / 任务，支持多任务并行、暂停恢复、笔记与阻塞项）；macOS 上被动采样屏幕前台应用；每天自动汇总并生成 Markdown 日报。所有数据存在你自己的 PostgreSQL 里，不上传任何地方。

对 OpenClaw、Claude Code、Codex 等 agent，EchoLog 的设计目标是**开箱即被工具化**：CLI 就是工具面，`el --help` 就是工具说明书，`--json` 给出机器可读输出，错误一律非 0 退出码 + 结构化错误体。

## 功能

- **活动记录**：`start / stop / pause / resume / cancel`，类型 `learning | project | task`，标签、项目归属、结果总结；多任务并行
- **父子任务**：一个大任务可挂多层小任务；服务端防止自指/成环，CLI 与 Web 可创建、查询并查看直接子任务进度
- **笔记**：给任意记录追加 `note | blocker | next`
- **补录与编辑**：`el add --at --for`、`el edit`
- **内置插件**：screen-time 采样和追溯分类前台应用；tmux-status 通过外部 CLI 提供结构化 pane/资源观测
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

```bash
el status --json          # 今日概览 + 活跃任务
el log --json -n 50       # 历史记录
el screen --json          # 今日屏幕使用（macOS）
el plugins list --json    # 内置插件清单与状态
el tmux status --json     # tmux-status 原始快照（插件默认禁用）
```

### Codex 集成

仓库提供一个独立的 Codex Plugin 包：`integrations/codex/echolog`。首个增量包含两个 Skills：显式写入的 `$track-work` 和只读复盘的 `$review-work`；两者都复用 `el --json`，不直连数据库，也不复制服务端的唯一活跃记录和父子关系判断。

该 Codex Plugin 与 EchoLog Core 的 Bundled Plugin API v1 是不同层次：前者运行在 Codex 侧，后者运行在 EchoLog 服务内。支持范围、前置条件与隐私边界见 [Codex Integration](docs/CODEX.md)。

## 配置

`config.yaml`（参考 `config.yaml.example`）：

| 段 | 说明 |
|---|---|
| `server` | 端口（默认 19827）、`apiKey`（本机豁免，非本机必带）、`serveWeb`（false = 纯 API 服务）、`corsOrigins`（跨源白名单，默认不允许跨源） |
| `database` | PostgreSQL 连接（与 docker-compose 默认值对应） |
| `plugins.screen-time` | 屏幕采样开关、频率与空闲阈值（默认启用） |
| `plugins.tmux-status` | 外部 executable、超时、采样频率与异常阈值（默认禁用） |
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

```text
Web Shell / el CLI
        |
EchoLog Core (records, notes, subtasks, reports, sync)
        |
Bundled Plugin API v1
        |-- screen-time
        `-- tmux-status -> external tmux-status executable

Codex Plugin Skills -> el --json -> EchoLog HTTP API
```

一切能力沉在服务端：客户端不复刻推断/校验逻辑，新客户端（包括未来的 MCP 适配层）以 HTTP 瘦客户端形式接入即可。开发工作流由 [Trellis](.trellis/workflow.md) 管理，编码规范见 `.trellis/spec/`。

插件协议、信任边界、manifest、生命周期、迁移和错误码见
[Bundled Plugin API v1](docs/PLUGIN_API.md)。

## 产品路线与任务管理

EchoLog 的近期方向不是做普通的工时计时器，而是成为本地优先、面向 AI agent 的个人工作记忆与复盘系统：既记录做过什么，也帮助回看能力如何积累、下一步往哪里走。

### 当前路线

- **P0 · 大任务支持子任务**：记录支持多层父子关系，父任务可查看直接子任务和完成进度；后端/API、CLI、Web 分为三个实施子任务。
  - GitHub：[P0 Issue #1](https://github.com/CubePlus1/echolog/issues/1)（[#4 后端/API](https://github.com/CubePlus1/echolog/issues/4) · [#5 CLI](https://github.com/CubePlus1/echolog/issues/5) · [#6 Web](https://github.com/CubePlus1/echolog/issues/6)）
  - Trellis：`.trellis/tasks/07-17-p0-record-subtasks/`
- **P0 · 可视化左页命中 Bug**：修复 CSS 3D 翻页后，书本左页内部的目录、任务和父子导航按钮无法点击的问题；这是独立 P0，不从属于父子任务能力。
  - GitHub：[P0 Bug #3](https://github.com/CubePlus1/echolog/issues/3)
  - Trellis：`.trellis/tasks/07-17-p0-visual-left-button/`
- **P0 · 关闭任务无需二次确认**：Web 端点击“罢”后直接作废任务，保留操作结果提示，不再弹出确认框。
  - GitHub：[P0 Bug #7](https://github.com/CubePlus1/echolog/issues/7)
  - Trellis：`.trellis/tasks/07-18-p0-close-no-confirm/`
- **P1 · 个人成长路径可视化**：以时间、项目、标签、学习主题、结果、阻塞项和下一步为证据，生成可回溯的成长时间轴。
  - GitHub：[P1 Issue #2](https://github.com/CubePlus1/echolog/issues/2)
  - Trellis：`.trellis/tasks/07-17-p1-growth-path-visualization/`
- **P1 · 人类 / Agent 工时与工作里程碑**：区分人类投入、Agent 运行、并行重叠和端到端历时；阶段完成时记录成果摘要、验证证据与工时快照，用于复盘和后续工作量估算。
  - GitHub：[P1 Issue #8](https://github.com/CubePlus1/echolog/issues/8)
  - Trellis：`.trellis/tasks/07-22-p1-actor-effort-milestones/`
- **P1 · 内置插件架构**：Core 插件平台与 screen-time 拆分已实现；tmux-status 观测层依赖独立 JSON v2 合约。显式 link 与 Agent 工时仍依赖前述 actor/span Core 能力。
  - GitHub：[P1 Issue #10](https://github.com/CubePlus1/echolog/issues/10)（[tmux-status JSON v2 #1](https://github.com/CubePlus1/tmux-status/issues/1)）
  - Trellis：`.trellis/tasks/07-31-plugin-architecture/`
- **P1 · Codex 集成**：按顺序交付 Skills-only Plugin、本地 stdio MCP 适配层、Plugin 打包与发布验收；每一步独立 Issue、PR 和 review。
  - GitHub：[#13 Skills MVP](https://github.com/CubePlus1/echolog/issues/13) → [#14 MCP 适配](https://github.com/CubePlus1/echolog/issues/14) → [#15 打包发布](https://github.com/CubePlus1/echolog/issues/15)
  - Trellis：`.trellis/tasks/08-03-codex-integration/`

### 三处任务同步规则

README 维护产品方向和里程碑，Trellis 维护实施上下文和验收标准，GitHub Issue 维护公开追踪与关闭记录。后续开发必须遵守：

1. 开始前确认三处指向同一个任务；认领 GitHub Issue，并执行 `python3 .trellis/scripts/task.py start <slug>` 激活 Trellis task。
2. 一个会话只保留一个当前激活的 Trellis task；独立交付物拆成父任务下的子任务，不把多个目标混在一个实现清单里。
3. 完成后先验证验收标准，再关闭 GitHub Issue、归档 Trellis task，并更新 README 状态；历史 Issue 和归档任务保留，不直接删除。
4. 三处内容冲突时，以已验证的实现和 Trellis task 为准，并在同一变更中同步修正 README 与 Issue。

以上五项互相独立；只有 P0“子任务能力”的后端、CLI、Web 实施项属于父任务 #1。

## License

[MIT](LICENSE)
