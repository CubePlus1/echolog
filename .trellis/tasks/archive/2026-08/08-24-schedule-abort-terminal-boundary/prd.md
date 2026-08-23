# Fix Schedule abort terminalization boundary

## Goal

Resolve PR #36's Schedule P1 so a Host timeout or daemon stop cannot let a
late notification continuation terminalize an uncertain reminder claim.

## Requirements

- In `pollDueReminders`, a caught error MUST be rethrown before
  `finishReminder` when the caller signal is aborted or the error is an
  `AbortError`.
- After `notifications.send` settles, the caller signal MUST be checked before
  validating/finalizing a sent or failed result.
- Every sent/failed persistence boundary MUST be preceded by an abort check;
  caller abort retains the ledger in `claimed` for diagnosis.
- Caller abort MUST NOT modify the Schedule item, increment terminal counters,
  or record a misleading failed/sent delivery.
- Normal notification channel failures and non-abort service errors MUST still
  terminalize deterministically as `failed`.
- Tests MUST replace the old abort-to-failed expectation and exercise actual
  PluginHost timeout, stop, and late resolve/reject behavior.
- The fix MUST consume the formal SDK caller `AbortSignal` contract only; it
  MUST NOT copy or modify Core notifier implementation.

## Acceptance Criteria

- [x] Pre-abort, in-flight caller abort, AbortError rejection, late success
      after timeout, and late rejection after stop all retain `claimed`.
- [x] Internal channel `failed` and ordinary non-abort throw still finalize
      `failed`.
- [x] A real PluginHost timeout releases `job.running`, records
      `PLUGIN_TIMEOUT`, and the late Schedule continuation performs no
      terminal ledger write.
- [x] A real PluginHost stop aborts the job and the late continuation performs
      no terminal ledger write.
- [x] Focused tests, PostgreSQL integration, `pnpm test`, `pnpm typecheck`,
      `pnpm build`, and diff-check pass.
- [x] Independent review of the final diff reports no P0-P2.
- [x] Commits are appended on `codex/schedule-plugin`; no history rewrite,
      push, or merge occurs.
