# Development Workflow

## Core Principles

1. A request to implement, fix, or optimize authorizes necessary local investigation, planning, edits, and verification. Planning-only and review-only requests end at their requested deliverable.
2. Resolve facts from the conversation and relevant repository evidence before asking. Choose reasonable reversible details autonomously; clarify only when missing information materially changes the goal, correctness, or consequences.
3. Existing authorization carries through phases. Ask only for a concrete action outside it, after completing independent preparation. Waiting on one answer does not block other authorized work.
4. Scale planning, documentation, delegation, and testing to the work. Complexity alone does not require extra files, sub-agents, or an approval ceremony.
5. Finish the requested outcome with evidence and authorized wrap-up. Distinguish local completion from commits, PR review, merge, and deployment. An unrequested release does not block local delivery; a requested but blocked release remains incomplete.

## Trellis System

### Specs and Identity

Read relevant `.trellis/spec/<layer>/index.md` and task-specific guidelines before coding. Some repositories have an additional package level. Discover actual paths with:

```bash
python3 ./.trellis/scripts/get_context.py --mode packages
```

Initialize identity only when a task/journal operation needs it and none exists:

```bash
python3 ./.trellis/scripts/init_developer.py <your-name>
```

### Task Commands

Use a task for product development or work benefiting from durable acceptance tracking. Simple answers, read-only audits, and narrow documentation/rule maintenance may run without one. Reuse matching tasks; preserve other sessions' active work.

```bash
python3 ./.trellis/scripts/task.py current --source
python3 ./.trellis/scripts/task.py list
python3 ./.trellis/scripts/task.py create "<title>" --slug <name>
python3 ./.trellis/scripts/task.py start <name>
python3 ./.trellis/scripts/task.py add-context <name> <action> <file> <reason>
python3 ./.trellis/scripts/task.py validate <name>
python3 ./.trellis/scripts/task.py finish
python3 ./.trellis/scripts/task.py archive <name>
```

`create` seeds `task.json` and `prd.md`, with optional context manifests; `--slug` sets the suffix of the `MM-DD-<slug>` directory. Use the returned task path. `start` sets `in_progress` and the session pointer. If session identity is missing, follow the command's hint using the real current session identifier. `finish` clears the pointer without completing the task. `archive` sets `completed`, moves the task, clears matching pointers, and can auto-commit. Inspect `--help` and configuration before commands with commit/external effects.

Optional metadata, hierarchy, and PR commands are listed by `task.py --help`. Create parent/child tasks only for deliverables benefiting from independent acceptance and ownership; record dependencies explicitly.

### Context and Journal

```bash
python3 ./.trellis/scripts/get_context.py
python3 ./.trellis/scripts/get_context.py --mode phase
python3 ./.trellis/scripts/get_context.py --mode phase --step <X.Y>
python3 ./.trellis/scripts/add_session.py --title "Title" --commit "<actual-hash>" --summary "Summary"
```

Journal useful cross-session facts using actual task commits; do not invent hashes or create bookkeeping commits when the user requested no commits. Preserve lasting decisions or expensive-to-recover evidence. Routine reads, intermediate hypotheses, and every session do not require new documents.

## Phase Index

```
Phase 1: Plan    -> establish scope, acceptance, and necessary context
Phase 2: Execute -> implement and verify the authorized outcome
Phase 3: Finish  -> resolve findings and perform authorized wrap-up
```

### Request Triage

- Determine the requested deliverable and existing authorization. No separate consent is needed to create a necessary local task or move from a sufficient plan into already requested implementation.
- Skip bookkeeping for simple answers, read-only audits, and narrow documentation/rule maintenance. Declining Trellis does not revoke an implementation request; continue inline with proportionate planning.
- Clarify only consequential unresolved intent or missing authorization. Continue independent work while awaiting an answer.
- `prd.md` records goal, constraints, and testable acceptance. Add `design.md` for durable decisions/contracts and `implement.md` for coordination or resumable execution only when useful. Neither is required merely because work is complex.
- Load `trellis-brainstorm` for material ambiguity, `trellis-before-dev` before coding, and `trellis-check` for verification. Unavailable commands or agent types do not prevent equivalent inline work.

[workflow-state:no_task]
Determine the requested outcome and reuse existing authorization. Answer or perform narrow rule/document maintenance inline; for product work, reuse/create a suitable local task without process consent. Plan proportionately, then start and implement if requested. Clarify only material missing intent or authorization; continue independent work.
[/workflow-state:no_task]

### Phase 1: Plan

- 1.0 Create/reuse task `[when needed · once]`
- 1.1 Establish scope and acceptance `[required · once]`
- 1.2 Research `[on demand]`
- 1.3 Configure context `[when delegating · once]`
- 1.4 Activate task `[when using a task · once]`
- 1.5 Check readiness

[workflow-state:planning]
Inspect evidence; use trellis-brainstorm only for material ambiguity. Record concise scope/acceptance in prd.md; add design/implementation documents only when useful. If independently delegating, supply relevant context. When implementation is authorized and no material blocker remains, run task.py start and continue without another approval. Planning-only requests end with the plan.
[/workflow-state:planning]

