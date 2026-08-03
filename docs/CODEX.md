# Codex Integration

EchoLog's Codex integration is a local-first client package for Codex App and Codex CLI. It does not upload records or replace the EchoLog daemon.

## Architecture

```text
Codex Plugin Skills ----> el --json ---+
Codex MCP host ---------> el mcp ------+
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

The Plugin and Skills do not install dependencies, start Docker, expose the daemon publicly, or read `config.yaml` directly.

`el` resolves its default configuration from the EchoLog installation root, so an unrelated `config.yaml` in the active Codex workspace cannot shadow it. Tests and multi-instance setups can select an alternate file explicitly with `ECHOLOG_CONFIG_PATH`.

## Install the combined Plugin

The package at `integrations/codex/echolog` combines both Skills and an
`.mcp.json` launcher for `el mcp`. For a default personal marketplace
development install, follow the exact create, sync, validate, install, update,
remove, and reinstall commands in the [Plugin README](../integrations/codex/echolog/README.md).

After installation or update, start a new Codex task or CLI session. Plugin
components are loaded at session start; an already-running task does not gain
new Skills or MCP tools.

## Skills

The first integration increment contains two Skills:

- `$track-work` performs explicit record writes. Implicit invocation is disabled.
- `$review-work` reads status, history, notes, subtasks, reports, and screen-time without changing records.

Inside the combined Plugin, both Skills prefer the bundled MCP tools. They
retain `el --json` as a standalone fallback; record-note review uses CLI because
the scoped MCP adapter does not expose note listing. API and ambiguity errors
remain structured so Codex can show candidates rather than guessing.

Representative prompts:

```text
Use $track-work to start a task named "Review Codex Plugin manifest" in project echolog.
Use $track-work to add a blocker to record <id>.
Use $review-work to summarize my EchoLog activity today.
```

## MCP tools

The combined Plugin registers the local stdio server from its bundled
`.mcp.json`. For standalone use without the Plugin, register it manually:

```bash
codex mcp add echolog -- el mcp
codex mcp list
```

The adapter exposes eight typed tools for status, history, subtasks, explicit
start/control/note writes, daily report generation, and screen-time. It uses the
same HTTP thin-client boundary as the CLI. Full contracts and limits are in
[MCP Server](MCP.md).

`control_record` is conservatively annotated destructive because stop is
irreversible in the current state machine. Interactive Codex surfaces may ask
the user to approve it; non-interactive runs cancel the call unless their tool
policy explicitly permits it.

## Current limits

- The MCP increment does not include lifecycle hooks, remote transport, resources, prompts, or custom UI.
- It does not support Codex Cloud or ChatGPT Web reaching a daemon on the user's Mac.
- It never records Codex prompts, responses, reasoning traces, terminal transcripts, or tmux pane content.
- Public universal-directory submission is not performed by this repository workflow; the package is prepared and audited for a separate publishing decision.

## Privacy and data boundary

- Records remain in the user's local EchoLog daemon and PostgreSQL.
- The Plugin does not bundle or read `config.yaml`, database credentials,
  history, or API keys.
- It does not open a public listener or tunnel localhost.
- It never records Codex prompts, responses, reasoning traces, terminal
  transcripts, environment variables, credentials, or tmux pane content.
- Removing or disabling the Plugin does not delete EchoLog records.

## Development validation

Run the official Skill and Plugin validators against the integration directory. Then verify the CLI boundary independently:

```bash
command -v el
el daemon status --json
el status --json
```

The MCP adapter is covered by an SDK client/stdio black-box test, including its exact tool inventory, schemas, annotations, start → note → stop flow, HTTP error preservation, daemon-offline behavior, and optional-plugin degradation.

Packaging tests additionally check manifest/MCP composition, referenced assets,
starter prompt limits, explicit-only writes, missing-`el` process failure, and
the absence of secrets, user records, or machine absolute paths.
