# PR #36 Code Review Findings

Source: GitHub PR #36 review at commit `b751338a0a`, plus the delegated
reliability requirements for this worktree.

- P1: notification can be externally delivered before DB finalization; stale
  resend is unsafe because official `PluginNotificationSend` has no dedupe key.
  Resolution: at-most-once after pre-send claim; stale rows terminally fail
  unknown and are never re-sent.
- P2: scheduled key used an interval read outside the settings-lock transaction.
- P2: delivery timestamp-only pagination skips equal-timestamp rows.
- P2: HTTP accepted timezone-less date filters; HTTP and CLI must share strict
  offset-aware validation.
- P2: real PostgreSQL regressions are required here even though CI workflow
  wiring belongs to the integration branch.
- Additional inline P2: manually surfaced notification failures were displayed
  with outcome buttons but backend rejected every outcome.

Schedule remains completely outside this plugin and repair.

## Latest review at PR head `d384adb` (2026-08-26)

- Failed manual deliveries must not masquerade as actionable user-visible
  candidates. Resolution: every failed delivery is terminal and diagnostic;
  only sent deliveries can accept outcomes. Retrying creates a new bucket and
  delivery.
- `notifications.send` needs a stable, collision-resistant delivery key.
  Resolution: add the optional SDK request field compatibly and pass
  `inspiration:${delivery.dedupeKey}`. The plugin ledger remains authoritative
  because compatible providers may ignore this hint.
- Reconfirm the `(surfaced_at,id)` cursor against equal-timestamp and boundary
  regressions. No Schedule dependency is introduced.

## Latest Web live-refresh review (2026-08-26)

- Inspiration `loadLive()` updated closure snapshots, but the Shell's
  `liveSignature()` and `patchLiveDom()` cover only Core faces, leaving mounted
  Inbox/Flow DOM stale after scheduled Flow or another client writes.
- Resolution: compare presented Inbox/Flow snapshot signatures and use the
  activation-time Host `refresh` callback only after a real change. Defer while
  a page input is active, keep the old optimistic client state until refresh,
  and invalidate in-flight work on unmount.
- Independent review found that advancing the presented signature only after a
  slow refresh allowed a second overlapping poll to start another rebuild for
  the same snapshot. The final implementation gates new polls behind one
  `refreshInFlight` promise and includes an overlap regression; re-review found
  no remaining P0/P1/P2.
