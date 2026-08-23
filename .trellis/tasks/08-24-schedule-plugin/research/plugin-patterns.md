# Schedule reference research

## Sources read

- `AGENTS.md`, `.trellis/workflow.md`, backend/frontend specs, and cross-layer
  guides.
- `docs/PLUGIN_API.md` and `packages/plugin-sdk` manifest/context contracts.
- tmux-status manifest/config/schema/migrations/store/routes/index/CLI package
  layout and its contract/migration/adapter test organization.
- screen-time manifest/config/schema/store/index/routes/Web contribution,
  plugin-host Web gating, lifecycle/job behavior, and unit/integration tests.
- GitHub #31/#32 and README plugin/roadmap sections.
- The sibling notification-service Trellis PRD/design/plan, read-only, for the
  exact pending `notifications.send` signature and permission name.

## Confirmed repository patterns

- Bundled plugins are explicit workspace imports; no runtime filesystem loading.
- Plugin database access uses a private postgres/drizzle store and immutable
  plugin migrations tracked by Host.
- Disabled plugins do not migrate or start. One degraded plugin does not block
  later plugins. Canonical routes are guarded by Host readiness.
- Host jobs are interval-driven, non-overlapping, abort-aware, and release their
  running marker after a rejecting timeout race.
- CLI is a shared HTTP thin client; `--json` returns raw bodies and errors exit
  non-zero on stderr. Web contributions load only while enabled and ready.
- All database instants use `TIMESTAMPTZ`; state transitions use conditional
  atomic UPDATE rather than read-decide-write.

## Notification contract dependency

The independently planned service is exactly `notifications.send`, gated by
manifest permission `notifications:send`, accepting `{title,message}` plus an
optional signal and returning independent `mac`/`ntfy` results with
`sent | disabled | failed`. Schedule locally mirrors only that consumer type.

## Product decisions supplied by the user

- Reminder arrival never starts work or creates a Core record.
- Confirming is explicit and timestamps the confirmation moment.
- Ignoring does nothing; snooze only moves the next reminder; done/cancel are
  explicit; no fake macOS action callback.
- Calendar views project the schedule table instead of creating another model.
- Recurrence, calendar sync, AI scheduling, Inspiration conversion, and Core
  record linkage are excluded.
