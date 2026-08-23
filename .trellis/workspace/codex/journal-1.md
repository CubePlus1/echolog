# Journal - codex (Part 1)

> AI development session journal
> Started: 2026-08-24

---



## Session 1: Bundled Plugin API v1 notification service

**Date**: 2026-08-24
**Task**: Bundled Plugin API v1 notification service
**Branch**: `codex/plugin-notification-service`

### Summary

Added notifications.send with notifications:send permission enforcement, structured mac/ntfy delivery results, timeout/privacy isolation, SDK/schema/docs/spec updates, and regression tests; pnpm test/typecheck/build passed.

### Main Changes

- Added the `notifications.send` named Core service and SDK request/result types.
- Enforced `notifications:send` across TypeScript validation, JSON Schema, and Host lookup.
- Refactored Core delivery to return independent mac/ntfy results with bounded timeout and abort behavior.
- Preserved the legacy scheduler-facing `notify(title, message): void` wrapper.
- Added Plugin API/README/backend-spec documentation and permission, delivery, compatibility, and isolation tests.

### Git Commits

| Hash | Message |
|------|---------|
| `29fe6c3` | (see git log) |
| `3bd3f38` | (see git log) |

### Testing

- [OK] `pnpm test` — 113 tests, 112 passed, 1 platform-conditional skip
- [OK] `pnpm typecheck`
- [OK] `pnpm build`
- [OK] `git diff --check`

### Status

[OK] **Completed**

### Next Steps

- Schedule plugin #31 and inspiration plugins #33/#34 can adopt the new service contract independently.


## Session 2: PR 36 notification and Host review fixes

**Date**: 2026-08-24
**Task**: PR 36 notification and Host review fixes
**Branch**: `codex/plugin-notification-service`

### Summary

Fixed caller AbortError propagation and queued-transport cancellation race; validated disabled manifests before lifecycle gating; added dynamic bundled-manifest coverage; independent re-review found no unresolved P0/P1/P2; full tests/typecheck/build passed.

### Main Changes

- Propagated caller cancellation as `AbortError` while keeping internal transport timeouts result-bearing.
- Prevented queued mac/ntfy transports from dispatching after an immediate caller abort.
- Validated every manifest/API version before the Host disabled gate and isolated invalid disabled definitions.
- Added non-tautological abort/timeout tests, disabled lifecycle counters, and dynamic bundled-registry validation.
- Synchronized Plugin API documentation and backend guidance with the repaired semantics.

### Git Commits

| Hash | Message |
|------|---------|
| `fdd22d9` | (see git log) |
| `4c5f55f` | (see git log) |

### Testing

- [OK] `pnpm test` — 117 tests, 116 passed, 1 platform-conditional skip
- [OK] `pnpm typecheck`
- [OK] `pnpm build`
- [OK] `git diff --check`
- [OK] Independent re-review — no unresolved P0/P1/P2 in scope

### Status

[OK] **Completed**

### Next Steps

- Integrate `fdd22d9` into the PR #36 branch and request Codex review on the resulting latest commit.
