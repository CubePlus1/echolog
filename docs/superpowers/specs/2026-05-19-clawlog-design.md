# ClawLog Design Spec

> 本地优先的开发者行为记录与复盘引擎 — 支持多任务并行、Web 控制台、OpenClaw MCP 集成。

## 核心决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 架构 | Core Engine + HTTP Server (daemon) | Web UI + LAN 访问 + 多端共享 |
| 数据库 | PostgreSQL (Docker) | 多任务并发写入、复杂查询、JSON 支持 |
| 前端 | React + Vite | OpenClaw 同栈，组件化 |
| 多任务 | 支持并行 | 一个时间点多个任务同时运行 |
| 解耦 | 独立产品，sync 命令导出到 Eoove-demo/docs | 数据自治 |
| OpenClaw | MCP server + SKILL.md | 从第一天开始 |
| 通知 | macOS node-notifier + ntfy (iPhone) | 忘记开始时提醒 |

## 架构

```
┌─────────┐  ┌─────────────┐  ┌────────────┐
│  CLI    │  │ MCP Server  │  │  Web UI    │
│ (cl)    │  │ (stdio)     │  │ (React)    │
│ thin    │  │             │  │ Vite SPA   │
│ client  │  └──────┬──────┘  └─────┬──────┘
└────┬────┘         │               │
     │    HTTP      │ import        │ HTTP
     └──────┬───────┘               │
            │                       │
     ┌──────┴───────────────────────┘
     │
┌────┴──────────┐
│  HTTP Server  │  ← launchd daemon
│  (Fastify)    │  ← 托管 API + Web static
└───────┬───────┘
        │
┌───────┴───────┐
│  Core Engine  │  ← 纯业务逻辑
│  RecordStore  │  ← PostgreSQL 操作
│  Recorder     │  ← start/stop/pause/note
│  Reporter     │  ← 日报/周报生成
│  Syncer       │  ← Markdown 导出
│  Notifier     │  ← Mac/iPhone 通知
│  Scheduler    │  ← 定时任务
└───────┬───────┘
        │
┌───────┴───────┐
│  PostgreSQL   │  ← Docker container
└───────────────┘
```

## 技术栈

| 层 | 选择 |
|---|---|
| 语言 | TypeScript |
| 运行时 | Node.js 22+ |
| HTTP Server | Fastify |
| CLI | Commander |
| 数据库 | PostgreSQL 16 (Docker) |
| ORM | Drizzle ORM |
| 前端 | React 19 + Vite |
| MCP | @modelcontextprotocol/sdk |
| macOS 通知 | node-notifier |
| iPhone 通知 | ntfy.sh (self-host or public) |
| 构建 | tsup (server/cli/mcp) + Vite (web) |
| 包管理 | pnpm |
| 容器 | Docker Compose |

## 数据模型

### records 表

```sql
CREATE TABLE records (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  type          TEXT NOT NULL CHECK(type IN ('learning','project','task')),
  tags          TEXT[] NOT NULL DEFAULT '{}',
  project       TEXT,
  start_at      TIMESTAMPTZ NOT NULL,
  end_at        TIMESTAMPTZ,
  status        TEXT NOT NULL CHECK(status IN ('running','paused','done','cancelled')),
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  result        TEXT,
  source        TEXT NOT NULL DEFAULT 'cli',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_records_status ON records(status);
CREATE INDEX idx_records_start_at ON records(start_at);
CREATE INDEX idx_records_project ON records(project);
```

### notes 表

```sql
CREATE TABLE notes (
  id            TEXT PRIMARY KEY,
  record_id     TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  content       TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'note' CHECK(type IN ('note','blocker','next')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notes_record ON notes(record_id);
```

### pauses 表 (多任务暂停/恢复追踪)

```sql
CREATE TABLE pauses (
  id            TEXT PRIMARY KEY,
  record_id     TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  paused_at     TIMESTAMPTZ NOT NULL,
  resumed_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pauses_record ON pauses(record_id);
```

### 状态机

```
         start
  ┌──────────────► running
  │                  │  │
  │           pause  │  │ stop / cancel
  │                  ▼  │
  │               paused │
  │                  │   │
  │          resume  │   │
  │                  ▼   ▼
  │               running → done / cancelled
```

- running: 计时中
- paused: 暂停，不计时
- done: 正常结束，计入统计
- cancelled: 取消，不计入统计
- 多个任务可以同时处于 running 状态

## CLI 命令

```bash
# 核心工作流（支持多任务并行）
cl start "学习 Java HashMap" -t java,学习 --type learning -p eoove
cl start "修 API bug" --type task -p eoove    # 同时开始第二个任务
cl stop <id>                                   # 停止指定任务
cl stop <id> -n "理解了扩容机制"                # 停止 + 总结
cl stop --all                                  # 停止所有任务
cl pause <id>                                  # 暂停指定任务
cl resume <id>                                 # 恢复指定任务
cl status                                      # 所有运行中任务 + 今日概览
cl note <id> "resize 细节需要二刷"             # 给指定任务追加笔记
cl note <id> -b "skiplist 不理解"              # 追加阻塞项
cl note <id> -x "明天补 skiplist"              # 追加后续行动

# 查看
cl today                                       # 今日摘要
cl log                                         # 最近记录
cl log --since 2026-05-15 -p eoove            # 过滤

# 报告 + 同步
cl report                                      # 生成今日日报
cl sync                                        # 导出到 Eoove-demo/docs

# 补记 + 编辑
cl add "学了 Redis" --at "yesterday 14:00" --for 90m -t redis
cl edit <id> -n "补充笔记"
cl cancel <id>

# 服务器
cl daemon start|stop|status|install
cl mcp                                         # 启动 MCP stdio server
```

