# Flow design

## Ownership

This task exclusively owns:

- `plugins/inspiration/src/{flow-store.ts,selector.ts,flow.ts,flow-routes.ts,notifications.ts}`
- Flow-focused tests under `tests/inspiration-flow.test.ts`

It MUST NOT edit Capture/schema/migration/package files, clients/Web, root
registry/build files, README, shared `types.ts`, or plugin `index.ts`.

## Notification boundary

The only host dependency is:

```ts
export interface NotificationsSendService {
  send(
    input: {
      title: string;
      body: string;
      dedupeKey: string;
      data: { pluginId: "inspiration"; inspirationId: string; deliveryId: string };
    },
    signal?: AbortSignal
  ): Promise<{ delivered: boolean; channel?: string }>;
}
```

It is resolved lazily with
`context.service<NotificationsSendService>("notifications.send")`. Tests mock
this service. This branch does not implement or import the Core notifier and
does not widen the SDK.

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
