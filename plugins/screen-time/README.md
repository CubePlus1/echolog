# screen-time bundled plugin

Owns foreground application sampling, `app_usage` / `app_rules`,
classification, screen API handlers, the `el screen` compatibility command,
Provider/Keychain administration, macOS capture, and opt-in AI screen
understanding results.

```yaml
plugins:
  screen-time:
    enabled: true
    config:
      sample_seconds: 5
      idle_seconds: 180
      # macos_helper_path: /absolute/EchoLogScreenCapture.app/Contents/MacOS/echolog-screen-capture
```

The legacy top-level `tracker` configuration is mapped at startup and logs a
deprecation warning. Explicit `plugins.screen-time` values take precedence.

Canonical routes use `/api/plugins/screen-time/*`. `/api/screen/*` remains a
compatibility alias. Disabling the plugin returns `PLUGIN_DISABLED` from both
route families and removes the Web contribution.

The baseline migration uses `CREATE TABLE IF NOT EXISTS`; it does not rename,
copy or rewrite existing rows. Sampling executes `lsappinfo`, `ioreg` and
`pmset` through the Host's bounded no-shell command runner.

## macOS helper

Portable `pnpm build` does not compile Swift. Build the packaged helper
explicitly:

```bash
ECHOLOG_MACOS_ADHOC_SMOKE=1 pnpm build:macos-capture
pnpm smoke:macos-helper
ECHOLOG_MACOS_SIGNING_IDENTITY='Developer ID Application: ...' pnpm build:macos-release
```

Automatic understanding uses `keychain get --no-auth-ui`. If macOS requires
authorization, the run is skipped without showing UI and further scheduled
Keychain reads for that Provider remain blocked. “立即识别” is an explicit,
interactive operation with a 60-second helper timeout. A successful manual read
caches the credential in daemon memory, clears the block, and lets later
scheduled runs use the cache without invoking the helper again. Set and delete
operations update the same cache; plugin stop or daemon restart clears it.

The artifact is `native/macos-capture/build/EchoLogScreenCapture.app`. The Web
“测试截图” and “立即识别” actions invoke that app identity through macOS
LaunchServices (`/usr/bin/open -W -n ... --args`) and localhost-only routes. The
daemon exclusively pre-creates mode `0600` stdout/stderr files inside one mode
`0700` private temporary directory, validates the PNG, sends it to the selected
OpenAI-compatible vision endpoint, and deletes the directory in `finally`.
Keychain operations execute the inner helper directly. Provider listing and
ordinary page loads report only the daemon's cached key state and never probe
Keychain. API keys never enter the database, argv, logs, or API responses.
Successful runs persist only structured
summary/activity/apps/confidence metadata, with displayed field values required
to be in Simplified Chinese. The one-shot capture process has its own 12-second
hard watchdog, shorter than the daemon's 15-second request timeout.
Never invoke `request-permission` from the daemon.

The periodic understanding job checks the database-backed interval every five
seconds. This keeps a configured 120-second interval close to two minutes even
when the setting changes while the daemon is running, instead of rounding it up
to a coarser scheduler tick.
