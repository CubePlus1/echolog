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

## Scenario: Plugin-owned scheduled reminders

### 1. Scope / Trigger

- Trigger: a bundled plugin stores scheduled work, polls due rows, calls an
  external Host service, and must survive duplicate polls or daemon restart.
- The plugin owns its tables and migration. It must not write Core records or
  copy the Core notifier.

### 2. Signatures

- Item transitions take `(id, expectedVersion, ...input)` and perform one
  `UPDATE ... WHERE id = ? AND version = ? AND status IN (...) RETURNING *`.
- Reminder candidates are exact pairs `(item_id, reminder_at TIMESTAMPTZ)`.
- The notification boundary is
  `PluginContext.service("notifications.send")`, accepting
  `{title, message}` plus an optional `AbortSignal`.

### 3. Contracts

- Store explicit IANA timezone display intent separately from absolute
  `TIMESTAMPTZ` instants; HTTP inputs must include `Z` or a numeric offset.
- Derived UI state such as “awaiting confirmation” is calculated from persisted
  state + time and is never stored as another status.
- Claim a reminder by inserting a unique ledger key before delivery. A ledger
  row in any state (`claimed`, `sent`, or `failed`) makes that exact
  item/reminder instant ineligible for another attempt.
- The ledger MUST index `(item_id, reminder_at)` in the same order used by the
  due-query anti-join. A `dedupe_key` index cannot serve predicates on its
  component columns, and the ledger grows for the lifetime of the plugin.
- At-most-once means a crash after claim may lose one reminder; restart must not
  repeat a possibly delivered notification. A user action that chooses a new
  reminder instant creates a new key.
- Delivery never performs an implicit domain transition. Confirm/start,
  complete, cancel, and snooze remain explicit versioned mutations.
- An external delivery continuation may terminalize `claimed` only while its
  caller signal is still authoritative. After every awaited send and
  immediately before `claimed -> sent|failed`, recheck the signal. Caller
  abort or `AbortError` retains `claimed`; ordinary channel/service failure
  still writes `failed`.
- Reminder claim transactions accept the caller signal but bound database-lock
  waiting with a separate internal transport timeout. Check the internal signal
  before/after `FOR UPDATE`, before/after the ledger insert, and before the
  transaction callback returns; caller abort and timeout must clean up their
  timer/listener resources and a late lock release must roll back rather than
  insert a claim.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Missing item | 404 `{error}` |
| Stale version or invalid state | 409 with `currentVersion` and `currentStatus` |
| Bare local datetime / invalid IANA zone | 400 `{error}` |
| Duplicate or restarted poll | Existing ledger excludes the exact instant; no send |
| Host notification failure | Record bounded failure; do not change item state |
| Job abort/timeout/stop | Rethrow before finalization, release Host running state, retain `claimed` |
| Blocked reminder claim timeout | Reject with distinct `SCHEDULE_CLAIM_TIMEOUT`, keep caller signal un-aborted, and prevent late ledger insert |

### 5. Good/Base/Bad Cases

- Good: 105 due rows with a batch size of 100 drain as 100 then 5, and a third
  poll sees 0; all 105 ledger keys are unique.
- Base: one due item is claimed, notified once, and remains scheduled until an
  explicit confirmation.
- Bad: query the oldest 100 due items first, then dedupe in application code.
  The same ledgered rows occupy every batch and permanently starve row 101.
- Bad: catch an aborted notification, write `failed`, and only then inspect
  the signal. A timed-out late continuation has already corrupted diagnosis.

### 6. Tests Required

- Real PostgreSQL CAS race: two confirmations with one expected version produce
  exactly one success and one structured 409.
- Real PostgreSQL poll-limit regression: insert more than one batch, reconstruct
  the Store between polls, assert every item is attempted once, then assert zero
  remaining candidates.
- Assert `claimed`, `sent`, and `failed` ledger rows are all excluded before
  `LIMIT`; a new snooze instant remains eligible.
- Assert the immutable follow-up migration and Drizzle schema both declare the
  `(item_id, reminder_at)` lookup index.
- Assert failed/ignored delivery does not modify status, confirmed timestamp, or
  create a Core record.
- Through the real Host scheduler, timeout/stop an in-flight controlled send,
  settle it late as success/AbortError/ordinary rejection, and assert the exact
  ledger stays `claimed`, terminal counters stay zero, and later intervals
  dedupe without another send.

### 7. Wrong vs Correct

#### Wrong

```sql
SELECT * FROM schedule_items
WHERE next_reminder_at <= NOW()
ORDER BY next_reminder_at
LIMIT 100;
-- Application code discovers these 100 already have ledger rows.
```

#### Correct

```sql
SELECT i.* FROM schedule_items i
WHERE i.next_reminder_at <= NOW()
  AND NOT EXISTS (
    SELECT 1 FROM schedule_reminder_deliveries d
    WHERE d.item_id = i.id
      AND d.reminder_at = i.next_reminder_at
  )
ORDER BY i.next_reminder_at
LIMIT 100;

CREATE INDEX idx_schedule_reminder_deliveries_item_reminder
  ON schedule_reminder_deliveries(item_id, reminder_at);
```

```typescript
// Wrong: timeout/stop may have aborted while send was pending.
const result = await send(request, signal);
await finishReminder(result);

// Correct: a late continuation must prove it still has write authority.
const result = await send(request, signal);
signal.throwIfAborted();
await finishReminder(result);
```

## Common Mistakes

- 忘了迁移与 schema.ts 双写，跑起来才发现列不存在
- 用 `new Date(dateStr)` 解析纯日期会得到 UTC 半夜——按日切片须用 `new Date(\`${date}T00:00:00.000\`)`（本地时区）
