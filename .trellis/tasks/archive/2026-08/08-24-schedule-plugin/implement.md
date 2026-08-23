# Schedule bundled plugin implementation plan

1. Tracking and planning gate
   - Claim and comment on GitHub #31/#32; link branch and Trellis parent/children.
   - Add README roadmap tracking and set task branch/base/scope metadata.
   - Curate implement/check context and validate all three tasks.
   - Activate both independently verifiable children before parallel dispatch.

2. Parallel implementation (SOL High)
   - Backend agent implements the owned package/server/store/job/test files.
   - CLI agent implements only `el schedule` plus isolated HTTP CLI tests.
   - Web agent implements only plugin Web assets and module tests.
   - Every prompt starts with the active task path and requires reading jsonl,
     PRD, design, implement, and relevant specs before edits.

3. Main-agent integration
   - Add workspace dependency/build ordering, bundled registry/Web asset entry,
     example config, lockfile, README, and `docs/PLUGIN_API.md` schedule section.
   - Verify the package-local notification interface exactly matches the sibling
     task; do not merge that branch or alter shared Host.

4. Focused verification
   - Run Schedule unit, CLI, Web, plugin-host, and integration tests.
   - Exercise manifest validation, canonical routes, raw JSON/error propagation,
     atomic conflicts, reminder dedupe/restart/re-poll, failed channels,
     disabled/degraded isolation, job timeout/non-entry, and Web ready gating.

5. Independent check and finish
   - Dispatch a separate SOL High check agent after implementation completes.
   - Verify every finding against code and tests; fix valid findings.
   - Run `pnpm test`, `pnpm typecheck`, and `pnpm build`.
   - Load `trellis-update-spec`; update specs only for durable conventions.
   - Recheck branch/status/diff, commit milestones, update GitHub issues, archive
     child then parent tasks, and record the session.

## Rollback points

- Before registry/build integration, the new package is inert.
- Setting `plugins.schedule.enabled: false` prevents migration, registration,
  jobs, and Web loading.
- No rollback step drops plugin tables or edits Core record data.
