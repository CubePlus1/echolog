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