[workflow-state:planning-inline]
Inspect evidence; use trellis-brainstorm only for material ambiguity. Record concise scope/acceptance in prd.md; add design/implementation documents only when useful. Read relevant specs directly; skip JSONL curation inline. When implementation is authorized and no material blocker remains, run task.py start and continue. Planning-only requests end with the plan.
[/workflow-state:planning-inline]

### Phase 2: Execute

- 2.1 Implement `[required for implementation requests]`
- 2.2 Quality check `[required · repeat after relevant changes]`
- 2.3 Replan or rollback `[on demand]`

[workflow-state:in_progress]
Implement the authorized goal with task context and relevant specs. Default to direct execution; delegate only an independent bounded job when permitted and useful. Run proportionate checks, fix task-related findings, and do not repeat passing checks without new evidence. Assess spec updates (3.3), perform authorized commits (3.4), and execute finish-work (3.5). Report local/release status separately. trellis-implement is an agent type, not a skill; use callable tools or inline fallback.
[/workflow-state:in_progress]

[workflow-state:in_progress-inline]
Use trellis-before-dev, implement inline, then trellis-check with proportionate validation. Fix task-related findings; do not repeat passing checks without new changes or concerns. Assess useful spec updates (3.3), perform authorized commits (3.4), and execute finish-work (3.5). Report local/release status separately; pending external authorization does not block independent local work.
[/workflow-state:in_progress-inline]

### Phase 3: Finish

- 3.2 Debug retrospective `[on demand]`
- 3.3 Assess spec update `[required · once; write only if useful]`
- 3.4 Commit changes `[when authorized]`
- 3.5 Wrap up `[required within requested scope]`

[workflow-state:completed]
Verify acceptance and execute authorized finish-work steps. Preserve unrelated dirty paths. Commit/release status is separate from local completion; never archive unfinished acceptance or bypass PR review to clear a status.
[/workflow-state:completed]

### Routing and Completion Rules

Resume the first unfinished applicable step. Do not redo planning or approvals because a phase changed. Revisit only facts affected by new evidence/scope; missing optional documents are not blockers. Carry forward authorization when returning from review to implementation.

Use `/trellis:continue` or `/trellis:finish-work` when callable. Otherwise read `.claude/commands/trellis/continue.md` or `.claude/commands/trellis/finish-work.md` and perform equivalent steps directly. Taskless work follows the same acceptance/verification principles without manufacturing a task or journal.

## Phase 1: Plan

#### 1.0 Create/reuse task `[when needed · once]`

Before any file writes, including task creation, check `git status --short --branch` and `git branch --show-current`. On `main` or detached HEAD, create a task branch first, preserving existing changes. Follow AGENTS.md for Issue/README synchronization and external authorization; remote access must not block independent local work.

Then check `task.py current --source` and `task.py list`. Reuse a matching task; create one for product work or useful durable coordination without asking process consent. Simple answers, read-only audits, and narrow documentation/rule maintenance need no task. Honor an explicit request to skip Trellis with a proportionate inline plan.

#### 1.1 Establish scope and acceptance `[required · once]`

Inspect relevant code, current instructions, and decisions. Define the outcome, boundaries, and acceptance evidence in a concise PRD or inline plan. Use `trellis-brainstorm` for consequential ambiguity; choose routine implementation details yourself. Ask the smallest useful set of questions and continue independent work.

Add design/implementation documents only when their separate purpose justifies them. Do not split tasks or rewrite a sufficient PRD merely for a formatting gate. Update the plan when evidence changes scope/acceptance.

#### 1.2 Research `[on demand]`

Research specific uncertainty using available local/external tools and stop when evidence is sufficient. Preserve reusable decisions, exact contracts, or expensive-to-recover evidence in existing documents; routine findings need no standalone file.

Direct research is the default. Delegate only when authorized, useful, and independent of main-session work, with a bounded question, context, expected output, and completion criteria. Unavailable agent tooling is not a blocker.

#### 1.3 Configure context `[when delegating · once]`

Curate `implement.jsonl` / `check.jsonl` only if an actual dispatched agent consumes them. Relevant entries use `{"file": "<repo-relative-path>", "reason": "<why-needed>"}`; remove or ignore `_example` rows. Supply the task path and role explicitly instead of assuming a shared session pointer.

Load relevant specs/research, then `prd.md`, `design.md` if present, and `implement.md` if present. Inline execution reads context directly and skips JSONL bookkeeping. Do not make unused manifests a prerequisite.

#### 1.4 Activate task `[when using a task · once]`

When scope/acceptance are sufficient and implementation was requested, run `python3 ./.trellis/scripts/task.py start <task-dir>` and continue. No second approval is needed for planning, creating a task, or implementation within existing authorization. Deliver planning-only/review-only requests without implementation.

