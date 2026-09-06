# Continue Current Task

Resume the first unfinished applicable step in `.trellis/workflow.md`. Preserve the original objective, accepted decisions, and existing authorization. A status or phase change does not require another approval.

## Load Context

```bash
python3 ./.trellis/scripts/get_context.py
python3 ./.trellis/scripts/get_context.py --mode phase
```

Inspect current task, relevant artifacts, git state, and prior authorization. A request to continue an implementation task resumes implementation. If the prior scope was explicitly planning-only or a consequential decision remains unresolved, keep that boundary and continue independent preparation.

## Route by Remaining Work

- No active task: follow request triage; reuse/create a suitable task when useful or proceed inline for taskless work. Do not ask for process consent.
- `planning` with insufficient goal/acceptance: **1.1**, inspecting evidence before clarifying consequential gaps.
- `planning` with sufficient scope/acceptance: **1.4**, run `task.py start` and proceed if implementation is authorized. Extra documents are needed only for a concrete purpose; JSONL context is needed only for agents actually consuming it.
- `in_progress` with implementation unfinished: **2.1**.
- Implementation done but required verification missing: **2.2**.
- Verification passed: **3.3** assess useful spec updates, **3.4** perform authorized commits, then **3.5** execute wrap-up.
- `completed` but not archived: verify acceptance and run authorized finish-work steps. Never archive merely because the status says completed.

Skip applicable steps whose outputs are already valid. Revisit only facts affected by new evidence or scope; do not restart planning or repeat passing checks without cause.

## Execute

```bash
python3 ./.trellis/scripts/get_context.py --mode phase --step <X.Y>
```

Load the relevant guidance and keep progressing to the requested outcome. Use available skills/tools; unavailable slash commands or agent types have an inline equivalent. Report an exact blocker only after independent authorized work is done. Local completion, commits, review, merge, and deployment are separate states.
