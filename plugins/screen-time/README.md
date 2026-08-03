# screen-time bundled plugin

Owns foreground application sampling, `app_usage` / `app_rules`,
classification, screen API handlers, the `el screen` compatibility command and
its Web pages.

```yaml
plugins:
  screen-time:
    enabled: true
    config:
      sample_seconds: 5
      idle_seconds: 180
```

The legacy top-level `tracker` configuration is mapped at startup and logs a
deprecation warning. Explicit `plugins.screen-time` values take precedence.

Canonical routes use `/api/plugins/screen-time/*`. `/api/screen/*` remains a
compatibility alias. Disabling the plugin returns `PLUGIN_DISABLED` from both
route families and removes the Web contribution.

The baseline migration uses `CREATE TABLE IF NOT EXISTS`; it does not rename,
copy or rewrite existing rows. Sampling executes `lsappinfo`, `ioreg` and
`pmset` through the Host's bounded no-shell command runner.
