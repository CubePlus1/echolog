# Capture implementation plan

- [x] Create plugin package metadata, manifest, and strict config schema.
- [x] Add private Drizzle schema and immutable SQL migrations for inspirations,
  Flow settings, and Flow deliveries.
- [x] Implement store CRUD/filter/history with atomic expected-version writes.
- [x] Implement route validation and canonical response/error envelopes.
- [x] Add unit tests with store fakes plus guarded PostgreSQL integration tests
  where useful.
- [x] Run package typecheck and focused tests; report changed files only.

Validation: `pnpm --filter @echolog/plugin-inspiration typecheck` and
`pnpm exec tsx --test tests/inspiration-capture.test.ts`.
