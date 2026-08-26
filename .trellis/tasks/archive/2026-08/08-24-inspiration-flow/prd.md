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
- Notifications use the SDK-exported `PluginNotificationSend` function and
  failures are recorded without corrupting inspiration lifecycle or preventing
  later jobs.

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

## Official notification contract acceptance

- [x] Manifest declares `notifications:send`; missing permission is denied by a
  real PluginHost with `PLUGIN_DEPENDENCY_MISSING` before service invocation.
- [x] The SDK `PluginNotificationSend` function receives `{title,message}` plus
  an optional stable `inspiration:`-namespaced delivery dedupe key; old callers
  and providers remain compatible.
- [x] At least one `sent` channel finalizes delivery as sent; all-disabled or no
  sent channel finalizes it as failed while retaining safe per-channel status.
- [x] Lazy service absence/failure remains ledgered and does not prevent Capture
  or Core startup.

## PR #36 state and race acceptance

- [x] A delivery transitions to a pre-send state before calling Core; stale
  pre-send/in-flight rows are failed as unknown without another send.
- [x] Failed deliveries from either source are terminal diagnostics and reject
  outcomes; only sent deliveries are actionable.
- [x] Duplicate calls for one delivery use one notification key without another
  send, while a distinct retry delivery uses a different namespaced key.
- [x] Scheduled key generation and selection share one locked FlowSettings
  version/interval snapshot.
- [x] Delivery page boundaries include surfaced timestamp and id.
