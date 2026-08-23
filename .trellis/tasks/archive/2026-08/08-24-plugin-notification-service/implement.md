# Bundled Plugin API v1 notification service implementation plan

1. Synchronize tracking and contracts
   - Create/claim a GitHub enhancement issue linked to #31, #33, and #34.
   - Record branch, base branch, and backend/cross-layer scope in Trellis.
   - Add SDK notification request/result/send types and supported permission
     vocabulary; update runtime validation, manifest JSON Schema, and docs.

2. Implement Core delivery and Host injection
   - Refactor `src/core/notifier.ts` around a bounded, abort-aware,
     result-bearing `sendNotification` primitive with injectable seams for
     deterministic tests.
   - Preserve `notify(title, message): void` for the existing scheduler.
   - Inject `notifications.send` from `createPluginHost` and enforce
     `notifications:send` in `PluginHost.service`.

3. Add automated coverage
   - SDK/schema contract tests for supported and unknown permissions.
   - Notifier tests for disabled, sent, failed, non-2xx, aggregate, abort, and
     timeout results without contacting real notification services.
   - Host tests for permission denial/allowance, unavailable service behavior,
     disabled lifecycle isolation, and degraded-plugin continuation.
   - Scheduler compatibility test or type/behavior assertion proving the void
     wrapper remains non-rejecting.

4. Parallel ownership after task activation
   - SDK/protocol agent owns `packages/plugin-sdk/**`, `docs/PLUGIN_API.md`, and
     its SDK/schema tests.
   - Core agent owns `src/core/notifier.ts`, `src/core/plugins/{host,create}.ts`,
     and Core-focused tests it creates.
   - Test/review agent initially owns analysis and a separate regression test
     file; it must not edit another agent's owned files during the first pass.
   - Main agent integrates conflicts, updates README/Trellis/specs, and runs the
     final full-scope review.

5. Verification and finish
   - Run focused tests during integration, then `pnpm test`, `pnpm typecheck`,
     and `pnpm build`.
   - Review backend and cross-layer quality checklists, update the backend spec
     with the named-service/permission/result convention, inspect the full diff,
     and commit coherent work on the task branch.
   - Close the GitHub issue only after acceptance, archive the Trellis task,
     update README tracking, and record the session per repository workflow.
