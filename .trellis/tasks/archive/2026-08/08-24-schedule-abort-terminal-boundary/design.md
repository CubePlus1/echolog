# Schedule abort terminalization design

## Boundary contract

The ledger state `claimed` means delivery outcome is still uncertain. Only an
unaborted caller may transition it to `sent` or `failed`. Host timeout and
daemon stop own the job's `AbortSignal`; after either event, a continuation is
late and loses authority to persist a terminal outcome.

## Control flow

```text
claim reminder
  -> await notifications.send(request, callerSignal)
  -> callerSignal.throwIfAborted()
  -> validate channel result
  -> callerSignal.throwIfAborted()
  -> finishReminder(sent|failed)

catch error
  -> if callerSignal.aborted || error.name === "AbortError": rethrow
  -> callerSignal.throwIfAborted()
  -> finishReminder(failed)
```

The second catch-path signal check closes an abort that happens while
classifying a normal error. The final signal checks guard every persistence
entry point. The database write itself remains the existing atomic
`claimed -> sent|failed` update.

## Host regression shape

Use the real `PluginHost` scheduler with a test plugin whose job calls
`pollDueReminders` and whose notification promise is externally controlled.
For timeout, wait until Host aborts and releases the run, then resolve/reject the
old promise and prove no terminal write. For stop, abort via `host.stop()`,
settle the late promise, and prove the same retained claim. Tests must observe
the ledger seam, not a duplicated copy of the production control flow.

## File ownership

- Implementation agent: `plugins/schedule/src/reminders.ts` only.
- Regression agent: `tests/schedule.test.ts` and
  `tests/schedule-job.test.ts` only.
- Main agent: Trellis/spec/PR tracking, integration, validation, commits.
- Independent check agent: read-only review after integration.
