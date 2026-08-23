# Schedule data and reminders design

The authoritative architecture, item schema, routes, notification signature,
state machine, ledger policy, and file ownership are in the parent
`../08-24-schedule-plugin/design.md`. This child owns backend and CLI execution
of that frozen contract. It may not change shared SDK/Host files.

Backend validation happens at routes; the store owns atomic persistence and
conflict classification. The reminder service owns ledger claim/send/finalize.
CLI performs only argument formatting and HTTP transport/display.
