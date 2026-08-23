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
the delivery as failed and is visible in diagnostics/ledger. The official
notification capability is integrated at `8484b48`; its Core Host wiring owns
`notifications.send`, while Inspiration owns only lazy resolution and its
delivery ledger.

Rollback is removal from the bundled registry/config; plugin-owned tables are
left intact to preserve user data.

## Official notification integration repair

The authoritative baseline is original commit `29fe6c3`, cherry-picked on this
branch as `8484b48`. It exports `PluginNotificationSend` and
`PluginNotificationResult`, registers a function-valued `notifications.send`
service, and gates it with manifest permission `notifications:send`.

Inspiration must not wrap or redefine that service. It lazily resolves the SDK
function and calls it with only `{title, message}`. Delivery `dedupeKey`,
`inspirationId`, and `deliveryId` never cross the Core service boundary. A new
append-only plugin migration stores the exact bounded per-channel result
projection in the delivery ledger. One or more `sent` channels means delivered;
all-disabled/all-failed/mixed-disabled-failed means not delivered. Thrown service
errors remain generic in the ledger so notification content cannot be reflected.
