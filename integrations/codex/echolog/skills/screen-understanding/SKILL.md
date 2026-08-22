---
name: screen-understanding
description: Read and summarize recent AI screen-understanding observations from the local EchoLog daemon. Use when the user asks what the recent screenshots showed or wants the latest recognized activity; never change settings or expose credentials.
---

# Screen Understanding

Use this Skill for explicit requests about what EchoLog's recent AI screen
recognition saw. It is read-only: never enable or disable recognition, change
the interval, manage Provider profiles, or touch the Keychain from this Skill.

## Check availability

Prefer the bundled EchoLog MCP tool `get_screen_understanding`. If the bundled
MCP server is unavailable because this Skill is installed standalone, resolve
`el` from `PATH` and use the documented CLI fallback:

```bash
command -v el
el daemon status --json
```

If the daemon is unhealthy, preserve the structured error and tell the user to
start the daemon. Do not start or reconfigure services automatically.

```bash
el screen understanding latest --json
el screen understanding history --limit 5 --json
```

## Read the observations

- Use `get_screen_understanding` with a small `limit` (usually 2–5) for recent screenshots.
- For the standalone fallback, use `el screen understanding latest --json` or `el screen understanding history --limit 5 --json`.
- Treat timestamps, summaries, activities, app labels, confidence, and the sensitive flag as authoritative stored observations.
- Report the newest observation first and distinguish the capture time from the completion time when useful.
- State clearly when the screen-time plugin is disabled, degraded, or has no observations.

## Privacy

Never include API keys, raw screenshots, image data, provider request prompts,
raw provider responses, or terminal transcripts. Only summarize the stored
structured observation fields requested by the user, and describe sensitive
content generically.
