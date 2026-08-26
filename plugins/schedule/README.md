# Schedule bundled plugin

Schedule owns planned items, explicit execution state, reminder delivery
deduplication, the `el schedule` HTTP client, and the Web month/week/day views.
It is independent of Inspiration and Core records.

```yaml
plugins:
  schedule:
    enabled: true
    config:
      reminder_poll_seconds: 30
```

Reaching `scheduledStartAt` only asks the Host to send a reminder. It never
starts work or creates a Core record. The persisted states are
`scheduled | active | done | cancelled`; `awaitingConfirmation` is derived
for a scheduled item whose planned start has arrived.

- `confirm-start` is the only transition to `active` and records the actual
  confirmation time in `confirmedStartAt`.
- Ignoring a notification changes nothing.
- Snooze changes only `nextReminderAt` plus normal version/update bookkeeping.
- Complete and cancel are explicit.
- Every mutation requires the current `expectedVersion`.

The reminder job claims a unique item/reminder-instant ledger key before calling
`PluginContext.service("notifications.send")`. The manifest declares
`notifications:send`; Schedule locally consumes only `{title,message}`, an
optional `AbortSignal`, and per-channel `sent | disabled | failed` results.
It does not import the Core notifier or access notification configuration.
Missing service capability degrades only this plugin.

Claiming is also abort-aware: the caller signal is forwarded through the
lock-and-insert transaction, while a separate bounded claim transport timeout
protects the scheduler from a blocked database lock. Caller aborts and Host
timeout/stop retain the reminder unclaimed (or, if a prior claim already
committed, as `claimed`); a late lock continuation cannot insert a ledger row.
The internal timeout is reported as a distinct `SCHEDULE_CLAIM_TIMEOUT` error
and does not abort the caller signal.

Host timeout or daemon stop aborts the caller signal. If notification delivery
settles after that abort, Schedule retains the ledger as `claimed` for
diagnosis and performs no late `sent`/`failed` write. Normal channel failure
while the caller remains active is still terminalized as `failed`.

Reminder text converts the stored absolute instant into the item's IANA
timezone with `Intl.DateTimeFormat`, so non-UTC and daylight-saving wall times
remain accurate; invalid legacy zones fall back explicitly to UTC. The Web
contribution live-polls the canonical range and refreshes its faces only when
item data, the reference date, or derived awaiting state changes. Unchanged
polls preserve the current DOM, and unmounted contributions ignore late data.

Canonical routes:

- `GET|POST /api/plugins/schedule/items`
- `GET|PATCH /api/plugins/schedule/items/:id`
- `POST /api/plugins/schedule/items/:id/confirm-start`
- `POST /api/plugins/schedule/items/:id/snooze`
- `POST /api/plugins/schedule/items/:id/complete`
- `POST /api/plugins/schedule/items/:id/cancel`
- `GET /api/plugins/schedule/reminders`

`el schedule --help` documents list/show/add/edit/confirm/snooze/done/cancel,
explicit-offset ISO timestamps, IANA timezones, JSON output, and optimistic
version handling.

The MVP deliberately excludes recurrence, external calendar sync, AI
scheduling, notification action callbacks, Inspiration conversion, and Core
record linkage. Web and CLI provide explicit confirmation and state actions.
