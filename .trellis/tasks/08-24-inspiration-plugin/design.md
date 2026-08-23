# Inspiration integration design

## Architecture

```text
CLI / ready-only Web
        |
/api/plugins/inspiration/*
        |
Capture routes/store ---- private inspirations table
        |
Flow routes/job -> shared selector -> private settings/delivery ledger
                                      |
                      PluginContext.service("notifications.send")
```

Schedule, Core records, and other plugin tables are outside every boundary.

## Shared contracts and root ownership

The parent/main session exclusively owns:

- `plugins/inspiration/src/types.ts` — DTO/domain interfaces shared by agents.
- `plugins/inspiration/src/index.ts` — composes Capture and Flow, registers job
  and report, and lazily passes the notification service.
- `src/core/plugins/registry.ts`, root `package.json`, lockfile, Web asset
  registry, README/docs, and Trellis/GitHub tracking.

No implementation agent may edit another agent's files. Integration changes
wait until all three implementation agents finish.

## Domain split

Inspiration lifecycle (`inbox|kept|archived`, version, content/tags/project)
is independent from Flow delivery (`reserved|sent|failed|acted`, outcome,
snoozedUntil). `later` cannot touch lifecycle. `kept` and `archived` are the
only Flow outcomes that deliberately change lifecycle, in the same transaction
as delivery outcome and guarded by both expected versions.

## APIs

All routes are canonical `/api/plugins/inspiration/*`. DTO dates are ISO 8601.
Errors retain top-level `error`; validation uses 400, missing rows 404, and
optimistic/dedupe conflicts 409 with structured version context.

## Rollout and dependency

The plugin is bundled and enabled by default for capture. The Flow send service
is resolved only when a notification is attempted, so missing notification
capability does not disable capture. A missing or failed service call finalizes
the delivery as failed and is visible in diagnostics/ledger. Once the separate
notifications worktree registers `notifications.send`, no plugin code change
should be required.

Rollback is removal from the bundled registry/config; plugin-owned tables are
left intact to preserve user data.
