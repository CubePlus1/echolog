# Bundled plugin research notes

- `docs/PLUGIN_API.md` and `packages/plugin-sdk` define API v1. Routes are
  discovered while disabled/degraded but Host checks ready state before handler.
- `PluginHost` owns non-overlap and rejecting timeout races for registered jobs;
  plugin jobs still need durable idempotency because daemon restarts lose memory.
- `screen-time` demonstrates private SQL migration, store lifecycle, report
  contribution, and ready-only Web module activation.
- `tmux-status` demonstrates strict boundary validation, canonical routes,
  persistence dedupe, job registration, and mockable PluginContext tests.
- CLI commands are composed in `src/cli/index.ts`; plugin `src/cli.ts` currently
  supplies contribution metadata only, so the new command remains a thin HTTP
  adapter at the composition point.
- Web Shell calls contribution `load`, `loadLive`, `faces`, `renderFace`, and
  `handleAction`, and imports a module only when `/api/plugins` reports ready.
- At initial research time no Host service named `notifications.send` existed
  on this branch. That finding is superseded by official commit `29fe6c3`,
  cherry-picked here as `8484b48`: Inspiration now imports the SDK function
  contract, resolves it lazily, and leaves Host wiring to Core.
