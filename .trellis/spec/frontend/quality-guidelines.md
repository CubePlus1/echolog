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

---

## Testing Requirements

<!-- What level of testing is expected -->

- Live contribution tests cover changed snapshots, unchanged polling, editing
  deferral, and unmount during an in-flight request.

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
