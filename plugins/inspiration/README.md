# Inspiration bundled plugin

Inspiration is one bundled plugin with two product phases:

- GitHub #33: capture, Inbox organization, search/filter, archive, and history.
- GitHub #34: deterministic manual/scheduled Flow resurfacing and outcomes.

It is intentionally independent from EchoLog records and Schedule. The plugin
does not query, create, convert, or link schedules or Core records, and its only
foreign key is private to its own inspiration/delivery tables.

## Routes

Canonical routes live under `/api/plugins/inspiration/*`:

- `POST|GET /inspirations`
- `GET|PATCH /inspirations/:id`
- `POST /inspirations/:id/archive`
- `POST /inspirations/:id/restore`
- `POST /flow/next`
- `GET|PATCH /flow/settings`
- `GET /flow/deliveries`
- `POST /flow/deliveries/:id/outcome`

Mutations that change existing state require `expectedVersion`. Inspiration
lifecycle (`inbox`, `kept`, `archived`) is separate from Flow delivery state.
In particular, the `later` outcome only snoozes a delivery and does not change
the inspiration lifecycle.

## Flow policy

Manual `next` and the scheduled job use the same deterministic selector:
never-surfaced inspirations first, then oldest `lastSurfacedAt`, creation time,
and id. Settings control lifecycle/tag/project filters, cooldown, quiet hours,
daily cap, and default snooze. The delivery ledger and unique dedupe keys make
repeated polling and daemon restarts observable. Before calling the external
notification service, a delivery crosses a durable `dispatching` boundary.
Stale reserved/dispatching rows are terminally diagnosed as an unknown failure
and are never sent again from the same ledger row; an explicit failure may be
retried only through a distinct later bucket and delivery. Failed deliveries
are diagnostic, not actionable; user outcomes apply only to sent deliveries.

Delivery history is ordered by `(surfacedAt DESC, id DESC)` and uses an opaque
composite cursor. All date-time filters and cursor timestamps must include `Z`
or an explicit `\u00b1HH:mm` offset.

The first version uses no AI or embeddings and stores no screenshots, prompt,
reply, reasoning, or terminal content.

## Notification dependency

Flow resolves exactly one host service lazily:

```ts
type PluginNotificationSend = (
  request: { title: string; message: string; dedupeKey?: string },
  signal?: AbortSignal
) => Promise<{
  channels: Record<"mac" | "ntfy",
    | { status: "sent" }
    | { status: "disabled" }
    | { status: "failed"; error: string }
  >;
}>;
```

The service name is `notifications.send` and the manifest declares the matching
`notifications:send` permission. The request contains notification text plus a
stable `inspiration:`-namespaced delivery dedupe key. The private ledger remains
authoritative because a compatible provider may ignore this additive hint;
inspiration and raw delivery ids are not otherwise exposed.
At least one `sent` channel marks a delivery sent. Otherwise it is failed, with
the bounded per-channel result retained for diagnostics. Service resolution is
lazy, so a missing or failed notification capability is recorded as a failed
Flow delivery while Capture remains available. This package neither imports nor
copies the Core notifier.
