# Current notification and plugin boundary audit

## Existing behavior

- `src/core/notifier.ts` exposes `notifyMac`, `notifyNtfy`, and a synchronous
  `notify` wrapper. Disabled channels return `undefined`; mac callback errors are
  not observed; ntfy catches network errors; the wrapper catches its promise.
- `src/core/scheduler.ts` invokes `notify(title, message)` without awaiting it.
  This behavior must remain compatible.
- `PluginContext` exposes generic named `service<T>(name)`. The Host currently
  injects only `database.url` and gates it with `database:plugin`.
- `process:exec` is separately enforced by `context.exec`.
- The manifest JSON Schema currently allows any non-empty permission string,
  while runtime validation checks only duplicate values.
- Plugin jobs have non-overlap, hard timeout races, AbortSignal cancellation,
  and reverse-order shutdown. Disabled hooks do not run; startup failures
  degrade one plugin and initialization continues.

## Relevant files

- `packages/plugin-sdk/src/index.ts`
- `packages/plugin-sdk/echolog-plugin.schema.json`
- `src/core/plugins/host.ts`
- `src/core/plugins/create.ts`
- `src/core/notifier.ts`
- `src/core/scheduler.ts`
- `tests/plugin-sdk.test.ts`
- `tests/plugin-host.test.ts`
- `docs/PLUGIN_API.md`
- `.trellis/spec/backend/{index,error-handling,quality-guidelines}.md`
- `.trellis/spec/guides/{index,cross-layer-thinking-guide,code-reuse-thinking-guide}.md`

## Tracking relationship

GitHub #31 (schedule plugin) and #33/#34 (inspiration recording/push) need a
shared notification delivery capability. This task provides only the reusable
Core boundary and explicitly leaves those plugin implementations downstream.
