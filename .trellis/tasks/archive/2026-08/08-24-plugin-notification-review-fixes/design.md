# PR 36 notification and Host review-fix design

## Cancellation taxonomy

`runBounded` has two cancellation sources:

1. **Caller abort** — ownership lies outside the notification transport (for
   example Plugin Host job timeout or daemon stop). It aborts the transport and
   rejects with a normalized `DOMException(..., "AbortError")`.
2. **Internal transport timeout** — Core bounded a delivery that did not settle.
   It aborts the transport and rejects internally with `DeliveryTimeoutError`.

`sendMac` and `sendNtfy` rethrow `AbortError` unchanged. They convert internal
timeout and operational transport errors into the existing channel result
union. `sendNotification` uses `Promise.all`, so caller abort rejects the whole
service call and prevents a downstream plugin from finalizing an uncertain
delivery. Without caller abort, mac and ntfy still settle independently.

The entry point checks an already-aborted caller signal before configuration or
disabled-channel short circuits. Timer and event-listener cleanup happens once
in the shared settle path. `AbortController.abort()` propagates to fetch; macOS
native delivery cannot be cancelled after dispatch, but the caller settles and
late callbacks are ignored.

## Host initialization state machine

Every runtime enters `validating` during `initialize`, regardless of its
configured enabled flag. The Host performs runtime manifest and API-version
validation first:

```text
definition
  -> validating
  -> invalid: degraded (enabled false/true preserved; no lifecycle)
  -> valid + disabled: disabled (no lifecycle)
  -> valid + enabled: config validation -> migrating -> starting -> ready
```

The disabled gate remains before config validation, migration, registration,
start, and job scheduling. Shutdown skips every runtime with `enabled === false`
so an invalid disabled definition cannot accidentally invoke `stop` after being
marked degraded. Enabled plugins retain the existing best-effort stop behavior
for partial startup cleanup.

`PLUGIN_DEGRADED` remains the diagnostic code for malformed manifests; the
existing runtime info exposes the validation message, failure count, and last
error timestamp. Core health is not blocked and the loop continues.

## Contract tests

Abort tests use externally controlled non-cooperative mac and ntfy transports:
the same transport shape rejects with `AbortError` under caller abort but
resolves structured failures under the internal timeout. This avoids tests that
merely assert an implementation-specific error class.

Host tests use `defaultEnabled: false` with an unsupported permission cast at
the definition boundary, count migration/register/start/stop calls, and include
a later healthy plugin. A registry test iterates the real `bundledPlugins`
array and calls `validatePluginManifest` on each actual manifest.

## Compatibility

No SDK request/result types or permission names change. Core scheduler calls
remain signal-free fire-and-forget. Valid disabled plugin state is unchanged.
Only previously invalid manifests and caller-cancelled sends change semantics.
