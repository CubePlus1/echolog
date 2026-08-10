# Design: screen-understanding settings and API contract

## Boundaries

The screen-time plugin owns the settings table, defaults, validation, service,
store methods, migration, and route handlers. The host continues to provide
plugin lifecycle, database service, error isolation, and canonical route
registration. Existing `/api/screen/*` compatibility routes remain unchanged;
the new settings routes are canonical-only.

This milestone deliberately stops at configuration. It has no screenshot
capture, image persistence, model/provider invocation, work queue, retry loop,
or consumer of the settings.

## Settings contract

The singleton row is keyed by `id = "default"` and contains the persisted
camelCase fields returned by the API:

- `id`, `version`, `enabled`
- `captureIntervalSeconds`, `captureDisplay`, `skipWhenIdle`
- `providerProfileId`, `requestTimeoutMs`, `maxConcurrency`, `maxAttempts`
- `dailyRequestBudget`, `dailyCostBudgetMicros`, `remoteConsentOrigin`
- `updatedAt`

The PUT request repeats every mutable field and adds `expectedVersion`. The
validator rejects unknown or missing fields, accepts only
`captureDisplay: "active"`,
normalizes the provider profile identifier/origin, and enforces the ranges
documented in `docs/API.md`.

## Concurrency and errors

Before reads and conditional updates, the store performs the same idempotent
default-row insert with `ON CONFLICT DO NOTHING`. The update then performs one
conditional `UPDATE ... WHERE id = 'default' AND version = expectedVersion`,
increments the version in SQL, and uses `RETURNING`. Concurrent first PUTs can
both seed safely, but only one matching CAS update succeeds. A zero-row result
is converted into a 409 response after reading the current version. Validation
returns 400 before any write. Successful GET and PUT responses return the
complete database-shaped settings object.

## Traceability

- Remote discussion and eventual close record: Issue #23.
- Code/API review: PR #22.
- Product milestone: root README.
- Requirements and acceptance: this directory's `prd.md`.
- Execution and verification gates: `implement.md`.
