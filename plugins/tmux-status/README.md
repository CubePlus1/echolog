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
It accepts the migration-window v1 JSON envelope, the versioned v2 identity
contract, and the strict v3 conversation-recovery contract, rejecting corrupt
or unsupported output before returning or storing it. `doctor` accepts matching
`0.1.x`, `0.2.x`, and `0.3.x` executable lines, then runs a
real `status --json` request through the same schema validation used by normal
status calls and scheduled collection.

Plugin tables retain session/pane instance identity, detected tool names,
observation times, sampled resource aggregates, and v3 conversation recovery
metadata. Recovery rows include cwd and the local identity evidence path because
both are required to diagnose and resume a verified mapping. They never include
command text, manual-mark notes, prompt, reply, reasoning, tool arguments,
terminal transcript, or pane content.

The producer-owned v3 JSON Schema and fixtures are mirrored under
`contracts/tmux-status/v3` with a SHA-256 manifest. EchoLog validates and stores
the contract; it does not copy the Python collector or infer conversation IDs.

Routes:

- `GET /api/plugins/tmux-status/status`
- `POST /api/plugins/tmux-status/mark`
- `GET /api/plugins/tmux-status/doctor`

`link` and Agent effort spans are intentionally not implemented here. They
depend on the separate Core actor/span aggregation task. CPU, selected state,
process presence and automatic activity never create active-record time.
