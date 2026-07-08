# Database Guidelines

> Database patterns and conventions for this project.

---

## Overview

PostgreSQL（docker compose 起在 5436 端口，容器名 echolog-db）+ drizzle-orm（pg-core）+ `postgres` 驱动。连接经 `src/core/db.ts` 的 `getDb()` 单例。**不用 drizzle-kit 生成迁移**——迁移是手写 SQL。

---

## Query Patterns

- 一律用 drizzle 查询构造器：`db.select().from(records).where(and(...))`
- 状态迁移必须原子：UPDATE 带状态前置条件（`WHERE id=.. AND status IN (..)`）+ `.returning()`，返回空即抛 `InvalidStateError`（见 recorder.ts C-1 注释），**不要**读-判-写
- 多表一致写入用 `db.transaction(async (tx) => {...})`（见 pauseRecord）
- 白名单更新：动态 update 前显式挑字段（见 editRecord H-6），不要直接展开用户输入

## Migrations

- `src/migrate.ts` 顶部 `MIGRATIONS` 数组追加 `{ name: "NNN_描述", sql: \`...\` }`，幂等（CREATE TABLE IF NOT EXISTS）
- 同步更新 `src/core/schema.ts` 的 drizzle 定义（表 + `$inferSelect` 类型导出）
- 运行：`pnpm migrate`（tsx 直跑，读 config.yaml 连接串）

## Naming Conventions

- 表复数蛇形（records、app_usage 例外为不可数）；列蛇形，drizzle 侧驼峰映射：`startAt: timestamp("start_at", { withTimezone: true })`
- 索引 `idx_<table>_<col>`；CHECK 约束 `<table>_<col>_check`
- 主键 TEXT，`nanoid(12)`，应用侧生成
- 时间一律 `TIMESTAMPTZ`；「一天」按服务器本地时区切（`localDateStr()`，`getRecordsByDate` 的 dayStart/dayEnd 模式）

## Common Mistakes

- 忘了迁移与 schema.ts 双写，跑起来才发现列不存在
- 用 `new Date(dateStr)` 解析纯日期会得到 UTC 半夜——按日切片须用 `new Date(\`${date}T00:00:00.000\`)`（本地时区）
