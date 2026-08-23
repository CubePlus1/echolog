# Fix Schedule local review findings

## Goal

Resolve all three actionable findings from the local base-branch review of the
Schedule bundled plugin without changing its product semantics or notification
service boundary.

## Requirements

- Day-face validation and API errors MUST render in the day error element;
  overview actions MUST continue using the overview error element.
- Web and backend MUST accept/reject the same explicit-offset timestamp grammar.
  Minute-precision ISO input such as `2026-08-25T09:00+08:00` MUST not pass one
  layer and fail the other.
- The reminder ledger MUST have an index covering the exact
  `(item_id, reminder_at)` anti-join used by due polling and the per-item ledger
  query. Schema metadata and immutable plugin migrations MUST stay synchronized.
- Existing explicit-confirmation, at-most-once ledger, snooze, and
  notifications.send contracts MUST remain unchanged.

## Acceptance Criteria

- [x] A day action failure updates only `scheduleActionErrorDay`; overview
      failure updates only `scheduleActionError`.
- [x] Cross-layer tests cover minute-precision and second-precision offset
      timestamps with the same outcome in Web and backend.
- [x] PostgreSQL migration/schema expose an item/reminder composite index and
      the existing integration suite remains green.
- [x] Focused tests, PostgreSQL integration, `pnpm test`, `pnpm typecheck`,
      and `pnpm build` pass.
- [x] Fixes are committed on `codex/schedule-plugin` after final diff review.
