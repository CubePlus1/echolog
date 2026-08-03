# EchoLog MCP Server

EchoLog exposes a local Model Context Protocol server over stdio. It is an HTTP
thin client: every tool calls the running EchoLog daemon, and no MCP code reads
PostgreSQL or imports Core business logic directly.

## Prerequisites

- EchoLog is built and `el` is available on `PATH`.
- The EchoLog daemon and PostgreSQL are running.
- `el daemon status --json` reports a healthy daemon.

The EchoLog Codex Plugin bundles this connection in `.mcp.json`. For standalone
use without the Plugin, register the server with Codex CLI:

```bash
codex mcp add echolog -- el mcp
codex mcp list
```

`el mcp` reserves stdout for MCP protocol frames. The transport is local stdio;
it does not expose a network listener or make the local daemon reachable from
Codex Cloud or ChatGPT Web.

## Tools

| Tool | Purpose | EchoLog API |
|---|---|---|
| `get_status` | Today's summary and active records | `GET /api/summary/today` |
| `list_records` | Filtered record history | `GET /api/records` |
| `get_subtasks` | Direct children and progress | `GET /api/records/:id/subtasks` |
| `start_record` | Start an explicit record | `POST /api/records` |
| `control_record` | Stop, pause, or resume | `PATCH /api/records/:id` or `/active` |
| `add_note` | Add a note, blocker, or next action | `POST /api/records/:id/notes` or `/active/notes` |
| `generate_report` | Generate daily Markdown without sync | `POST /api/reports/daily` |
| `get_screen_time` | Read screen-time usage | `GET /api/screen/today` or `/daily/:date` |

The server publishes Zod-derived input and output schemas plus MCP tool
annotations. `get_status`, `list_records`, `get_subtasks`, `generate_report`,
and `get_screen_time` are read-only. `start_record` and `add_note` are
non-idempotent writes. `control_record` is conservatively marked destructive
because `stop` cannot be reversed by the current record state machine.

## Error contract

Successful calls return both JSON text content and typed `structuredContent`.
Failures return `isError: true` and a JSON text block containing the original
API fields:

```json
{
  "error": "Multiple active records",
  "status": 409,
  "candidates": [
    { "id": "...", "title": "...", "status": "running" }
  ]
}
```

Errors intentionally omit `structuredContent`. MCP SDK 1.x clients validate any
present structured output against the tool's success schema, including error
results. The JSON text block retains `status`, `candidates`, `code`, `pluginId`,
and `state` without violating that client contract.

When a record id is known, pass it explicitly. If the server returns 409 with
`candidates`, ask the user to choose; do not guess. A disabled or degraded
optional plugin fails only its own tool call and does not terminate the MCP
process.

## Scope and privacy

The initial adapter does not expose cancel, edit, backfill, sync, tmux mutation,
remote HTTP transport, resources, prompts, lifecycle hooks, or custom UI. It
never reads or stores Codex prompts, responses, reasoning traces, terminal
transcripts, or tmux pane content.

The packaged Plugin, personal marketplace development flow, supported Codex
surfaces, and privacy boundary are documented in [Codex Integration](CODEX.md).
