# Implementation plan

- [x] Snapshot all participating branch heads and dirty worktrees.
- [x] Commit the staged Inspiration fixes on `codex/inspiration-plugin`.
- [x] Merge the latest Schedule branch head into `codex/plugins-integration`.
- [x] Integrate the Inspiration work commit while preserving archived task layout.
- [x] Audit the combined diff for service/manifest/Abort/live-refresh/timezone and
      CLI/Web contract regressions.
- [x] Run focused tests, PostgreSQL integration, full test/typecheck/build and
      `git diff --check`.
- [x] Dispatch an independent final check and resolve verified P0/P1/P2 findings.
- [ ] Commit Trellis/spec bookkeeping, archive this task, and record the session.
- [ ] Push `codex/plugins-integration`, verify PR #36 head/CI, and comment exactly
      `@codex review`.
