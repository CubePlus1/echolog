# Bundled Plugin API Guidelines

> How additive Core services cross the Bundled Plugin API v1 boundary.

## Named Core services

Plugin capabilities that need Core-owned behavior use an exact named service
through `PluginContext.service(...)`. Do not add a general event bus, expose the
Fastify instance, expose the Core Drizzle handle, or let a plugin import/write
Core table schemas.

Every privileged service name MUST have one manifest permission and one Host
enforcement mapping. Keep these layers synchronized in the same change:

1. SDK service request/result types and permission vocabulary;
2. `echolog-plugin.schema.json` permission enumeration;
3. `validatePluginManifest` runtime validation;
4. Host named-service permission mapping and Core injection;
5. `docs/PLUGIN_API.md` and contract tests.

Authorization failures throw a structured `PluginError` with
`PLUGIN_DEPENDENCY_MISSING` and identify the requesting plugin. Check permission
before revealing whether a privileged service is installed. Disabled plugin
lifecycle hooks never run; a bad service request during startup degrades only
that plugin and initialization continues with later plugins.

## Notification service pattern

`notifications.send` requires `notifications:send`. The plugin receives only a
typed send function. Core retains global/channel enablement, ntfy server/topic,
credentials, delivery timeouts, and transport dependencies.

Operational delivery outcomes are data, not swallowed exceptions: return both
`mac` and `ntfy` with `sent`, `disabled`, or `failed`. Failed results contain a
bounded, non-sensitive error and never include endpoint URLs, topics, response
bodies, or notification content. A channel failure must not erase the other
channel's outcome.

Bound transport waits with a rejecting timeout race even when an underlying
operation ignores `AbortSignal`; also honor the caller signal and remove timers
and listeners after settlement. Existing Core fire-and-forget callers may keep
a `void` compatibility wrapper, but plugin-facing calls use the result-bearing
primitive so delivery failures remain observable.

## Compatibility checklist

- Treat v1 additions as additive: preserve existing generic service calls,
  bundled manifests, scheduler call signatures, routes, and lifecycle order.
- Test permission denied and allowed paths, disabled hooks, degraded-plugin
  isolation, per-channel outcomes, non-2xx responses, abort/timeout behavior,
  and legacy caller compatibility.
- Run the SDK test/build before root tests when workspace packages have not yet
  produced their `dist` type entrypoints; finish with root `test`, `typecheck`,
  and `build`.
