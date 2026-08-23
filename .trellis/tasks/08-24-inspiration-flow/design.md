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
  request: { title: string; message: string },
  signal?: AbortSignal
) => Promise<PluginNotificationResult>;
```

It is resolved lazily with `context.service("notifications.send")`; the manifest
declares `notifications:send`. Inspiration passes no dedupe key or entity IDs to
Core. A delivery-owned JSONB projection stores bounded `mac`/`ntfy` channel
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

The ledger is source of truth. A reserved row survives daemon restart. A send
failure is finalized as `failed`; a later dedupe bucket can retry the same
inspiration if still eligible. Before selecting for a new scheduled bucket, the
store claims the oldest stale `reserved` delivery with a short lease and
increments its durable attempt count. This recovers work even when restart
crosses an interval boundary without letting an immediate repeated poll send
twice. No prompt/reply/screenshot body is stored.
