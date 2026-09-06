# Change Local Agents

When the user wants to change `trellis-research`, `trellis-implement`, or `trellis-check` behavior, edit platform agent files in the user project.

## Read These Files First

1. Target platform agent directory
2. `.trellis/workflow.md` Phase 2 / research routing
3. Current task `prd.md` when present, otherwise the dispatch scope
4. Existing relevant `implement.jsonl` / `check.jsonl` entries when used
5. Relevant hook or agent prelude

## Common Paths

| Platform | Path |
| --- | --- |
| Claude Code | `.claude/agents/trellis-*.md` |
| Cursor | `.cursor/agents/trellis-*.md` |
| OpenCode | `.opencode/agents/trellis-*.md` |
| Codex | `.codex/agents/trellis-*.toml` |
| Kiro | `.kiro/agents/trellis-*.json` |
| Gemini CLI | `.gemini/agents/trellis-*.md` |
| Qoder | `.qoder/agents/trellis-*.md` |
| CodeBuddy | `.codebuddy/agents/trellis-*.md` |
| Factory Droid | `.factory/droids/trellis-*.md` |
| Pi Agent | `.pi/agents/trellis-*.md` |
| Reasonix | `.reasonix/skills/trellis-*/SKILL.md` (subagent frontmatter) |
| ZCode | `.zcode/cli/agents/trellis-*.md` |

Use the actual paths in the user project as authoritative.

## Common Needs

| Need | Which agent to edit |
| --- | --- |
| Research must write files, not only reply in chat | `trellis-research` |
| Certain local specs must be read before implementation | `trellis-implement` + `implement.jsonl` configuration rules |
| Specific commands must run during checking | `trellis-check` |
| Agent must not modify certain directories | The corresponding agent's write boundary instructions |
| Agent output format must be fixed | The corresponding agent's final/reporting instructions |

## Modification Principles

1. **Preserve role boundaries**: research returns evidence and persists only when durable output is requested or useful; implement writes implementation; check reviews and fixes only when authorized.
2. **Do not hard-code project specs into agents**: long-term specs belong in `.trellis/spec/`; agents are responsible for reading them.
3. **Make read order explicit**: dispatch scope and task path when present, then relevant existing task artifacts and spec/research. Taskless assignments do not require manufacturing a task.
4. **Make write boundaries explicit**: which directories may be written and which may not.
5. **Synchronize across platforms**: when the user configured multiple platforms, decide whether to change only the current platform or all platform agents.

## Agent Pull Platforms

Preserve relevant context loading in the prelude. Reuse supplied context and make task artifacts conditional on their existence and purpose; taskless work still reads applicable specs.

## Hook Push Platforms

If context is injected by a hook, the agent file should still retain responsibility boundaries. Do not remove PRD/spec requirements from the agent just because a hook injects context.
