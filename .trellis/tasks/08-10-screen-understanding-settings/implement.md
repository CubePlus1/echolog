# Implementation plan

1. Confirm PR #22's base/head and authoritative unresolved review threads;
   create/link Issue #23 and set this task's branch/base metadata.
2. Add the README roadmap milestone and commit the tracked Trellis PRD,
   design, implementation plan, and task metadata as the traceability
   milestone.
3. Add the complete settings endpoint contract to `docs/API.md`, including
   full PUT JSON, ranges, normalization, success shape, 400, and 409.
4. Run scoped review checks: inspect the staged diff, run unit tests,
   `pnpm typecheck`, `pnpm build`, and run the integration test when an
   explicit `ECHOLOG_TEST_DATABASE_URL` is available.
5. Push both milestone commits fast-forward to
   `origin/codex/screen-understanding-plan`, update PR #22 description with
   Issue #23 and the verification results, and leave the PR unmerged.
6. Reply to and resolve only the two addressed review threads after the
   pushed commit is visible, then post `@codex review` and inspect the newest
   review result for blockers.
7. Address the follow-up first-PUT P2 by ensuring the default row before the
   CAS update, adding a fresh-database HTTP regression, rerunning validation,
   and requesting review on the new commit.

## Validation commands

- `pnpm test`
- `pnpm typecheck`
- `pnpm build`
- `ECHOLOG_TEST_DATABASE_URL=... pnpm test:integration`
- `git diff --check`
- `git diff --cached --stat` and `git diff --cached --name-status`

## Rollback points

- Before staging, edit only `README.md`, `docs/API.md`, and this task
  directory; preserve unrelated worktree state.
- If verification fails, keep the task and issue open, report the blocker, and
  do not resolve review threads or request final review.
- After push, any rollback must be a new revert commit; do not force-push or
  merge PR #22.
