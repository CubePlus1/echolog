# Schedule bundled plugin

## Goal

Ship one first-party `plugins/schedule` package that lets users plan time,
receive non-starting reminders, explicitly control execution state, and inspect
the same schedule data in month, week, and day views. This parent task owns the
cross-child contract and final integration for GitHub Issues #31 and #32.

## Requirements

- The parent delivery MUST comprise two independently verifiable children:
  `schedule-reminders` for Issue #31 and `schedule-calendar-view` for Issue #32.
- Schedule MUST remain independent of Inspiration and Core records. It MUST NOT
  import, create, start, update, or otherwise depend on either domain.
- Reaching `scheduledStartAt` MUST only request a notification. It MUST NOT
  change item state or imply that work began.
- Only explicit `confirm-start` may move an item from `scheduled` to `active`;
  `confirmedStartAt` MUST be the confirmation time, not the planned time.
- Ignoring a notification MUST change nothing. Snooze MUST only move
  `nextReminderAt`. Completion and cancellation MUST be explicit.
- Persisted statuses are exactly `scheduled | active | done | cancelled`.
  `awaitingConfirmation` is derived as `status === "scheduled" &&
  scheduledStartAt <= now` and MUST NOT be stored.
- One plugin-private `schedule_items` source MUST back CRUD/state transitions
  and all month/week/day views. A `calendar_events` shadow model is forbidden.
- The package owns manifest/config, schema/migrations, store, routes, jobs, CLI,
  Web contribution, docs, and tests. Canonical HTTP routes use
  `/api/plugins/schedule/*`; CLI and Web are HTTP clients only.
- Notification delivery MUST use the named Host service
  `PluginContext.service("notifications.send")` and manifest permission
  `notifications:send`. This branch MUST define only the narrow local consumer
  type and MUST NOT copy Core notifier or modify shared SDK/Host service files.
- A unique reminder ledger dedupe key, explicit `TIMESTAMPTZ` values plus an
  IANA timezone, and optimistic `expectedVersion` atomic updates are mandatory.
- Disabled/degraded isolation, job timeout/non-reentry, restart/re-poll
  deduplication, confirm races, snooze, and notification failure require tests.
- The MVP MUST NOT claim macOS notification action callbacks. Confirm, snooze,
  complete, and cancel happen only through Web or CLI.
- Recurrence, external calendar sync, AI scheduling, Inspiration conversion,
  and Core record linkage are out of scope.

## Acceptance Criteria

- [x] Both child acceptance suites pass and use one `plugins/schedule` package.
- [x] README, GitHub #31/#32, and this task tree point to the same branch,
      package, semantics, and verification state.
- [x] Web loads Schedule only while the bundled plugin is enabled and `ready`.
- [x] Missing `notifications.send` degrades only Schedule; it does not prevent
      Core or another plugin from starting.
- [x] `pnpm test`, `pnpm typecheck`, and `pnpm build` pass from the repository
      root after integration.
- [x] An independent check agent reviews the integrated diff after all three
      implementation agents finish, and verified findings are resolved.
- [x] Changes are committed on `codex/schedule-plugin` without merging any
      sibling branch.

## Child Map

- `08-24-schedule-reminders` — Issue #31: model, migration, store, reminder
  ledger/job, state API, and `el schedule`.
- `08-24-schedule-calendar-view` — Issue #32: ready-gated month/week/day Web
  views and explicit state actions over the Issue #31 API.
