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
ECHOLOG_MACOS_SIGNING_IDENTITY='Developer ID Application: ...' pnpm build:macos-release
```

The artifact is `native/macos-capture/build/EchoLogScreenCapture.app`. The Web
“测试截图” and “立即识别” actions invoke that app identity through macOS
LaunchServices (`/usr/bin/open -W -n ... --args`) and localhost-only routes. The
daemon exclusively pre-creates mode `0600` stdout/stderr files inside one mode
`0700` private temporary directory, validates the PNG, sends it to the selected
OpenAI-compatible vision endpoint, and deletes the directory in `finally`.
Keychain operations execute the inner helper directly; API keys never enter the
database, argv, logs, or API responses. Successful runs persist only structured
summary/activity/apps/confidence metadata, with displayed field values required
to be in Simplified Chinese. The one-shot capture process has its own 12-second
hard watchdog, shorter than the daemon's 15-second request timeout.
Never invoke `request-permission` from the daemon.
