# PR #36 Core notification and Host review analysis

## P1 caller abort

`runBounded` currently produces a private `DeliveryAbortedError` for caller
abort. Both `sendMac` and `sendNtfy` catch it and `failureResult` converts it to
ordinary channel `{status:"failed"}` data. Consequently `sendNotification`
resolves, and downstream schedule/inspiration code can finalize an uncertain
delivery after Host job timeout or shutdown cancellation.

The fix must keep `DeliveryTimeoutError` internal and result-bearing while
normalizing caller cancellation to `AbortError` and rethrowing it through both
channel functions and the aggregate service.

## P2 disabled manifest validation

`PluginHost.initialize` currently executes `if (!runtime.info.enabled) continue`
before `validatePluginManifest`, so an unsupported permission on a disabled
definition appears healthy and disabled. Moving manifest/API validation first
will make it degraded, but shutdown must also skip by `enabled === false`;
otherwise the new degraded state would cause `stop` to run for a plugin whose
lifecycle never started.

## Registry scope

This branch currently registers screen-time and tmux-status. The test must
iterate the exported registry rather than hard-code IDs, so the PR #36
integration branch automatically validates its additional inspiration and
schedule manifests after the fix is incorporated.
