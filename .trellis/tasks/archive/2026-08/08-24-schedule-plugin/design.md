# Schedule bundled plugin design

## Architecture and ownership

```text
schedule_items (plugin-owned PostgreSQL table)
  -> ScheduleStore atomic operations
  -> canonical /api/plugins/schedule/* routes
  -> el schedule HTTP client
  -> ready-gated Web contribution (month/week/day)

schedule_items.next_reminder_at
  -> non-overlapping PluginJob poll
  -> schedule_reminder_deliveries unique claim
  -> PluginContext.service("notifications.send")
  -> ledger sent/failed result; schedule item remains scheduled
```

The Schedule package is the only owner of its persistence and domain rules.
Core only supplies the plugin lifecycle, plugin database URL, and named
notification capability. No code path reaches Core record or Inspiration
tables/APIs.

## Cross-layer item contract

An item serializes as camelCase JSON:

```ts
type ScheduleStatus = "scheduled" | "active" | "done" | "cancelled";

interface ScheduleItem {
  id: string;
  title: string;
  description: string | null;
  scheduledStartAt: string;
  scheduledEndAt: string | null;
  timezone: string;
  priority: number;
  status: ScheduleStatus;
  nextReminderAt: string | null;
  confirmedStartAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  awaitingConfirmation: boolean;
}
```

All input instants require `Z` or an explicit numeric offset; bare local
datetimes are rejected. The separate IANA `timezone` preserves display intent
across DST while PostgreSQL stores instants as `TIMESTAMPTZ`.

## Persistence

`schedule_items` stores the contract fields except the derived boolean. Database
checks enforce status vocabulary, non-empty titles, version >= 1, priority
bounds, and end-after-start. Indexes cover status/reminder polling and calendar
range queries.

`schedule_reminder_deliveries` stores `dedupe_key` (unique), item id,
`reminder_at`, `attempted_at`, terminal `sent | failed`, channel result JSON,
and a bounded failure string. The key is a stable item id plus the exact
`nextReminderAt` instant. Editing a title does not redeliver; explicit snooze
creates a new instant and therefore a new key.

The job atomically claims a due reminder with `INSERT ... ON CONFLICT DO
NOTHING` before calling the external service. This is an intentional at-most-once
attempt policy: daemon restart or duplicate polling cannot repeat an already
claimed reminder. A crash between claim and send may lose one reminder; retrying
would instead permit duplicate notifications after a crash following send,
which the MVP rejects. Normal delivery failure is recorded and is not retried
until the user explicitly snoozes.

## State machine and concurrency

Every mutation includes `expectedVersion`; the store performs one conditional
UPDATE with `WHERE id = ? AND version = ? AND status IN (...)`, increments
version, and returns the row. Empty return distinguishes not-found from version
or state conflict through a follow-up read used only for error metadata, never
for deciding the write.

- `confirm-start`: `scheduled -> active`; set `confirmedStartAt = now` and
  `nextReminderAt = null`.
- `snooze`: `scheduled -> scheduled`; update only `nextReminderAt` and normal
  bookkeeping (`version`, `updatedAt`).
- `complete`: `scheduled | active -> done`; set `completedAt = now`, clear the
  reminder.
- `cancel`: `scheduled | active -> cancelled`; set `cancelledAt = now`, clear
  the reminder.
- edit: only `scheduled`; editable planned fields follow the parent contract.

The API returns 404 for absent ids, 409 with `currentVersion` and
`currentStatus` for stale/invalid transitions, and 400 for boundary validation.

## HTTP API

- `GET /api/plugins/schedule/items?from=<ISO>&to=<ISO>&status=<csv>`
- `POST /api/plugins/schedule/items`
- `GET /api/plugins/schedule/items/:id`
- `PATCH /api/plugins/schedule/items/:id`
- `POST /api/plugins/schedule/items/:id/confirm-start`
- `POST /api/plugins/schedule/items/:id/snooze`
- `POST /api/plugins/schedule/items/:id/complete`
- `POST /api/plugins/schedule/items/:id/cancel`
- `GET /api/plugins/schedule/reminders`

List range semantics are `[from, to)`, selecting items whose planned interval
overlaps the range; a missing end is treated as a point at the start.

## Notification dependency

The package-local type exactly consumes the separately implemented contract:

```ts
type NotificationSend = (
  request: { title: string; message: string },
  signal?: AbortSignal
) => Promise<{
  channels: Record<"mac" | "ntfy",
    | { status: "sent" }
    | { status: "disabled" }
    | { status: "failed"; error: string }>;
}>;
```

Schedule requests `context.service<NotificationSend>("notifications.send")`
and declares `notifications:send`. A missing service fails registration and the
existing Host marks only Schedule degraded. No notification configuration,
credentials, action callbacks, or Core notifier imports cross this boundary.

## CLI and Web

`el schedule` exposes list/show/add/edit/confirm/snooze/done/cancel. Each action
uses the shared HTTP client, preserves raw JSON under `--json`, sets non-zero
exit on errors, and documents explicit-offset time formats and expectedVersion.

The Web contribution is dynamically imported only for a ready plugin. It owns
four book faces (overview/create, month, week, day), queries range data, escapes
all dynamic content, and offers explicit confirm/snooze/done/cancel controls.
It does not fabricate notification buttons.

## Parallel file ownership

- Backend agent: `plugins/schedule/echolog.plugin.json`, `config.schema.json`,
  package/tsconfig/tsup config, `plugins/schedule/src/**`,
  `tests/schedule.test.ts`, and `tests/schedule.integration.ts`.
- CLI agent: the Schedule section of `src/cli/index.ts` and
  `tests/schedule-cli.test.ts` only.
- Web agent: `plugins/schedule/web/**` and `tests/schedule-web.test.ts` only.
- Main agent: registry/build/config/lock integration, README/docs/GitHub/Trellis,
  notification contract cross-check, conflict resolution, and full validation.
- Check agent: read-only first-pass review of the integrated diff.

No two implementation agents may edit the same file.

## Rollout and rollback

The package is additive and uses plugin-owned migrations. It is default-enabled
to expose the feature; without the independent notification service Host change
it predictably degrades and remains isolated. Integration with that service
makes it ready without changing the package contract. Rollback disables the
plugin in config or removes the bundled registry entry; private tables remain.
