# Web 书卷分段与翻页性能优化

## Goal

Fix the Web book's growth-related pagination lag while preserving its Chinese editorial 3D-book interaction. Link the implementation to GitHub Issue #26 and deliver a reviewable PR from the dedicated worktree.

## Requirements

- Represent the current calendar month as four fixed books: days 1–7, 8–14, 15–21, and 22–month-end.
- Represent each previous calendar month as one historical book.
- Open the book containing today by default; switching books must preserve the current visual language and retain working keyboard, wheel, drag, timeline, and action controls.
- Render only the selected book's page window in the DOM. A flip must update only the current and nearby sheets, not traverse every historical sheet.
- Keep full record data in memory only as needed for hierarchy and actions; do not poll the full history every five seconds.
- Split live polling from history refresh. Active records, today's summary, and plugin live data may refresh on the existing cadence; history refresh is reserved for structural changes or explicit actions.
- Preserve parent/child links, cross-book navigation, current live-task pages, plugin pages, form handling, input protection, and reduced-motion behavior.
- Update README to document only the implemented product behavior, quick start, plugin architecture, and plugin capabilities. Do not add a future roadmap section.
- Do not regress the API/CLI contract, plugin isolation, screen-time historical compatibility, or tmux-status privacy invariants.

## Acceptance Criteria

- [ ] Current month consistently exposes four books with the specified date ranges, and today opens in the matching book.
- [ ] Previous months appear as one book each; opening a book does not mount unrelated historical pages.
- [ ] With the current dataset and with 1,000 synthetic historical records, DOM/sheet count and one-step flip work are bounded by the selected book/window rather than all history.
- [ ] Browser testing shows no visible flip jank and no long main-thread task attributable to full-book layout; capture before/after DOM and request evidence.
- [ ] The five-second loop no longer requests `/api/records?limit=1000` on every tick; live updates still update timers and current summaries.
- [ ] Existing automated tests, typecheck, build, and CI pass.
- [ ] README is accurate for current features, quick start, plugin design, and bundled plugin functions, with no planning/roadmap claims.
- [ ] GitHub PR links #26, receives a passing Codex review, and reports validation evidence.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
