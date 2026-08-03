---
name: track-work
description: Explicitly start, pause, resume, stop, or annotate local EchoLog work records through the `el` CLI. Use only when the user invokes this skill or clearly asks to change an EchoLog record; never trigger it implicitly for an ordinary coding task.
---

# Track Work

Use the existing `el` HTTP client as the only write surface. Do not access the EchoLog database, Core modules, configuration file, or REST API directly.

## Check availability

1. Resolve `el` from `PATH` with `command -v el`.
2. If it is missing, stop without attempting installation. Point the user to EchoLog's installation instructions.
3. Run `el daemon status --json` before the first EchoLog operation.
4. If the command exits non-zero or returns a status other than `ok`, preserve its JSON error and stop. Suggest `el daemon start`; do not start Docker or the daemon automatically.

## Apply safety rules

- Require explicit user intent for every write. Never start a record merely because Codex begins work.
- Add `--json` to every EchoLog command and use the returned object as the source of truth.
- When a record ID is known, pass it explicitly to later operations.
- When an omitted ID returns HTTP 409 with `candidates`, show each candidate's `id`, `title`, and `status`, then ask which record to use. Never guess.
- Treat any non-zero exit as failure even if output was produced. Preserve the structured JSON error instead of replacing it with a generic message.
- Pass titles, notes, and results as single shell arguments. Do not interpolate their content into executable shell fragments.
- Do not use `stop --all`, `cancel`, `edit`, `add`, `sync`, `screen rules`, `tmux mark`, or daemon stop in this skill.

## Map explicit requests

Use the smallest command that matches the request:

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

Only add `--tags` or `--project` when the user supplies those values or they are unambiguous from the request. Do not invent classification metadata.

## Complete a workflow

For a multi-step request:

1. Start the record and retain the returned `id`.
2. Use that exact `id` for notes, pause, resume, or stop.
3. Do not stop the record until the user asks or the requested workflow explicitly includes completion.
4. Report the affected record's title, ID, status, and relevant result or note type.

If any step fails, stop the sequence, report the structured failure, and leave already completed EchoLog actions unchanged.

## Preserve privacy

Record only content the user explicitly asks to place in EchoLog. Never copy Codex prompts, responses, reasoning, terminal transcripts, environment variables, credentials, or tmux pane content into a title, note, or result.
