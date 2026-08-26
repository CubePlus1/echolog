# Design: PR #36 final integration and re-review

## Inputs

- `codex/plugins-integration`: existing PR branch with the initial bundled plugins,
  notification review merge, and the first Schedule Abort review merge.
- `codex/inspiration-plugin`: verified staged Inspiration P2/live-client changes.
- `codex/schedule-plugin`: additive commits `f91b8c7` and `058c1ba`.
- `codex/plugin-notification-service`: already merged through `3bc3c32`.

## Integration strategy

1. Commit the already-staged Inspiration change set without editing its content.
2. Merge Schedule through its branch head so ancestry and review-fix commits remain
   visible.
3. Integrate the new Inspiration work commit without importing the branch's two
   task-layout revert commits. Resolve Trellis task paths into the integration
   branch's existing archive layout and keep the new PR integration task active.
4. Inspect the resulting first-parent and content diff against the remote PR head.

No history rewriting or force push is allowed. The remote update is a normal push
from the checked-out `codex/plugins-integration` worktree.

## Verification and review

Run focused plugin/Host/PostgreSQL tests when available, then the complete root
test, typecheck, build, and diff check. A separate check agent reviews the final
integrated diff and may report findings, but integration conflict resolution stays
owned by the main agent. After a clean push, verify the PR head by GitHub API,
confirm CI is queued/running, and post the exact `@codex review` comment.

## Rollback

Before push, integration commits are append-only and can be corrected by further
commits. If validation fails, do not push. After push, do not rewrite history;
append a corrective commit and request review again.
