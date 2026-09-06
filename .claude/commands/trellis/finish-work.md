# Finish Work

Complete the current request's authorized wrap-up. Check acceptance before task bookkeeping; a session ending or a commit existing does not establish task completion. Apply `.trellis/workflow.md` and AGENTS.md for authorization, branches, and PR review.

## Step 1: Inspect Current State

```bash
python3 ./.trellis/scripts/get_context.py --mode record
git status --porcelain
```

Read the current task's acceptance and verification evidence. Inspect the task-owned diff and actual commits. Leave unrelated tasks alone unless the user asked to clean them up; do not introduce an unsolicited archive-confirmation prompt.

## Step 2: Finish the Deliverable

- If implementation or required checks remain, execute the applicable workflow step directly, then return here. Do not send the user away to invoke another command.
- If task changes are uncommitted and commits are authorized, perform Phase 3.4 directly. Otherwise retain the verified local diff and report commit status separately. An unrequested commit is not a local-delivery gate.
- Preserve unrelated dirty paths. Inspect mixed files/hunks before classifying ownership; stage only attributable task changes. Ask only if essential ownership cannot be established and the requested next action would affect unknown work.
- A requested PR/merge/release must satisfy its own authorization and latest-commit review requirements. Pending external work does not erase completed local work, but remains incomplete when included in the requested outcome.

## Step 3: Archive Only Completed Tasks

Archive a task only when its own acceptance is met, including merge/release if that task requires them. Archive only the current task or others explicitly included in the requested cleanup. Never archive an unfinished task to clear the active pointer.

```bash
python3 ./.trellis/scripts/task.py archive --help
```

Inspect script/configuration side effects first. Archive can auto-commit: use a supported no-commit option when requested/needed, or leave the task unarchived if the operation cannot honor current constraints. Run permitted archive operations on a task branch only:

```bash
python3 ./.trellis/scripts/task.py archive <task-name>
```

If the user only asks to clear active state, `task.py finish` clears the session pointer without declaring completion. No active task means no archive step; do not manufacture one for this command.

## Step 4: Preserve Useful Context and Report

Record a journal only when it adds useful cross-session context and its side effects are authorized. Inspect `add_session.py --help` and auto-commit settings. Use actual task commit hashes; omit unsupported claims or fabricated hashes. Do not create commits merely to make a journal possible.

```bash
python3 ./.trellis/scripts/add_session.py --title "Session Title" --commit "<actual-task-hashes>" --summary "Useful decisions and verified outcome"
```

Remove only this session's disposable temporary files. Report what was delivered, the meaningful verification, and any requested step still blocked. Distinguish local delivery, commits, PR review, merge, deployment, and task archive where relevant. Finish authorized actions yourself rather than ending with a reminder for the user to run this command.
