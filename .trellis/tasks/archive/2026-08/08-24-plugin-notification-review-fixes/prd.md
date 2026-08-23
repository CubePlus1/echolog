# PR 36 notification host review fixes

## Goal

Resolve the PR #36 notification cancellation and disabled-manifest validation
blockers without changing the additive Plugin API v1 request/result shape or
rewriting branch history.

## Requirements

- Caller cancellation and Core-owned transport timeout MUST be distinguishable.
- A caller-provided `AbortSignal` abort MUST reject `notifications.send` with an
  error whose name is `AbortError`; it MUST NOT resolve channel `failed` data.
- Internal delivery timeout, mac callback error, ntfy non-2xx, and ntfy network
  error MUST continue resolving bounded, non-sensitive per-channel `failed`
  results, while unaffected channels retain independent outcomes.
- Abort and timeout paths MUST abort the transport signal and remove timers and
  caller listeners after settlement; late mac callbacks MUST be harmless.
- `validatePluginManifest` and API-version validation MUST run for every bundled
  definition, including disabled definitions, before the Host decides whether
  to migrate/register/start it.
- A valid disabled plugin remains `disabled`. An invalid disabled plugin becomes
  `enabled: false, state: degraded` with diagnostic error metadata, runs no
  migration/register/start/stop lifecycle, and does not block later plugins or
  Core startup.
- Automated tests MUST exercise the real disabled Host path and validate every
  actual definition exported by `bundledPlugins`.
- Plugin API documentation and Trellis backend guidance MUST describe the new
  cancellation and disabled-manifest semantics.
- Changes MUST be appended on `codex/plugin-notification-service`; do not amend,
  rebase, push, or merge `main`.

## Acceptance Criteria

- [x] Pre-aborted and in-flight caller aborts reject with `AbortError` and do not
      return a terminalizable `PluginNotificationResult`.
- [x] Equivalent non-cooperative transports under the internal timeout resolve
      mac/ntfy `failed` results, proving timeout is not conflated with caller
      abort.
- [x] Normal mixed-channel success/failure remains independent.
- [x] A disabled manifest with an unsupported permission is reported degraded,
      has a manifest-validation error, runs no lifecycle or migration, and does
      not prevent a following healthy plugin from becoming ready.
- [x] A valid disabled manifest remains disabled and runs no lifecycle.
- [x] Every current `bundledPlugins` manifest passes runtime validation.
- [x] `pnpm test`, `pnpm typecheck`, `pnpm build`, and `git diff --check` pass.
- [x] An independent reviewer reports no unresolved P0/P1/P2 finding in scope.
- [x] A new fix commit is appended without rewriting existing commits.

## Notes

- Review source: PR #36 at reviewed commit `b751338a0a`; this repair task handles
  only the delegated Core notifier and Host blockers, not the separate
  inspiration flow review comments.
- Original task: `.trellis/tasks/archive/2026-08/08-24-plugin-notification-service/`.
