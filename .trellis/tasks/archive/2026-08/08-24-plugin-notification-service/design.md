# Bundled Plugin API v1 notification service design

## Boundary and contract

The service is obtained as:

```ts
const sendNotification = context.service("notifications.send");
const result = await sendNotification(
  { title: "Reminder", message: "Stand-up starts in five minutes" },
  signal
);
```

The SDK owns these public types:

```ts
type PluginNotificationChannel = "mac" | "ntfy";
type PluginNotificationStatus = "sent" | "disabled" | "failed";

interface PluginNotificationRequest {
  title: string;
  message: string;
}

type PluginNotificationChannelResult =
  | { status: "sent" }
  | { status: "disabled" }
  | { status: "failed"; error: string };

interface PluginNotificationResult {
  channels: Record<PluginNotificationChannel, PluginNotificationChannelResult>;
}

type PluginNotificationSend = (
  request: PluginNotificationRequest,
  signal?: AbortSignal
) => Promise<PluginNotificationResult>;
```

The exact named service is `notifications.send`; schedule and inspiration
plugins MUST request this name and declare `notifications:send`.

## Data flow

```text
Plugin manifest notifications:send
  -> PluginContext.service("notifications.send") permission check
  -> Core-owned PluginNotificationSend adapter
  -> sendNotification({title,message}, signal)
  -> mac + ntfy bounded delivery in parallel
  -> per-channel sent | disabled | failed result
  -> plugin decides whether/how to react
```

The adapter closes over Core configuration. No config object, ntfy server/topic,
or credential-bearing value crosses the plugin boundary.

## Notifier implementation

`sendNotification` is the result-bearing Core primitive. It reads current Core
configuration once, evaluates global and per-channel enablement, and runs mac
and ntfy delivery independently. Each channel converts operational failure into
a structured `failed` result; no channel failure erases the other channel's
result. Error text is normalized and bounded without embedding endpoint URLs or
request bodies.

mac delivery wraps `node-notifier`'s callback and has a host timeout/abort race.
ntfy uses `fetch` with an abortable composed timeout and treats non-2xx as
failure. The fixed delivery timeout is an internal Core policy, not plugin
configuration.

The existing `notify(title, message): void` remains as a compatibility wrapper:
it starts `sendNotification` and intentionally consumes the returned promise.
The scheduler therefore remains fire-and-forget and cannot be stopped by a
delivery failure, while plugin callers use the explicit result-bearing service.

## Permission and manifest enforcement

The SDK defines the supported permission vocabulary:
`process:exec`, `database:plugin`, and `notifications:send`. Runtime manifest
validation rejects unknown values and duplicates; the JSON Schema uses the same
enumeration.

The Host maps named services to required permissions. Access to
`notifications.send` without `notifications:send` throws `PluginError` with
code `PLUGIN_DEPENDENCY_MISSING`, status 403, and the requesting plugin's current
state. The same centralized mapping continues enforcing `database.url`.

Disabled plugin hooks never execute. A plugin that requests an unauthorized or
unavailable service during registration/startup becomes degraded without
preventing subsequent plugins from becoming ready. Existing job timeout and
shutdown abort semantics remain unchanged; the notification send function also
honors the job's signal.

## Compatibility and non-goals

This is additive within `apiVersion: "1"`: existing manifests, Context calls,
HTTP routes, scheduler callers, and bundled plugins keep their current behavior.
No current bundled plugin needs the new permission.

There is no event bus, dynamic plugin loading, Fastify exposure, Core database
handle exposure, Core-table write API, notification configuration read API, or
schedule/inspiration plugin implementation in this task.

## Rollback

The new SDK types, permission value, service injection, and notifier primitive
form one coherent extension. Rollback removes those additions while retaining
the legacy `notify` implementation/calls; no database migration or stored data
is involved.
