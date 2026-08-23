# Flow implementation plan

- [x] Define local notification adapter and service-level error behavior.
- [x] Implement pure selector policy and eligibility explanations.
- [x] Implement Flow settings, candidate reservation, ledger, delivery, snooze,
  and outcome persistence with transactions/version guards.
- [x] Implement manual/settings/delivery routes and scheduled job factory.
- [x] Test policies, dedupe/restart/failure/concurrency, abort, and store mocks.
- [x] Run package typecheck and focused tests; report changed files only.

Validation: `pnpm --filter @echolog/plugin-inspiration typecheck` and
`pnpm exec tsx --test tests/inspiration-flow.test.ts`.
