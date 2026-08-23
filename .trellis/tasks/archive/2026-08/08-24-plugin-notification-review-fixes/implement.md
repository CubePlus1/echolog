# PR 36 notification and Host review-fix implementation plan

1. Notification implementation agent
   - Update `src/core/notifier.ts` to normalize/rethrow caller `AbortError` while
     retaining structured internal timeout/transport results.
   - Replace the old caller-abort-is-failed assertion with controlled caller
     abort and internal timeout tests in `tests/plugin-notifier.test.ts`.

2. Host implementation agent
   - Move manifest/API validation before the enabled gate in
     `src/core/plugins/host.ts` and keep lifecycle disabled afterward.
   - Extend Host tests for invalid disabled isolation and create a registry-wide
     actual-manifest validation test.

3. Independent reviewer
   - Read the task/spec context, wait for both implementation streams, inspect
     the complete diff without editing it, and run focused tests/typecheck.
   - Report verified findings by severity; implementation agents fix their own
     files if needed.

4. Main-agent integration
   - Synchronize `docs/PLUGIN_API.md` and the backend plugin API spec.
   - Run focused tests, then full `pnpm test`, `pnpm typecheck`, `pnpm build`,
     and `git diff --check`.
   - Mark acceptance, append a fix commit, archive the Trellis repair task, and
     record the session. Do not push or merge.
