# Schedule calendar views (#32)

## Goal

Deliver ready-gated Schedule Web pages that present the Issue #31
`schedule_items` data in month, week, and day views and expose only explicit
user actions, satisfying GitHub #32 without a second calendar model.

## Requirements

- Load through the existing bundled Web host and canonical Schedule API;
  disabled/degraded plugins must add no faces or navigation.
- Month, week, and day views derive from the same range-list response, preserve
  timezone-aware display, and distinguish scheduled/awaiting/active/done/
  cancelled without persisting the derived awaiting state.
- Provide create plus explicit confirm-start, snooze, complete, and cancel.
- Escape every dynamic string/attribute, remain compatible with delegated book
  events, and clean plugin-owned CSS on unmount.
- Do not add recurrence, external sync, AI scheduling, record linking, or a
  `calendar_events` data source.

## Acceptance Criteria

- [ ] Month, week, and day faces render the same fixture items in their correct
      range/day positions and use item-provided timezone semantics.
- [ ] Create/confirm/snooze/done/cancel call only canonical routes and include
      the item's current `expectedVersion`.
- [ ] Notification ignore has no Web-side write; awaiting is derived.
- [ ] Dynamic text is escaped and stylesheet activation/unmount is tested.
- [ ] Ready gating is covered by the existing host suite plus Schedule-specific
      contribution tests; no module loads for disabled/degraded.

## Dependency

This child consumes, but does not redefine, the parent item/route contract.
