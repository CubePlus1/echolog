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

# Trellis 工作流速查（agent 必读）

本仓库用 Trellis 管理任务与规范（详见 `.trellis/workflow.md`）。如果你的平台没有加载 Trellis 上下文（比如你只能读到本文件），按下面的命令自助：

```bash
# 我现在该干什么 —— 先看有没有进行中的任务
python3 .trellis/scripts/task.py current
python3 .trellis/scripts/task.py list

# 任务生命周期（执行请求已授权规划和实现；按可独立审查的变更组织 commit）
python3 .trellis/scripts/task.py create "<标题>" --slug <slug>   # 建任务目录
#   → 填 <task>/prd.md（需求+验收标准）；仅在有独立用途时加 design.md、implement.md
python3 .trellis/scripts/task.py start <slug>                    # 状态 → in_progress，才可实现
python3 .trellis/scripts/task.py archive <slug>                  # 完成后归档（自动 commit）

# 阶段指引与规范
python3 .trellis/scripts/get_context.py --mode phase --step 2.1  # 某一步的详细指引
python3 .trellis/scripts/get_context.py --mode packages          # 列出 spec 层

# 有跨会话记录价值且允许提交时记 journal（用实际 commit hash）
python3 .trellis/scripts/add_session.py --title "..." --commit "<hash1,hash2>" --summary "..."

# 跨会话记忆（之前怎么讨论/解决的）
trellis mem search "<关键词>"
```

写代码前必读对应层的规范：`.trellis/spec/backend/`（改 CLI 先看 `cli-agent-contract.md`，错误处理看 `error-handling.md`）；前端看 `.trellis/spec/frontend/`。有任务时读取现有上下文：实际使用的 `implement.jsonl` 清单 → `prd.md` → 存在的 `design.md`、`implement.md`；inline 工作直接读相关规范，不为读取顺序补建文件。

## 授权与完成

- 用户要求实现、修复或优化时，授权覆盖目标内必要的调查、规划、文件修改和验证；建任务、进入实现、已有授权范围内的提交不再逐项确认。用户明确要求仅审阅或仅规划时，停在该交付边界。
- 先从当前会话、代码和项目记录找答案。仅在缺失信息会实质改变目标、正确性或产生难以撤销的后果时澄清；可逆的实现选择自行判断并说明关键假设。等待答案期间继续不依赖该答案的工作。
- 仅在具体动作超出已有授权时请求批准，例如新增对外影响、费用承诺、访问范围或不可逆操作。先完成已授权的准备、验证和可审查结果，再说明缺失哪项授权；同一授权在会话中持续有效。
- 简单说明、只读审阅和局部文档/规则维护可直接执行；产品开发按下述任务同步规范跟踪。复杂度决定计划与验证深度，不自动要求多份文档、子任务或子 Agent。
- 完成以用户目标和验收证据为准。执行所有已授权收尾，分别说明本地交付、提交、PR、合并和发布状态；未请求的发布不阻塞本地交付，已请求但受阻的步骤不得宣称完成。保留无关修改，只修复本次引入或阻碍目标的问题。

## 分支与 worktree 规范（强制）

- **禁止在 `main` 分支直接开发、修改文件或创建 commit**；文档、配置、修复和紧急变更也不例外。
- 开始任何实现前，先运行 `git branch --show-current` 确认所在分支。若结果为 `main` 或为空（detached HEAD），必须先创建并切换到 `codex/<task-slug>` 等独立任务分支；需要隔离并行工作时，为该分支创建独立 worktree。
- 所有变更只能提交到任务分支，并通过 Pull Request 合入 `main`。不得以“改动很小”为由跳过分支和 PR。
- 创建 commit 前再次检查当前分支；若位于 `main` 或 detached HEAD，立即停止提交，先把现有改动安全迁移到任务分支或 worktree。

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

## EchoLog 任务同步与认领规范

产品路线和任务必须在 README、Trellis、GitHub Issue 三处保持可追踪的一致关系：

1. README 只维护方向、优先级和里程碑；Trellis task 维护 PRD、设计、实现清单、负责人和验收；GitHub Issue 维护公开讨论、依赖和关闭记录。
2. 产品开发前检查三处关联并复用或建立必要的本地 Trellis task，执行 `python3 .trellis/scripts/task.py start <slug>`。已有 GitHub 写入授权时认领 Issue；缺少授权或远端不可用时先完成本地实现与验证，记录待同步项，不以远端认领阻塞本地工作。局部文档/规则维护不强制创建 Issue 或 task。
3. 一个会话只保留一个当前激活任务；只有独立验收确有帮助时才拆子任务。通过任务范围内的验收后执行已授权的收尾；仅当 README 路线或里程碑发生变化时更新它。Issue 关闭和 Trellis 归档应如实反映范围内的合并/发布要求，不把会话结束等同任务完成。
4. 只清除活跃状态时用 `task.py finish`；任务达到验收后才归档或关闭对应 Issue。保留历史任务、Issue 和提交记录，不把清除状态当作完成。
5. 三处冲突时，以已验证实现和 Trellis task 为准，在本次变更中修正本地文档，并在授权范围内同步 Issue；无法完成的远端同步明确列为待办。

## Pull Request 与 Codex 审阅规范

所有 Pull Request 在合并前都必须经过 Codex code review。仓库管理员必须在
Codex Code review 设置中启用 `Automatic reviews`。如果自动审阅未触发，维护者
必须在对应 PR 的评论中精确发送 `@codex review`。

### Code Review Rules

- 审阅以 PR 的最新 commit 为准；每次实质性更新都会使之前的审阅失效，必须
  对最新 commit 重新请求并完成 Codex review。
- P0/P1 问题必须先修复，再针对最新 commit 重新审阅；未完成修复和重审前不得
  合并 PR。
- `@codex` 不是 CODEOWNERS reviewer，也不能满足 CODEOWNERS 或其他 required
  reviewer 门槛；如需这些门槛，必须由真实的被配置 reviewer 完成。
- 不得添加 GitHub Actions 来模拟 bot mention，也不得伪造 CODEOWNERS 身份。
