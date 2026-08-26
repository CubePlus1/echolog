# Inspiration parent implementation plan

- [x] Finalize shared DTO/domain types and file ownership.
- [x] Activate parent and all children after context validation.
- [x] In parallel dispatch Capture, Flow, and Clients SOL High agents with
  explicit Active task paths and non-overlapping ownership.
- [x] Integrate package `index.ts`, root workspace dependency/build registry,
  Web assets, report section, and public docs.
- [x] Synchronize README and GitHub #33/#34 scope/tracking.
- [x] Run focused, full test, typecheck, build, Trellis validate, and absence
  searches for schedule/prompt/reply/screenshot persistence.
- [x] Dispatch an independent SOL High check agent against the latest diff;
  fix findings and rerun the full suite.
- [x] Review/update specs if a reusable bundled-plugin pattern was learned.
- [x] Commit coherent changes on `codex/inspiration-plugin` and record session.

## Notification contract repair iteration

- [x] Cherry-pick official notification service commit without rewriting prior
  Inspiration commits.
- [x] Replace local service object/request/result types with SDK function types.
- [x] Add manifest permission, per-channel ledger migration, and delivery logic.
- [x] Replace mocks and add real PluginHost contract integration tests.
- [x] Run independent check, full validation, append repair commit, and re-archive.

## PR #36 review iteration

- [x] Implement at-most-once dispatch and settings-snapshot dedupe in Store/Flow.
- [x] Implement composite delivery cursor and shared offset-aware ISO validation
  across HTTP/CLI/Web.
- [x] Add the required real PostgreSQL race/crash/pagination regressions.
- [x] Integrate three parallel implementations and run focused/full checks.
- [x] Dispatch an independent SOL High reviewer, fix findings, append commit,
  update PR tracking, and re-archive.

## PR #36 Web live-refresh iteration

- [x] Compare Inspiration `loadLive` behavior with the actual Web Host polling,
  contribution refresh, editing, and unmount contracts.
- [x] Add change-sensitive Host invalidation with editing deferral and stale
  request/unmount guards without changing global Host polling.
- [x] Add automated changed/unchanged/deferred/unmounted live snapshot tests.
- [x] Run full validation and independent P0-P2 review; close the reviewer's
  overlapping-refresh P2 with a coalescing regression.
- [ ] Append one commit with all accumulated Inspiration repairs.

Rollback points: before root registry integration; before docs/Issue update;
before commit. Never merge another branch.
