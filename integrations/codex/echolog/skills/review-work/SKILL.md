---
name: review-work
description: Query and summarize local EchoLog status, history, notes, subtasks, daily reports, and screen-time through bundled MCP tools or the read-oriented `el` CLI fallback. Use when the user asks what they worked on, what is active, how a parent task is progressing, or requests an EchoLog review or report.
---

# Review Work

Prefer the bundled `echolog` MCP tools and use their returned data as evidence. If they are unavailable because this Skill was installed standalone, use `el --json` as the fallback. This skill must not change records, rules, plugin state, daemon state, or synchronized files.

## Check availability

1. When the bundled MCP server is available, call `get_status` as the first query.
2. If it returns an MCP tool error, preserve its JSON fields. For `CONNECTION_ERROR`, suggest `el daemon start`; do not retry through CLI because it uses the same daemon.
3. If the MCP server itself is unavailable, resolve `el` from `PATH` with `command -v el`. If it is missing, stop and point the user to EchoLog's installation instructions.
4. For CLI fallback, run `el daemon status --json`. If unhealthy, preserve the JSON error and suggest `el daemon start`. Do not start or reconfigure services automatically.

## Choose an MCP read tool

Use the narrowest matching query:

- `get_status` for today's summary and active records.
- `list_records` for bounded history filtered by `date`, `since`, `project`, `type`, `parentId`, or `limit`.
- `get_subtasks` for a parent, its direct children, and authoritative progress.
- `generate_report` for daily Markdown without filesystem sync.
- `get_screen_time` for today or a specified local date.

The scoped MCP adapter does not expose record notes. When notes are explicitly requested, use the CLI fallback command `el notes <record-id> --json`; this remains read-only.

## CLI fallback

Use these commands when the bundled MCP server is unavailable, or only `el notes` when MCP lacks the requested read operation:

```bash
el status --json
el today --json
el today --date <YYYY-MM-DD> --json
el log --limit <n> --json
el log --since <date-or-ISO> --project <project> --type <learning|project|task> --json
el log --parent <parent-id> --json
el log --roots --json
el subtasks <parent-id> --json
el notes <record-id> --json
el report --json
el report --date <YYYY-MM-DD> --json
el screen <YYYY-MM-DD> --json
```

Use the user's local date unless they specify another date. Apply only filters the user requested or that are necessary to keep the result bounded.

Do not run `sync`, `screen rules`, `plugins doctor`, `tmux watch`, `tmux mark`, any record mutation, or any daemon mutation as part of a review.

## Interpret results

- Treat returned records, durations, statuses, notes, and aggregates as authoritative.
- Distinguish running, paused, done, and cancelled records.
- When reporting parent progress, use `progress` returned by `el subtasks`; do not recalculate a different completion definition.
- When screen-time is disabled or degraded, report that limitation. Do not turn missing samples into zero usage.
- When a tool returns `isError: true` or a CLI command exits non-zero, preserve the structured JSON error and do not fabricate a partial answer.
- Separate factual observations from any inference or recommendation.

## Present the review

Lead with the requested outcome. Include record IDs only when they help the user continue an action or inspect a parent/child relationship. For a daily review, prefer:

1. completed work and results;
2. active or paused work;
3. blockers and next notes when requested;
4. time totals and screen-time only when present;
5. data gaps or degraded plugins.

Return the `markdown` field from `generate_report` or `el report --json` when the user explicitly asks for the report itself; otherwise summarize it without inventing entries.

Never include credentials, raw configuration, environment variables, prompt content, response content, reasoning traces, terminal transcripts, or tmux pane content in the review.
