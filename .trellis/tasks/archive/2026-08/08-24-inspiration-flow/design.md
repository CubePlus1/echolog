# Flow design

## Ownership

This task exclusively owns:

- `plugins/inspiration/src/{flow-store.ts,selector.ts,flow.ts,flow-routes.ts,notifications.ts}`
- Flow-focused tests under `tests/inspiration-flow.test.ts`

It MUST NOT edit Capture/schema/migration/package files, clients/Web, root
registry/build files, README, shared `types.ts`, or plugin `index.ts`.

## Notification boundary

The only host dependency is the SDK-exported function:

```ts
type PluginNotificationSend = (
  request: { title: string; message: string; dedupeKey?: string },
  signal?: AbortSignal
) => Promise<PluginNotificationResult>;
```

It is resolved lazily with `context.service("notifications.send")`; the manifest
declares `notifications:send`. Inspiration passes a stable
`inspiration:${delivery.dedupeKey}` hint but no other entity metadata. Providers
may ignore this additive field, so the delivery ledger still enforces the state
machine. A delivery-owned JSONB projection stores bounded `mac`/`ntfy` channel
results. Overall success requires at least one `sent` channel. Tests use the
real PluginHost permission gate and function service in addition to unit mocks.

## Selection and atomicity

Pure policy code evaluates local time/quiet hours and returns eligibility
reasons. The store transaction locks/reserves one candidate, writes a unique
delivery dedupe key, and advances `last_surfaced_at` with an expected inspiration
version. Repeated scheduler buckets or manual idempotency keys return the
existing delivery rather than double-send.

The deterministic sort is `last_surfaced_at NULLS FIRST`, then `created_at`,
then `id`. Scheduled calls respect quiet hours and `enabled`; manual calls may
bypass only those two gates, never cooldown, snooze, filters, or daily cap.

## Restart/failure semantics

The ledger is source of truth. Before an external call the row transitions to
`dispatching`. A stale `reserved` or `dispatching` row becomes a terminal
unknown failure and is never sent again from that row. A clearly failed send
may be retried only through a later policy-selected bucket and a new delivery.
No prompt/reply/screenshot body is stored.

### PR #36 correction

The earlier stale-reservation retry is superseded by at-most-once semantics.
Before the external call, the Store atomically claims the row into an in-flight
state. Any stale reserved/in-flight row is terminally failed with an unknown
outcome and `shouldNotify=false`; it is never reclaimed for another external
send. Explicit notification failure remains a normal failed row, and a future
bucket can retry only by creating a new delivery after normal policy selection.

Scheduled dedupe keys are generated inside `reserveNext` after locking settings,
using that row's version and interval. This removes transaction-outside races.
Failed rows are diagnostic and never accept outcomes, regardless of source.
Only sent deliveries represent a successful user-visible surfacing.
