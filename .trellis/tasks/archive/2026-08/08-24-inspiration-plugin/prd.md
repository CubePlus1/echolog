# Inspiration bundled plugin

## Goal

Deliver one first-party `inspiration` bundled plugin that covers GitHub #33
(capture and organization) and #34 (Flow resurfacing) as two phases of one
product, with independently verifiable Capture, Flow, and client deliverables.

## Requirements

- The plugin is one workspace package at `plugins/inspiration` with private
  tables, migrations, stores, canonical routes, jobs, CLI, Web, and an
  optional daily-report contribution.
- Inspiration is completely independent from Schedule and Core records. It
  MUST NOT query, create, convert, link, or otherwise call schedule APIs, and
  MUST NOT add cross-plugin or Core foreign-key relationships.
- Capture works without an active Core record and supports inbox, organization,
  editing, tags, free-form project grouping, lifecycle-status filters,
  full-text search, archive, and history.
- Flow manual `next` and scheduled delivery share one deterministic,
  explainable selector. The first version uses no AI or embeddings.
- Flow enforces cooldown, quiet hours, daily limit, snooze,
  `lastSurfacedAt`, a delivery ledger, unique dedupe keys, and explicit user
  outcomes. Snooze changes delivery eligibility only and never changes the
  inspiration lifecycle.
- Allowed Flow actions are view, continue editing, keep, later, and archive.
  Task/schedule creation and scheduling are explicitly out of scope.
- Flow notifications use `PluginContext.service("notifications.send")` through
  the SDK-exported `PluginNotificationSend` contract. The Core notifier is not
  copied; Host/SDK changes are limited to the audited official capability
  commit `29fe6c3`, cherry-picked here as `8484b48`.
- No screenshots, prompts, replies, or model reasoning are stored.
- Web contributions load only when the plugin is ready. CLI commands remain
  HTTP-thin and preserve global `--json` raw-response/error behavior.
- State transitions are atomic and version-guarded with `expectedVersion`.

## Child Task Map

- `08-24-inspiration-capture` — #33 persistence, CRUD, search/filter/archive.
- `08-24-inspiration-flow` — #34 selector, settings, ledger, job, notification.
- `08-24-inspiration-clients` — shared CLI, Web Inbox/Flow, report, client tests.

## Acceptance Criteria

- [x] All three child tasks meet their acceptance criteria and integrate as one
  `inspiration` plugin.
- [x] README, plugin documentation, Trellis, GitHub #33, and GitHub #34 agree
  on the single-plugin boundary and the removal of schedule conversion scope.
- [x] Disabled/degraded behavior, job non-reentry/timeout, restart/repeated
  polling, notification failure, selector policies, and concurrent updates are
  covered by automated tests.
- [x] `pnpm test`, `pnpm typecheck`, and `pnpm build` pass.
- [x] Trellis validation/spec review is complete and changes are committed on
  `codex/inspiration-plugin` without merging any other branch.

## Authorization

The source request explicitly authorizes the full Trellis development flow,
implementation, validation, documentation synchronization, and commit.

## Notification Contract Repair

- [x] Official notification capability commit `29fe6c3` is introduced with an
  auditable cherry-pick and its SDK/Host tests remain intact.
- [x] Inspiration declares `notifications:send` and consumes the SDK-exported
  function contract instead of a local object-shaped service.
- [x] Flow sends only `{ title, message }`; dedupe and entity identifiers remain
  private delivery-ledger fields.
- [x] Per-channel `sent|disabled|failed` results are persisted in a bounded,
  non-sensitive ledger projection; overall delivery succeeds only when at least
  one channel reports `sent`.
- [x] Real PluginHost integration tests cover missing permission, function
  invocation, channel combinations, and absence of a `.send()` assumption.
- [x] Full test, typecheck, build, diff check, independent review, repair commit,
  and re-archive are complete without rewriting `3ab8946`.
