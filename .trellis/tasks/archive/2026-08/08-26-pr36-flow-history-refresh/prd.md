# PR #36 Inspiration Flow history refresh fix

## Goal

Resolve the latest Codex P2 on PR #36 so loaded Flow delivery pages remain
visible across Host refreshes and live polling, without weakening snapshot
invalidation or unmount isolation.

## Requirements

- Preserve accumulated, deduplicated delivery history after “加载更多投递”.
- A subsequent full `load()` or `loadLive()` first-page snapshot must refresh
  matching rows and prepend genuinely newer rows without dropping older pages.
- Preserve correct next-cursor semantics and allow an intentional fresh mount to
  start from the first page.
- Keep request-generation, focus, refresh coalescing, escaping, and unmount
  behavior intact.
- Add non-self-proving automated coverage for action → Host refresh → render and
  live polling after pagination.
- Push only additive commits to `codex/plugins-integration`; do not merge main.

## Acceptance Criteria

- [x] Loaded page-two rows survive action-triggered Host refresh.
- [x] Loaded page-two rows survive later live first-page snapshots, while changed
      first-page rows update correctly.
- [x] Full tests, typecheck, build, diff-check, CI, and latest-head Codex review pass.
- [x] No unresolved P0/P1/P2 findings; Trellis task is archived.

## Notes

- Review: https://github.com/CubePlus1/echolog/pull/36#discussion_r3859983432
