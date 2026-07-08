<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

# EchoLog 运行手册（agent 必读）

EchoLog 是本机的活动记录服务。作为 agent，你通过 **`el` CLI** 使用它（已在 PATH，`/opt/homebrew/bin/el`）；`el --help` 与各子命令 `--help` 就是完整的工具说明书。需要机器可读输出加 `--json`；成功退出码 0，任何错误非 0（错误信息在 stderr 或 JSON 错误体 `{"error", ...}`）。HTTP 契约见 `docs/API.md`。

## 服务拓扑（截至 2026-07-08）

| 组件 | 形态 | 说明 |
|---|---|---|
| API server + Web UI | launchd 守护 `com.echolog.daemon` | `node dist/server/app.js`，工作目录本仓库，`KeepAlive`（被杀会自动拉起），监听 `http://localhost:19827` |
| 数据库 | Docker 容器 `echolog-db` | PostgreSQL 16，`docker compose up -d` 启动 |
| CLI | `/opt/homebrew/bin/el` | wrapper，指向本仓库 `dist/cli/index.js` |

- plist：`~/Library/LaunchAgents/com.echolog.daemon.plist`
- 日志：`/tmp/echolog.stdout.log`、`/tmp/echolog.stderr.log`
- 配置：仓库根 `config.yaml`（不入库；已设 `server.apiKey`——本机请求豁免鉴权，跨机器访问 `/api/*` 需带 `X-API-Key`）

## 常用操作

```bash
# 健康检查（判断服务是否可用的第一步）
curl -s http://localhost:19827/api/health        # {"status":"ok",...}

# 重启 daemon（改代码后：先构建再重启）
pnpm build
launchctl kickstart -k gui/$(id -u)/com.echolog.daemon

# daemon 完全没起来时（如注销后未加载）
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.echolog.daemon.plist

# 数据库
docker compose up -d      # 起库（daemon 连不上库时先看这个）
docker ps | grep echolog-db
```

## 排障顺序

1. `curl /api/health` 失败 → 看 `/tmp/echolog.stderr.log` 尾部；
2. 日志报数据库连接错误 → `docker compose up -d` 后 `launchctl kickstart -k ...`；
3. CLI 报"无法连接到 EchoLog server" → 同上（CLI 只是 HTTP 瘦客户端，不要绕过 API 直连数据库）；
4. 行为与代码不符 → 大概率 dist 过期：`pnpm build` 后 kickstart。

## 约定

- 记录的写操作一律走 `el`（或 `/api/*`），**禁止直接写数据库**。
- 省略 id 的 `el stop/pause/resume/note/cancel` 由服务端匹配唯一活跃记录；歧义时返回 409 和候选列表，按提示带 id 重试。
- 改动 `src/cli/` 前先读 `.trellis/spec/backend/cli-agent-contract.md`。
