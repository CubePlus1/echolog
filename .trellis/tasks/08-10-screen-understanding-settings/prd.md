# screen-understanding settings and API contract

## Goal

Deliver the first, configuration-only slice of screen understanding for the
screen-time plugin. Users must be able to inspect and update one persisted,
versioned settings object through the canonical HTTP API, while the feature
remains ready for later work without implementing capture or model execution.

Tracking: GitHub Issue [#23](https://github.com/CubePlus1/echolog/issues/23),
implementation PR [#22](https://github.com/CubePlus1/echolog/pull/22).

## Requirements

- Persist a singleton settings row with an idempotent additive plugin
  migration and defaults that can be loaded after a service restart.
- Expose canonical `GET` and `PUT`
  `/api/plugins/screen-time/understanding/settings` routes.
- Make `PUT` a full-object update. Require `expectedVersion` and every
  settings field; reject unknown fields, invalid identifiers/origins, and
  values outside the implementation's documented ranges with HTTP 400.
- Use an atomic version precondition. A matching `expectedVersion` increments
  the stored version and returns the complete updated object; a stale version
  returns HTTP 409 with `currentVersion` and does not overwrite the row.
- Keep all behavior inside the screen-time plugin boundary and preserve the
  existing compatibility APIs.
- Keep the scope limited to settings persistence and its API contract. Do not
  add screenshot capture, image storage, model/provider calls, scheduling,
  queueing, retry workers, or downstream understanding behavior.
- Keep the product route, Trellis task, GitHub Issue, PR, and API document
  cross-linked so a remote reviewer can verify the same acceptance criteria.

## Acceptance Criteria

- [ ] GitHub Issue #23 is open and links this task, README milestone, API
      contract, and PR #22.
- [ ] README contains a screen-understanding roadmap milestone linking Issue
      #23, PR #22, this Trellis task, and the explicit non-goals.
- [ ] This tracked PRD and its implementation/validation plan are committed
      under `.trellis/tasks/08-10-screen-understanding-settings/`.
- [ ] The migration can run repeatedly; the default object is readable, and
      values/version survive a store reload.
- [ ] GET returns the complete settings object; PUT requires the complete
      payload and documents all fields and ranges.
- [ ] Valid PUT updates atomically and increments `version`; stale PUT returns
      409 with `currentVersion`.
- [ ] `docs/API.md` documents both endpoints, the full payload, field ranges,
      successful response, 400 validation response, and 409 conflict response.
- [ ] Applicable unit, typecheck, build, and integration verification passes
      (integration is run when `ECHOLOG_TEST_DATABASE_URL` is available).
- [ ] No screenshot, model-call, image-storage, queue, or later-subtask code
      is added by this milestone.

## Notes

- README is the product-roadmap surface; this PRD is the durable requirements
  and acceptance surface; Issue #23 is the remote discussion/close record.
- The task files are normally ignored by `.trellis/.gitignore`, but the
  repository already tracks completed/active task directories. This task must
  be explicitly staged so the traceability is present in the PR.