If session identity setup fails, follow the real error and inspect the environment. Preserve other session pointers and do not invent a shared identity. Complete independent preparation and report a persistent tool blocker precisely.

#### 1.5 Check readiness

Required: a clear enough goal and acceptance, relevant context, and authorization for the next action. Task-backed implementation also activates its task. Optional documents, interviews, research, and manifests are needed only for a concrete purpose. Clarify remaining consequential blockers; proceed on reversible details using repository patterns.

## Phase 2: Execute

#### 2.1 Implement `[required for implementation requests]`

Load `trellis-before-dev` when coding, read relevant context, and implement the requested outcome directly. Preserve unrelated changes and scope. Prefer existing APIs/patterns; add abstractions only for demonstrated complexity or meaningful duplication.

Delegate only a concrete independent task that improves time/quality when active instructions permit it. Platform support does not require delegation. Include `Active task: <task path>` when present, role, owned files, inputs, output, and completion criteria. Dispatched agents execute their roles without recursively spawning the same implement/check role. If an agent type is unavailable, work inline.

#### 2.2 Quality check `[required · repeat after relevant changes]`

Use `trellis-check` or direct equivalent. Review the entire current task diff against acceptance and relevant contracts. Run required repository checks applicable to affected layers and meaningful tests scaled to risk. Shared behavior/cross-layer contracts justify broader checks; prose/rule changes normally need consistency, references, and parser checks rather than the application test suite.

Fix issues introduced by this task or necessary for its goal. Separate unrelated failures and environment limits from regressions. Rerun affected checks after relevant fixes. Once sufficient checks pass, proceed; broaden/repeat only for new changes, failures, or unresolved concerns. Do not change unrelated systems merely to make all checks green.

#### 2.3 Replan or rollback `[on demand]`

Update scope/acceptance when evidence requires it, preserving existing authorization. Recover your own attributable changes with targeted edits; never revert user work or perform destructive history operations without authorization. For repeated failure, use `trellis-break-loop` to change the hypothesis or diagnostic method. Report exact persistent input/access blockers after completing independent work.

## Phase 3: Finish

#### 3.2 Debug retrospective `[on demand]`

Use `trellis-break-loop` for repeated failed fixes or a non-obvious cause worth preserving. Record a concise causal explanation and concrete prevention only where useful. Routine successful fixes need no retrospective document.

#### 3.3 Assess spec update `[required · once; write only if useful]`

Determine whether changed contracts or reusable non-obvious knowledge require a spec update; use `trellis-update-spec` for that change. Reuse the owning document and keep it proportional. Routine features/fixes do not automatically require a guide, seven-section template, or duplicated notes. If nothing useful changed, proceed without another artifact or confirmation.

#### 3.4 Commit changes `[when authorized]`

Check branch/status, inspect task changes, and run applicable checks. All commits belong on a task branch, never `main` or detached HEAD. Group task-owned changes into coherent commits using repository conventions.

When commits are authorized, execute without another plan-approval prompt. Stage identified task changes only, selecting hunks for mixed files. Preserve unrelated dirty paths; inspect before asking the user to classify them. If commits are not authorized or local-only edits were requested, retain the verified diff and continue applicable wrap-up. Ask for commit authorization only when the requested outcome requires it.

Inspect archive/journal auto-commit behavior; bookkeeping cannot bypass a no-commit instruction. Do not amend published history or push without corresponding authorization. Integration to `main` requires a PR and completed Codex review of its latest commit per AGENTS.md.

#### 3.5 Wrap up `[required within requested scope]`

Execute applicable `.claude/commands/trellis/finish-work.md` steps instead of leaving a reminder. Verify acceptance, preserve useful context, and perform authorized task/Issue/README cleanup. Archive only when the task's acceptance is met; session end or a commit alone is insufficient. Skip unrelated tasks and unnecessary bookkeeping.

Report the delivered change, verification, and remaining requested steps/blockers. Distinguish local completion, commits, review, merge, and deployment when relevant. Finish independent work before handing back a missing authorization question. Unrequested external actions must not obstruct local delivery.

## Customizing Trellis

This is the project workflow source. Keep the Phase Index, numbered walkthrough, continue/finish-work commands, and related skills consistent. Edit conflicting old rules directly instead of stacking overrides.

Hooks read `[workflow-state:STATUS]` blocks. Preserve matched tags and current names: `no_task`, `planning`, `planning-inline`, `in_progress`, `in_progress-inline`, `completed`. Extraction uses `## Phase Index`, `## Phase 1: Plan`, and `#### X.Y` headings. Represent required steps in their state blocks. `completed` is normally unreachable after archive removes the pointer; keep it consistent for other consumers.

For new statuses, update lifecycle writers and routing as well as tags. `after_finish` clears a pointer; `after_archive` represents completion. Inspect installed scripts/configuration instead of assuming upstream source paths exist.

Trellis upgrades may regenerate managed instructions. Preserve project policy when reviewing an upgrade diff; do not run `trellis update` merely to apply local prose edits.
