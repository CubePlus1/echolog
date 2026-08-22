# EchoLog Codex Plugin

This Plugin packages three EchoLog Skills and the local `el mcp` server for
same-machine Codex use. It does not install EchoLog, PostgreSQL, or the daemon,
and it never bundles `config.yaml`, credentials, or activity history.

## Prerequisites

```bash
command -v el
command -v uv
el daemon status --json
el mcp --help
```

Build EchoLog before installing the Plugin so the `el` wrapper points at a
bundle that contains the MCP adapter.

## Personal marketplace development install

From the EchoLog repository root, create the default personal marketplace and
its normal source directory with the built-in Plugin Creator helper:

```bash
python3 ~/.codex/skills/.system/plugin-creator/scripts/create_basic_plugin.py \
  echolog --with-skills --with-mcp --with-marketplace
rsync -a --delete integrations/codex/echolog/ ~/plugins/echolog/
uv run --with pyyaml python \
  ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py \
  ~/plugins/echolog
echolog_marketplace="$(python3 \
  ~/.codex/skills/.system/plugin-creator/scripts/read_marketplace_name.py)"
codex plugin add "echolog@${echolog_marketplace}" --json
```

Start a new Codex task or CLI session after installation. Existing tasks do
not acquire newly installed Skills or MCP tools.

## Update during development

Do not edit the marketplace file or installed cache. Refresh the copied source,
apply one supported cachebuster, then reinstall from the same marketplace:

```bash
rsync -a --delete integrations/codex/echolog/ ~/plugins/echolog/
python3 ~/.codex/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py \
  ~/plugins/echolog
echolog_marketplace="$(python3 \
  ~/.codex/skills/.system/plugin-creator/scripts/read_marketplace_name.py)"
codex plugin add "echolog@${echolog_marketplace}" --json
```

The cachebuster belongs only to the copied development source. Keep the
repository manifest at its stable semantic version.

## Remove and reinstall

```bash
echolog_marketplace="$(python3 \
  ~/.codex/skills/.system/plugin-creator/scripts/read_marketplace_name.py)"
codex plugin remove "echolog@${echolog_marketplace}" --json
codex plugin add "echolog@${echolog_marketplace}" --json
```

Removal clears the installed Plugin bundle from Codex; it does not delete
EchoLog records or disconnect the local database.

## Diagnostics

- `executable not found` for `el`: install/build EchoLog and put `el` on PATH.
- The bundled launcher receives PATH from Codex and ultimately executes
  `el mcp`; it contains no machine-specific executable path.
- MCP starts but a tool returns `CONNECTION_ERROR`: start the EchoLog daemon;
  the Plugin does not start infrastructure automatically.
- `control_record` can stop a record and is conservatively marked destructive.
  Codex may ask for confirmation; approve only the intended record ID. A
  non-interactive session cancels the call when no approval channel is present.
- `PLUGIN_DISABLED` or `PLUGIN_DEGRADED`: only the affected optional EchoLog
  plugin tool is unavailable; inspect `el plugins doctor --json`.
- Skills or tools are absent after install/update: start a new Codex task or
  CLI session and confirm EchoLog is installed and enabled under the marketplace
  name returned by `read_marketplace_name.py`.
- The Plugin was removed: its installed bundle is absent; reinstall it and
  start a new session.
- The bundled MCP server was disabled in Plugin settings: MCP tools are absent.
  A separately discoverable Skill may still use its documented CLI fallback.

## Product and privacy boundary

Supported: same-machine Codex in the ChatGPT desktop app and Codex CLI.

Not supported: Codex Cloud or ChatGPT Web reaching a daemon on the user's Mac,
mobile, or the Codex IDE extension Plugin browser. The Plugin never records
Codex prompts, responses, reasoning, terminal transcripts, environment
variables, credentials, or tmux pane content.