多任务规则：
- `cl stop` 无 id 时，如果只有 1 个 running 任务则停止它；多个则提示选择
- `cl note` 无 id 时同理
- `cl status` 显示所有 running/paused 任务列表

## REST API

```
POST   /api/records          → start record
PATCH  /api/records/:id      → update (stop/pause/resume/edit)
DELETE /api/records/:id      → cancel
GET    /api/records          → list (query: date, project, type, status)
GET    /api/records/:id      → get single
GET    /api/records/active   → all running/paused records

POST   /api/records/:id/notes → add note
GET    /api/records/:id/notes → list notes

GET    /api/summary/today     → today summary stats
GET    /api/summary/daily/:date → specific date stats

POST   /api/reports/daily     → generate daily report
POST   /api/sync              → sync markdown to target
GET    /api/health             → server health check
```

## Web UI

MVP 页面：
1. **Dashboard** — 当前运行任务列表 + 今日概览
   - 每个任务卡片: 标题、计时器（实时）、暂停/停止按钮
   - "开始新任务" 按钮 → 弹窗填标题/类型/标签
   - 今日时间分布饼图
2. **历史** — 按日期浏览记录（Phase 2 增强）

技术：
- React 19 + Vite
- Tailwind CSS
- 轮询 API（每 5s 刷新 active records）或 SSE
- Fastify 托管 build 产物

## MCP Server

工具列表：

| Tool | 参数 | 返回 |
|------|------|------|
| start_record | title, type?, tags?, project? | Record |
| stop_record | id?, result? | Record |
| pause_record | id? | Record |
| resume_record | id? | Record |
| add_note | id?, content, noteType? | Note |
| get_status | — | { active: Record[], todaySummary } |
| get_records | date?, project?, type? | Record[] |
| generate_report | date? | { markdown, path } |

安全：无 delete/cancel 操作，只读 + 创建 + 状态变更。

## 通知机制

| 场景 | 触发 | Mac | iPhone |
|------|------|-----|--------|
| 任务超时 | running > 2h | node-notifier | ntfy push |
| 忘记开始 | 工作时间无 running 任务 | node-notifier | ntfy push |
| 日报提醒 | 21:00 有记录未生成日报 | node-notifier | ntfy push |
| 忘记 stop | 23:00 仍有 running | node-notifier | ntfy push |

```yaml
# config.yaml
notifications:
  enabled: true
  mac: true
  ntfy:
    enabled: false
    server: "https://ntfy.sh"
    topic: "clawlog-example"
  rules:
    task_overtime_minutes: 120
    idle_reminder_enabled: true
    idle_check_start: "09:00"
    idle_check_end: "18:00"
    daily_report_time: "21:00"
    end_of_day_time: "23:00"
```

"忘记开始" 检测逻辑：工作时间段（09:00-18:00），每 30 分钟检查一次，如果没有 running/paused 任务则提醒。

## 目录结构

```
self_record/
├── package.json
├── pnpm-workspace.yaml
├── docker-compose.yml
├── config.yaml
├── src/
│   ├── core/
│   │   ├── db.ts              # Drizzle + PostgreSQL connection
│   │   ├── schema.ts          # Drizzle schema definitions
│   │   ├── recorder.ts        # start/stop/pause/resume/note
│   │   ├── reporter.ts        # daily report generation
│   │   ├── syncer.ts          # markdown export
│   │   ├── notifier.ts        # mac + ntfy notifications
│   │   └── scheduler.ts       # timer-based reminders
│   ├── server/
│   │   ├── app.ts             # Fastify instance
│   │   ├── routes/
│   │   │   ├── records.ts
│   │   │   ├── notes.ts
│   │   │   ├── summary.ts
│   │   │   └── reports.ts
│   │   └── static.ts          # serve web UI build
│   ├── cli/
│   │   ├── index.ts
│   │   └── commands/
│   │       ├── start.ts
│   │       ├── stop.ts
│   │       ├── pause.ts
│   │       ├── resume.ts
│   │       ├── status.ts
│   │       ├── note.ts
│   │       ├── today.ts
│   │       ├── log.ts
│   │       ├── report.ts
│   │       ├── sync.ts
│   │       ├── add.ts
│   │       ├── edit.ts
│   │       ├── cancel.ts
│   │       └── daemon.ts
│   ├── mcp/
│   │   └── server.ts
│   └── migrate.ts              # DB migration runner
├── web/                         # React frontend
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── App.tsx
│       ├── main.tsx
│       ├── components/
│       │   ├── TaskCard.tsx
│       │   ├── NewTaskModal.tsx
│       │   ├── TodaySummary.tsx
│       │   └── Timer.tsx
│       └── api.ts
├── templates/
│   └── daily.md.ejs
└── scripts/
    └── com.clawlog.daemon.plist
```

## Sync 输出

```
/Users/example/code/Eoove-demo/docs/
└── clawlog/
    ├── daily/
    │   ├── 2026-05-18.md
    │   └── 2026-05-19.md
    ├── weekly/
    └── monthly/
```

## 配置文件

```yaml
# config.yaml
server:
  port: 19827
  host: "0.0.0.0"       # LAN 可访问

database:
  host: "localhost"
  port: 5432
  name: "clawlog"
  user: "clawlog"
  password: "clawlog"

sync:
  target: "/Users/example/code/Eoove-demo/docs/clawlog"
  auto: false            # 生成报告时自动 sync

notifications:
  enabled: true
  mac: true
  ntfy:
    enabled: false
    server: "https://ntfy.sh"
    topic: "clawlog-example"
  rules:
    task_overtime_minutes: 120
    idle_reminder_enabled: true
    idle_check_start: "09:00"
    idle_check_end: "18:00"
    daily_report_time: "21:00"
    end_of_day_time: "23:00"
```
