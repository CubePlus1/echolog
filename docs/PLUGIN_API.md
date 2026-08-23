# Bundled Plugin API v1

## Status and scope

Bundled Plugin API v1 is the internal extension contract for first-party
plugins shipped and built with EchoLog. It is stable through manifest,
TypeScript and HTTP contract tests.

It is not a third-party installation format, binary ABI, sandbox, marketplace,
or permission boundary against malicious code. EchoLog never scans npm,
GitHub, or arbitrary filesystem paths for executable plugins.

The protocol uses the requirement terms MUST, MUST NOT, SHOULD and MAY in their
usual normative sense.

## Package layout

Each plugin is a workspace package under `plugins/<id>` and MUST include:

```text
plugins/<id>/
├── echolog.plugin.json
├── config.schema.json
├── package.json
├── src/
└── web/                 # only when entries.web is declared
```

The build-time registry explicitly imports every server definition. Manifest
entry paths are build and audit metadata; the runtime MUST NOT dynamically
import an arbitrary server or CLI path from configuration.

## Manifest

`echolog.plugin.json` is validated against
`packages/plugin-sdk/echolog-plugin.schema.json`.

| Field | Contract |
| --- | --- |
| `manifestVersion` | MUST be `1` |
| `id` | Stable lowercase kebab-case, at most 64 characters |
| `version` | Plugin semantic version |
| `apiVersion` | Host SDK version, currently `"1"` |
| `entries` | Declared server, CLI and/or Web build entries |
| `capabilities` | Reader-facing feature declarations |
| `permissions` | Host API permissions requested by the plugin |
| `requires` | Core API, platform and executable requirements |
| `configSchema` | JSON Schema path for plugin configuration |

Published plugin IDs MUST NOT change. Capabilities and permissions MUST NOT
contain duplicates.

## Trust and permissions

Bundled plugins run in the daemon process and are trusted code. Permissions
restrict Host APIs and make review scope explicit:

| Permission | Host capability |
| --- | --- |
| `process:exec` | Bounded `execFile` command runner; no shell |
| `database:plugin` | Database URL for plugin-owned tables |
| `notifications:send` | Core-owned `notifications.send` delivery service |

A plugin without the corresponding declaration receives a structured
`PLUGIN_DEPENDENCY_MISSING` error. Plugins MUST NOT import Core table schemas or
write Core records directly. Manifests that declare any permission outside this
fixed vocabulary are invalid.

## Lifecycle

The Host initializes plugins in registry order:

```text
disabled
  -> validating
  -> migrating
  -> starting
  -> ready | degraded
  -> stopping
```

Disabled plugins MUST NOT migrate, register jobs, or start. One plugin's
validation, migration or startup failure changes that plugin to `degraded` and
MUST NOT prevent later plugins or Core from starting. Shutdown occurs in reverse
registry order with a five-second timeout.

Configuration changes take effect after daemon restart. Runtime hot install,
enable, disable and unload are not supported in v1.

## PluginContext

The SDK exposes:

- immutable normalized plugin configuration;
- structured logger;
- namespaced route registration;
- non-overlapping scheduled jobs with a rejecting timeout race and
  `AbortSignal` cancellation;
- optional Markdown daily-report sections;
- bounded external command execution;
- explicitly named Core services.

It does not expose the Fastify instance, the Core Drizzle handle, a general
event bus, shell execution, or hooks that replace Core record statistics.

Job timeouts do not assume cooperative cancellation. The Host aborts the
signal and also rejects the scheduler's awaited race, so an operation that
ignores `AbortSignal` cannot leave the job permanently marked as running.

`PluginCommandRequest.stdin` is an optional bounded UTF-8 payload (host ceiling
64 KiB). It is written directly to child stdin and MUST NOT be copied into
argv, environment variables, logs, or errors. Execution remains no-shell.

### Notification service

A plugin that declares `notifications:send` obtains the exact named service
from its context:

```ts
const sendNotification = context.service("notifications.send");
const result = await sendNotification(
  {
    title: "Reminder",
    message: "Stand-up starts in five minutes",
  },
  signal
);
```

The request contains only `title` and `message`; the optional second argument
is an `AbortSignal`. The result reports the Core channels independently:

```ts
{
  channels: {
    mac: { status: "sent" },
    ntfy: { status: "failed", error: "Delivery failed" },
  },
}
```

Each `mac` and `ntfy` result is exactly one of `sent`, `disabled`, or `failed`.
Only `failed` includes a bounded, non-sensitive `error` string. One channel's
failure does not erase the other channel's outcome.

Notification configuration is a Core privacy boundary. Global and per-channel
enablement, ntfy server and topic, credentials, delivery timeouts, and
deployment details MUST NOT cross into plugin code. Plugins can observe only
the two channel outcomes above, never configuration or endpoint values. The
notification content itself is passed to the configured delivery channels and
MAY leave the local machine when ntfy is enabled, so a plugin MUST send only
content appropriate for that configured destination.

The downstream schedule plugin tracked by GitHub Issue #31 declares
`notifications:send` and calls this service when a reminder becomes due. In the
inspiration recording/push flow tracked by Issues #33 and #34, recording and
storage remain plugin-owned and the push path calls this service only when a
stored inspiration is selected for delivery. Those plugins are downstream of
this API and are not implemented by the v1 service contract itself.

## Routes and errors

Canonical plugin routes use:

```text
/api/plugins/<plugin-id>/*
```

A reviewed compatibility alias such as `/api/screen/*` MUST set
`compatibilityAlias: true`. The gateway checks plugin state before invoking the
handler, so disabled and degraded routes remain discoverable but return `503`.
Routes marked `localOnly` accept only loopback clients; rejection occurs before
the handler and returns `403 PLUGIN_LOCAL_ONLY`.

