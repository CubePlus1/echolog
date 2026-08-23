# Inspiration Flow surfacing (#34)

## Goal

Resurface eligible inspirations through one deterministic selector shared by
manual and scheduled Flow while keeping delivery state separate from the
inspiration lifecycle.

## Requirements

- Settings are database-backed, singleton, versioned, and cover enabled state,
  interval, quiet hours, cooldown, daily cap, default snooze, and optional
  lifecycle/tag/project filters.
- Manual `next` and the scheduled job call the same selector and atomic reserve
  operation. Selection is explainable: oldest `lastSurfacedAt` (never surfaced
  first), then oldest creation time and stable id.
- Eligibility excludes archived inspirations, snoozed deliveries, cooldown
  windows, disallowed quiet hours for scheduled delivery, and daily-cap excess.
- Delivery ledger records source, unique dedupe key, attempts/status,
  notification result/failure, surfaced time, snooze, outcome, and version.
- Outcomes are exactly `viewed`, `continued`, `kept`, `later`, `archived`.
  `later` only updates delivery snooze; `kept`/`archived` update the inspiration
  lifecycle atomically with the outcome using expected versions.
- Notifications use the local `notifications.send` interface and failures are
  recorded without corrupting inspiration lifecycle or preventing later jobs.

## Acceptance Criteria

- [x] Manual and scheduled selection produce the same candidate for the same
  store snapshot and explain why candidates were excluded.
- [x] Quiet hours (including overnight ranges), cooldown, filters, daily limit,
  snooze, duplicate polling, daemon restart, and empty inbox are tested.
- [x] Reservation/delivery/outcome writes are atomic and dedupe-safe.
- [x] Notification failure creates a failed ledger entry and remains retryable.
- [x] `later` never changes inspiration `status`; concurrent stale outcomes
  return a conflict.
- [x] Job behavior remains safe under Host non-reentry and timeout/abort.
