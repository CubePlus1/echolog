# tmux-status bundled plugin

Adapts the independent
[CubePlus1/tmux-status](https://github.com/CubePlus1/tmux-status) executable.
EchoLog does not copy its Python collection logic.

```yaml
plugins:
  tmux-status:
    enabled: false
    config:
      executable: "tmux-status"
      timeout_ms: 5000
      collection_interval_seconds: 60
      cpu_threshold: 80
      memory_threshold_mb: 1024
```

The adapter calls the configured executable with argument arrays and no shell.
It accepts the migration-window v1 JSON envelope and the versioned v2 contract,
rejecting corrupt or unsupported output before returning or storing it.
`doctor` accepts the matching `0.1.x` and `0.2.x` executable lines, then runs a
real `status --json` request through the same schema validation used by normal
status calls and scheduled collection.

Plugin tables retain only session/pane instance identity, detected tool names,
observation times, sample count, average/peak CPU, peak memory and anomaly
count. They do not store command, path, manual-mark note, prompt, reply,
reasoning, tool arguments or pane content.

Routes:

- `GET /api/plugins/tmux-status/status`
- `POST /api/plugins/tmux-status/mark`
- `GET /api/plugins/tmux-status/doctor`

`link` and Agent effort spans are intentionally not implemented here. They
depend on the separate Core actor/span aggregation task. CPU, selected state,
process presence and automatic activity never create active-record time.
