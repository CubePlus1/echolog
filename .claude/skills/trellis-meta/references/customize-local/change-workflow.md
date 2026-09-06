# Change Local Workflow

When the user wants to change Trellis phases, next-action hints, whether to create tasks, whether to use sub-agents, or when to check/wrap up, edit `.trellis/workflow.md` first.

## Read These Files First

1. `.trellis/workflow.md`
2. Entry files for the current platform, such as skills/commands/prompts/workflows
3. The current task's `task.json` and `prd.md`

## Common Needs And Edit Points

| Need | Edit point |
| --- | --- |
| Change phase names or phase order | `Phase Index` and the corresponding Phase sections. |
| Change whether to create a task when there is no task | `[workflow-state:no_task]` state block. |
| Change the next step during planning | Phase 1 and `[workflow-state:planning]`. |
| Change whether an agent is required during in_progress | Phase 2 and `[workflow-state:in_progress]`. |
| Change wrap-up after completion | Phase 3 and `[workflow-state:completed]`. |
| Change which skill a user intent triggers | Request Triage, Routing and Completion Rules, and the relevant numbered phase step. |

## Modification Steps

1. Find the relevant section in `.trellis/workflow.md`.
2. When changing rules, keep explicit trigger conditions and next actions.
3. If adding or renaming a skill/agent, synchronize the corresponding files in platform directories.
4. The per-turn workflow-state hook parses `[workflow-state:STATUS]` blocks from `.trellis/workflow.md`; keep paired STATUS strings identical. Also inspect `.claude/hooks/session-start.py`, which emits its own task next-action hints, and the continue command. Keep all actual entry points consistent with the changed policy.
5. Make the AI reread `.trellis/workflow.md`; do not keep using rules from the old conversation.

## Example: Relax Task Creation Requirements

To change when task creation can be skipped, usually edit `[workflow-state:no_task]`:

```md
[workflow-state:no_task]
Simple answers, read-only audits, and narrow documentation/rule maintenance may run without a task. For product work, reuse/create useful local tracking within existing authorization; do not ask for process consent.
[/workflow-state:no_task]
```

If the formal Phase 1 flow also needs to change, synchronize the Phase 1 section.

## Example: One Platform Does Not Use Sub-Agents

Direct execution is already the default on every platform. If the user wants a stricter platform-specific delegation rule, add that scoped exception to Phase 2 and its applicable state block; inspect existing routing rather than assuming a platform group exists. Preserve usable optional agent definitions for other workflows.

## `/trellis:continue` Route Table

`/trellis:continue` resumes a task by deciding which phase step to load next. The decision combines `task.json.status` with the presence of artifacts inside the task directory. The mapping is fixed in the command itself; forks that add custom statuses must extend both the workflow.md tag block and this table.

| `status` | Artifact state | Resume at |
| --- | --- | --- |
| `planning` | `prd.md` missing | Phase 1.1 (load `trellis-brainstorm`) |
| `planning` | sufficient scope/acceptance and implementation authorized | run `task.py start` and continue without another approval |
| `planning` | consequential decision or necessary context missing | inspect evidence, complete useful context, clarify only a material blocker |
| `planning` | extra documents absent but scope/acceptance sufficient | proceed; complexity alone does not require design/implementation documents |
| `in_progress` | implementation unfinished | Phase 2.1 (direct implementation; optional useful delegation) |
| `in_progress` | implementation done, no `trellis-check` run | Phase 2.2 (`trellis-check`) |
| `in_progress` | check passed | Phase 3.3 (spec update) → 3.4 (commit) |
| `completed` | task is still in active tree | Phase 3.5 (run `/trellis:finish-work` to archive) |

When you add a custom status (e.g. `in-review`), add a `[workflow-state:in-review]` block in `.trellis/workflow.md` for the per-turn breadcrumb AND extend this route table — usually by editing the `/trellis:continue` command file (`.{platform}/commands/trellis/continue.md` or equivalent) to add a row that decides where to resume from. Without the route entry, `/trellis:continue` will fall through to a default branch and the user will not land on the step you intended.

## Notes

`.trellis/workflow.md` is the local project workflow, not an immutable template. The user can adapt it to team habits. After editing it, platform entry files may still contain old descriptions, so inspect them too.
