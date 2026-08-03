# Codex Integration

EchoLog's Codex integration is a local-first client package for Codex App and Codex CLI. It does not upload records or replace the EchoLog daemon.

## Architecture

```text
Codex Plugin Skills
        |
        v
     el --json
        |
        v
EchoLog HTTP API on localhost:19827
        |
        v
EchoLog Core and PostgreSQL
```

The Codex Plugin under `integrations/codex/echolog` is unrelated to EchoLog's bundled Plugin API v1. The bundled plugins under `plugins/` run inside the EchoLog service; the Codex Plugin teaches Codex how to use EchoLog from outside the service.

## Prerequisites

- EchoLog is installed on the same machine as Codex.
- `el` is available on `PATH`.
- The EchoLog daemon and PostgreSQL are running.
- `el daemon status --json` returns `{ "status": "ok", ... }`.

The Skills do not install dependencies, start Docker, expose the daemon publicly, or read `config.yaml` directly.

`el` resolves its default configuration from the EchoLog installation root, so an unrelated `config.yaml` in the active Codex workspace cannot shadow it. Tests and multi-instance setups can select an alternate file explicitly with `ECHOLOG_CONFIG_PATH`.

## Skills-only MVP

The first integration increment contains two Skills:

- `$track-work` performs explicit record writes. Implicit invocation is disabled.
- `$review-work` reads status, history, notes, subtasks, reports, and screen-time without changing records.

Every EchoLog command uses `--json`. API and ambiguity errors remain structured so Codex can show the returned candidates rather than guessing which record to change.

Representative prompts:

```text
Use $track-work to start a task named "Review Codex Plugin manifest" in project echolog.
Use $track-work to add a blocker to record <id>.
Use $review-work to summarize my EchoLog activity today.
```

## Current limits

- This increment does not include MCP tools or lifecycle hooks.
- It does not support Codex Cloud or ChatGPT Web reaching a daemon on the user's Mac.
- It never records Codex prompts, responses, reasoning traces, terminal transcripts, or tmux pane content.
- Personal marketplace installation, update, and release verification are tracked separately in GitHub Issue #15.

## Development validation

Run the official Skill and Plugin validators against the integration directory. Then verify the CLI boundary independently:

```bash
command -v el
el daemon status --json
el status --json
```

The later MCP increment will remain an HTTP thin client. It must not connect directly to PostgreSQL or import EchoLog Core business logic.
