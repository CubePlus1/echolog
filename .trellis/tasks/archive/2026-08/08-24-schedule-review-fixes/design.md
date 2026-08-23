# Schedule local review fixes design

## Web surface error routing

Extend action-target parsing to retain the surface. All action status/error
writes choose `scheduleActionErrorDay` for `day:...` targets and
`scheduleActionError` otherwise. The existing global host `$` helper remains
unchanged.

## Timestamp grammar

The API is authoritative. Accept ISO timestamps with an explicit `Z` or
numeric offset at either minute or second precision; optional fractional
seconds remain valid only when seconds are present. Apply the same grammar in
the Web preflight and backend parser, with shared fixture cases in tests.

## Ledger index

Append an immutable `002_schedule_delivery_lookup_index` migration creating
`idx_schedule_reminder_deliveries_item_reminder` on
`(item_id, reminder_at)`. Add the matching Drizzle schema index. Do not edit
the already published `001` SQL because plugin migration checksums are
immutable once applied.
