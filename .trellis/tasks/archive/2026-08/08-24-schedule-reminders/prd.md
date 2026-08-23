# Schedule data and reminders (#31)

## Goal

Deliver the plugin-owned Schedule data model, explicit state machine, reminder
delivery ledger/job, canonical HTTP API, and `el schedule` client for GitHub #31.

## Requirements

- Implement the parent task's item contract, timezone rules, notification
  dependency, atomic transitions, and non-goals without Core/Inspiration access.
- Creation initializes `status=scheduled`, `version=1`, and
  `nextReminderAt=scheduledStartAt` unless an explicit reminder is given.
- Reminder polling must claim each item/reminder instant once, call
  `notifications.send`, record the channel result, and never mutate item state.
- Confirm/snooze/complete/cancel and edit require `expectedVersion` and return
  structured 409 conflict metadata on races or invalid states.
- The CLI must be a thin client with raw `--json`, non-zero error exits, exact
  canonical paths, explicit-offset datetime help, and no local state inference.

## Acceptance Criteria

- [x] Migrations create constrained/indexed `schedule_items` and a reminder
      ledger with a unique dedupe key; every instant is `TIMESTAMPTZ`.
- [x] CRUD/list/range and all state routes validate input and preserve the
      parent JSON contract including derived `awaitingConfirmation`.
- [x] Two concurrent confirms with the same expected version yield one active
      item and one 409; `confirmedStartAt` reflects the winner's confirmation.
- [x] Due polling, repeated polling, daemon/store restart, snooze, abort, and
      notification failure have deterministic tests.
- [x] Arrival/failed/ignored reminders do not start, complete, cancel, or create
      any Core record.
- [x] Disabled and missing-service/degraded cases remain isolated by Host tests.
- [x] `el schedule` list/show/add/edit/confirm/snooze/done/cancel meets the CLI
      agent contract in human and JSON modes.

## Dependency

This child establishes the HTTP/item contract consumed by the calendar child.
It depends at runtime on the separately delivered `notifications.send` Host
capability but tests it through a mock only.
