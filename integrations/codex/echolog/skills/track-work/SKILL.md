---
name: track-work
description: Explicitly start, pause, resume, stop, or annotate local EchoLog work records through bundled MCP tools or the `el` CLI fallback. Use only when the user invokes this skill or clearly asks to change an EchoLog record; never trigger it implicitly for an ordinary coding task.
---

# Track Work

Prefer the bundled `echolog` MCP tools. If they are not available because this Skill was installed standalone, use the existing `el` HTTP client as the fallback write surface. Do not access the EchoLog database, Core modules, configuration file, or REST API directly.

## Check availability

1. When the bundled MCP server is available, call `get_status` before the first write.
2. If it returns an MCP tool error, preserve its JSON fields. For `CONNECTION_ERROR`, suggest `el daemon start` and stop; do not retry through CLI because it uses the same daemon.
3. If the MCP server itself is unavailable, resolve `el` from `PATH` with `command -v el`. If it is missing, stop without attempting installation and point the user to EchoLog's installation instructions.
4. For CLI fallback, run `el daemon status --json`. If it exits non-zero or is not healthy, preserve its JSON error and stop. Do not start Docker or the daemon automatically.

## Apply safety rules

- Require explicit user intent for every write. Never start a record merely because Codex begins work.
- Use MCP `structuredContent` for successful tool calls. Parse the JSON text content of `isError: true` results without dropping fields.
- In CLI fallback, add `--json` to every EchoLog command and use the returned object as the source of truth.
- When a record ID is known, pass it explicitly to later operations.
- When an omitted ID returns HTTP 409 with `candidates`, show each candidate's `id`, `title`, and `status`, then ask which record to use. Never guess.
- Treat `isError: true` or any non-zero CLI exit as failure even if output was produced. Preserve the structured JSON error instead of replacing it with a generic message.
- Pass titles, notes, and results as single shell arguments. Do not interpolate their content into executable shell fragments.
- Do not use `stop --all`, `cancel`, `edit`, `add`, `sync`, `screen rules`, `tmux mark`, or daemon stop in this skill.

## Map explicit requests to MCP

Use the smallest tool that matches the request:

- Start: `start_record` with `title`, optional `type`, `tags`, `project`, and `parentId`.
- Pause, resume, or stop: `control_record` with the known `id`, `action`, and `result` only for stop.
- Note, blocker, or next action: `add_note` with the known `id`, `content`, and `type`.
- Parent progress needed to choose or report context: read-only `get_subtasks` with the parent `id`.

Only include `tags` or `project` when the user supplies those values or they are unambiguous from the request. Do not invent classification metadata.

## CLI fallback

Use these only when the bundled MCP server is unavailable:

```bash
el start "<title>" --type <learning|project|task> --json
el start "<title>" --type task --parent <parent-id> --json
el pause <id> --json
el resume <id> --json
el stop <id> --note "<result>" --json
el note "<content>" --record <id> --json
el note "<content>" --blocker --record <id> --json
el note "<content>" --next --record <id> --json
el subtasks <parent-id> --json
```

## Complete a workflow

For a multi-step request:

1. Start the record and retain the returned `id`.
2. Use that exact `id` for notes, pause, resume, or stop.
3. Do not stop the record until the user asks or the requested workflow explicitly includes completion.
4. Report the affected record's title, ID, status, and relevant result or note type.

If any step fails, stop the sequence, report the structured failure, and leave already completed EchoLog actions unchanged.

## Preserve privacy

Record only content the user explicitly asks to place in EchoLog. Never copy Codex prompts, responses, reasoning, terminal transcripts, environment variables, credentials, or tmux pane content into a title, note, or result.