Error bodies preserve EchoLog's top-level string `error`:

```json
{
  "error": "Plugin screen-time is disabled",
  "code": "PLUGIN_DISABLED",
  "pluginId": "screen-time",
  "state": "disabled"
}
```

Stable error codes:

| Code | Typical HTTP status |
| --- | --- |
| `PLUGIN_DISABLED` | 503 |
| `PLUGIN_DEGRADED` | 503 |
| `PLUGIN_API_INCOMPATIBLE` | 503 |
| `PLUGIN_DEPENDENCY_MISSING` | 403 |
| `PLUGIN_EXEC_FAILED` | 502 |
| `PLUGIN_TIMEOUT` | 504 |
| `PLUGIN_OUTPUT_INVALID` | 502 |

## Bundled macOS helpers

Native helper compilation is an explicit platform/release step and MUST NOT
make portable `pnpm build` require macOS. A plugin resolves its packaged app
inner executable relative to its compiled module, with only a validated
absolute deployment override. Bundled helpers are not listed in
`requires.executables`, which is reserved for external PATH dependencies.

screen-time packages
`native/macos-capture/build/EchoLogScreenCapture.app/Contents/MacOS/echolog-screen-capture`.
Permission inspection never prompts, and a missing Screen Recording permission
diagnostic does not degrade passive foreground tracking.

`GET /api/health` reports Core health. Plugin failures appear in
`GET /api/plugins` and `GET /api/plugins/doctor`. A failed doctor request uses
HTTP 503 and retains the normal error envelope plus diagnostics:
`{"error":"...","ok":false,"plugins":[...]}`.

## Database migrations

Plugin migrations are ordered, immutable `{name, sql}` entries. The Host stores:

```text
plugin_migrations(plugin_id, name, checksum, applied_at)
```

Each migration runs in its own transaction. A failed migration is not recorded.
Changing the SQL of an applied migration causes checksum drift and degrades only
that plugin.

"Plugin schema" means a plugin-owned TypeScript schema, migration sequence and
table prefix. It does not mean a PostgreSQL namespace. Existing screen-time
tables retain their names and rows.

## CLI and Web

Top-level `el screen` and `el tmux` commands are build-time contributions and
remain HTTP thin clients. `--json` emits the API response; `el tmux watch
--json` is explicitly an NDJSON stream.

The Web Shell loads `/api/plugins`, imports only `ready` bundled Web modules,
then delegates data loading, face descriptions, rendering and actions. A module
failure removes only that contribution. Disabled plugins do not add navigation
or pages.

## Inspiration notification dependency

The bundled `inspiration` plugin owns capture, organization, and deterministic
Flow resurfacing under `/api/plugins/inspiration/*`. Its inspiration lifecycle
and Flow delivery ledger are separate; snoozing a delivery MUST NOT change the
inspiration's kept/archived state. The plugin has no Schedule/Core-record API or
table relationship.

Flow resolves the named service `notifications.send` lazily through
`PluginContext.service()`, using the SDK-exported `PluginNotificationSend`
function. It sends only `{title, message}`. Inspiration-owned dedupe keys,
inspiration IDs, and delivery IDs never cross the Core service boundary. The
plugin persists the bounded `mac`/`ntfy` result projection in its private
delivery ledger and treats the delivery as sent only when at least one channel
reports `sent`. The notification service is Host-owned; the plugin MUST NOT
import or copy the Core notifier. Missing/failing delivery is recorded while
capture remains available.

## Bundled Schedule plugin

`schedule` owns its manifest, configuration, migrations, `schedule_items`,
reminder delivery ledger, routes, job, CLI, and Web contribution. Its canonical
routes use `/api/plugins/schedule/*`; `el schedule` and the month/week/day
views are HTTP clients of those routes.

Canonical routes:

- `GET|POST /api/plugins/schedule/items`
- `GET|PATCH /api/plugins/schedule/items/:id`
- `POST /api/plugins/schedule/items/:id/confirm-start`
- `POST /api/plugins/schedule/items/:id/snooze`
- `POST /api/plugins/schedule/items/:id/complete`
- `POST /api/plugins/schedule/items/:id/cancel`
- `GET /api/plugins/schedule/reminders`

`el schedule` exposes `list`, `show`, `add`, `edit`, `confirm`,
`snooze`, `done`, and `cancel`; `--json` preserves the API response or
structured error body.

The plugin requests the exact named service `notifications.send` and declares
`notifications:send`. Its local consumer contract sends only
`{ title, message }` plus an optional `AbortSignal`, and receives independent
`mac` and `ntfy` results with status `sent`, `disabled`, or `failed`.
Notification configuration and credentials remain Core-owned.

Reaching `scheduledStartAt` only attempts a notification. It never changes
state or creates/starts a Core record. Only explicit `confirm-start` changes
`scheduled` to `active`, recording the confirmation time as
`confirmedStartAt`. Ignoring a reminder changes nothing; snooze changes only
`nextReminderAt`; completion and cancellation are explicit.

Persisted states are `scheduled | active | done | cancelled`.
`awaitingConfirmation` is derived from a scheduled item whose planned start is
not later than now. Month, week, and day views project the same
`schedule_items` rows; there is no separate calendar event store. All state
mutations require `expectedVersion`, and each reminder instant is claimed by a
unique ledger dedupe key before delivery.

## Compatibility policy

API v1 changes are additive. A breaking SDK, lifecycle or manifest change
requires a new `apiVersion`. HTTP fields MAY be added; clients SHOULD ignore
unknown fields. Compatibility aliases remain until a documented major release.
