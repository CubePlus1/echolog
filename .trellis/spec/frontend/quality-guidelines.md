# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

(To be filled by the team)

---

## Required Patterns

<!-- Patterns that must always be used -->

- Plugin contributions using `loadLive()` must explicitly bridge changed live
  data to rendered plugin faces; Core live DOM patching does not imply plugin
  face rendering.
- Live refresh must be change-sensitive, preserve active input state, and make
  late asynchronous work inert after contribution unmount.
- A contribution that extends a cursor-paginated view in memory must not let a
  later first-page full/live snapshot truncate the visible window. Track the
  authoritative first-page signature separately, merge refreshed DTOs without
  duplicates, and preserve the expanded window's continuation cursor (including
  an exhausted `null`) until the contribution is reset.

---

## Testing Requirements

<!-- What level of testing is expected -->

- Live contribution tests cover changed snapshots, unchanged polling, editing
  deferral, and unmount during an in-flight request.
- Paginated live-view tests cover action-triggered Host rebuilds, later first-page
  changes, DTO replacement/order, cursor exhaustion, and fresh-mount reset.

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
