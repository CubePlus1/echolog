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
- No current Host service named `notifications.send` exists in this branch.
  Inspiration therefore defines only a local generic interface and resolves the
  service lazily; the separate notifications worktree owns Host wiring.
