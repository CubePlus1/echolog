# Inspiration capture and organization (#33)

## Goal

Provide durable, standalone inspiration capture and organization without an
active EchoLog record and without any Schedule dependency.

## Requirements

- Own the plugin manifest/config package skeleton plus private inspiration and
  Flow table migrations/schema needed by the complete plugin.
- Create inspirations with content, normalized tags, optional free-form
  project, and lifecycle status `inbox` or `kept`.
- List and search by text, tag, project, lifecycle status, archived state,
  creation time, pagination cursor/limit, and deterministic ordering.
- Fetch and version-guard edits; archive/restoration are explicit lifecycle
  operations and historical rows remain queryable.
- Validation happens at the route boundary; persistence updates use field
  whitelists and atomic `WHERE id = ... AND version = expectedVersion` writes.
- No API or table references Core records, tasks, schedules, or another plugin.

## Acceptance Criteria

- [x] Canonical `/api/plugins/inspiration/inspirations*` endpoints implement
  create/list/get/update/archive/restore with structured 400/404/409 errors.
- [x] Capture succeeds with no active Core record.
- [x] Text/tag/project/status/archive filters and history ordering are tested.
- [x] Concurrent stale `expectedVersion` updates cannot overwrite newer data.
- [x] Migrations are ordered, immutable, idempotent, and private to the plugin.
- [x] Tests prove no schedule API call or cross-plugin relation exists.
