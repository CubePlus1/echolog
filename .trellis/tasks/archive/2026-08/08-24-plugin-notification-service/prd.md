# Bundled Plugin API v1 notification service

## Goal

Extend Bundled Plugin API v1 with a permission-gated Core notification
capability so first-party schedule and inspiration plugins can request delivery
without learning notification credentials or importing Core internals.

## Requirements

- The additive v1 contract MUST expose the exact named Core service
  `notifications.send` through `PluginContext.service(...)`.
- A manifest MUST declare `notifications:send` before the Host returns that
  service. Missing permission MUST raise the structured
  `PLUGIN_DEPENDENCY_MISSING` error for the requesting plugin.
- The service request MUST contain only a notification `title` and `message`.
  Notification enablement, ntfy server/topic, and all credentials or deployment
  details remain Core-owned and MUST NOT be observable by plugins.
- The service response MUST report both `mac` and `ntfy` independently with one
  of `sent`, `disabled`, or `failed`; a failed channel MUST include a bounded,
  non-sensitive error message and MUST NOT be silently converted to success.
- Core notifier delivery MUST treat ntfy non-2xx responses as failures and MUST
  bound/abort delivery waits. A caller-provided `AbortSignal` MUST be honored.
- Existing Core scheduler call sites and fire-and-forget behavior MUST remain
  source-compatible: notification delivery failures MUST NOT reject or stop the
  reminder loop.
- Disabled plugins MUST never receive or invoke services because their
  lifecycle hooks do not run. Permission or startup failures MUST degrade only
  the offending plugin and MUST NOT block later plugins or Core startup.
- The extension MUST NOT add a general event bus, expose Fastify or the Core
  Drizzle handle, or permit plugins to write Core tables.
- SDK types, runtime manifest validation, JSON Schema, Host injection, API
  documentation, README/Trellis/GitHub tracking, and automated tests MUST stay
  synchronized.

## Acceptance Criteria

- [x] `PluginNotificationSend` accepts `{ title: string; message: string }` plus
      an optional `AbortSignal` and resolves to `{ channels: { mac, ntfy } }`.
- [x] Each channel value has `{ status: "sent" | "disabled" | "failed" }` and
      only failed values include an `error` string.
- [x] Manifest TypeScript validation and JSON Schema accept
      `notifications:send`, reject unknown permissions, and continue accepting
      the existing `process:exec` and `database:plugin` permissions.
- [x] A plugin without `notifications:send` gets a 403
      `PLUGIN_DEPENDENCY_MISSING`; a permitted plugin receives only the send
      function, never notification configuration.
- [x] Tests cover global/channel disablement, mac success/failure, ntfy
      success/non-2xx/network failure, result aggregation, abort/timeout
      behavior, scheduler compatibility, disabled lifecycle isolation, and
      degraded-plugin isolation.
- [x] `pnpm test`, `pnpm typecheck`, and `pnpm build` pass.
- [x] The task is committed on `codex/plugin-notification-service` and is not
      merged into another branch.

## Notes

- Downstream consumers are GitHub Issues #31 (schedule plugin) and #33/#34
  (inspiration recording/push). This task establishes their shared Core service
  contract but does not implement those plugins.
