# Flow implementation plan

- [x] Define local notification adapter and service-level error behavior.
- [x] Implement pure selector policy and eligibility explanations.
- [x] Implement Flow settings, candidate reservation, ledger, delivery, snooze,
  and outcome persistence with transactions/version guards.
- [x] Implement manual/settings/delivery routes and scheduled job factory.
- [x] Test policies, dedupe/restart/failure/concurrency, abort, and store mocks.
- [x] Run package typecheck and focused tests; report changed files only.

## Notification contract repair

- [x] Replace local object service with SDK `PluginNotificationSend`.
- [x] Persist safe channel results with an additive migration and map delivery
  success from channel statuses.
- [x] Update manifest, units/mocks, Web/CLI DTO fixtures, PostgreSQL integration,
  and real PluginHost contract tests.

## PR #36 reliability repair

- [x] Add pre-send at-most-once state and terminal stale recovery.
- [x] Move scheduled key generation into the locked settings transaction.
- [x] Make all failed deliveries terminal/non-actionable and preserve explicit
  diagnostics plus distinct-delivery retry behavior.
- [x] Pass one stable namespaced notification key per delivery and test duplicate
  and retry identities.
- [x] Replace delivery time-only pagination with composite cursor contract.

Validation: `pnpm --filter @echolog/plugin-inspiration typecheck` and
`pnpm exec tsx --test tests/inspiration-flow.test.ts`.
