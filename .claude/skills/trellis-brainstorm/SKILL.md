---
name: trellis-brainstorm
description: "Resolves consequential requirement ambiguity using existing evidence and focused questions. Use when missing user intent materially changes the goal or acceptance; complexity or multiple routine implementation choices alone do not trigger an interview."
---

# Trellis Brainstorm

## Clarification Boundary

Ask only when unresolved intent materially changes the goal, correctness, or consequences. Choose reasonable reversible implementation details from repository patterns. A user explicitly requesting an exhaustive interview may expand this scope.

Ask the smallest useful set of related questions, with a recommendation where justified. Stop questioning once there is enough information to execute; continue independent authorized work while awaiting answers.

## Non-Negotiable Evidence Rule

If a question can be answered by exploring the codebase, explore the codebase instead.

This is mandatory. Before asking the user a question, first check whether the answer is already available in code, tests, configs, docs, existing specs, or task history.

Do not ask the user to confirm facts that the repository can answer. Ask only for product intent, preference, scope, risk tolerance, or decisions that remain ambiguous after inspection.

---

Use this skill during Phase 1 planning to turn the user's request into clear requirements and planning artifacts.

## Preconditions

Follow `.trellis/workflow.md` for task selection. An implementation request authorizes necessary local planning and task creation; do not request separate process consent. Planning-only requests remain planning-only.

If the work needs durable task tracking and no matching task exists, create one; otherwise use a concise inline plan:

```bash
TASK_DIR=$(python3 ./.trellis/scripts/task.py create "<short task title>" --slug <slug>)
```

Use a concise title from the user's request. Use a slug without a date prefix. `task.py create` adds the `MM-DD-` directory prefix automatically.

`task.py create` creates the default `prd.md`. Update that file with the current understanding before asking follow-up questions.

## Planning Flow

1. Capture the user's request and initial known facts in `prd.md`.
2. Inspect available evidence before asking questions:
   - code, tests, fixtures, and configs
   - README files, docs, existing specs, and domain notes
   - related Trellis tasks, research files, and session history when present
3. Separate what you found into:
   - confirmed facts
   - product intent still needed from the user
   - scope or risk decisions still needed from the user
   - likely out-of-scope items
4. Resolve reversible details directly; ask only consequential unresolved questions.
5. Include a recommendation when the evidence supports one.
6. After each user answer, update `prd.md` before continuing.
7. Add `design.md` or `implement.md` only if each has a useful separate purpose for decisions, coordination, or resumption.
8. Before final review or `task.py start`, run the PRD convergence pass below.

Do not invent a project-specific product/spec hierarchy. If the repository already has product, domain, or spec docs, use them. If it does not, proceed with the evidence that exists.

## Question Rules

Keep questions concise; batch closely related missing inputs when it reduces back-and-forth. Do not ask facts already established in the conversation or repository.

For each consequential question, make clear:

- the decision needed
- why the answer matters
- your recommended answer
- the trade-off if the user chooses differently

Do not ask process questions such as whether to search, inspect files, or continue brainstorming. Do the evidence work directly. Ask the user only when the remaining issue is a product decision, preference, scope boundary, or risk tolerance choice.

## Thinking Framework: First Principles Analysis

When requirements are vague, solutions feel over-engineered, or you're about to add complexity "because everyone does" — decompose to fundamental truths before reasoning upward.

### Step 1: Restate the Problem

Strip away implementation details to one sentence.

> Bad: "We need to add Redis caching to the user profile endpoint"
> Good: "User profile data takes too long to load"

### Step 2: List Fundamental Truths

What is absolutely true (not opinion or convention)?

| Category | Examples |
|----------|----------|
| **Physical constraints** | Network latency ≥ 0, disk I/O has limits |
| **Business rules** | "Users must see their own data" |
| **Technical invariants** | "Data must be consistent" |
| **User needs** | "The user wants X within Y seconds" |

### Step 3: Challenge Assumptions

For each component of the current plan:

- **Fact or convention?** "We always use REST" — why?
- **What if we removed this?** If nothing breaks, it's unnecessary.
- **Solving the actual problem or a symptom?** Trace the causal chain.
- **Who benefits from this complexity?** If "nobody", simplify.

### Step 4: Build Up from Truths

1. Start with the minimum viable mechanism satisfying all truths
2. Add complexity only when a specific truth demands it
3. Each addition must answer: "Which truth requires this?"

### Step 5: Validate

- Does the solution solve the original problem?
- What assumptions need verification?
- What's the simplest experiment to test this?

## Artifact Rules

`prd.md` records requirements and acceptance:

- goal and user value
- confirmed facts
- requirements
- acceptance criteria
- out of scope
- open questions that still block planning

`design.md` records technical design for complex tasks:

- architecture and boundaries
- data flow and contracts
- compatibility and migration notes
- important trade-offs
- operational or rollback considerations

`implement.md` records execution planning for complex tasks:

- ordered implementation checklist
- validation commands
- risky files or rollback points
- follow-up checks before `task.py start`

`prd.md` can be sufficient regardless of size when it captures the goal and acceptance. Additional documents are useful for independently meaningful design/coordination needs, not a complexity gate. Taskless work uses an inline plan.

`implement.jsonl` and `check.jsonl` list relevant context for actual dispatched agents. Curate only manifests that will be consumed; inline execution loads context directly through `trellis-before-dev`. The seed `_example` row is not usable context.

## PRD Convergence Pass

Before proceeding, check that the PRD or inline plan accurately captures scope and acceptance. Edit inconsistencies or duplication when needed; do not rewrite an already sufficient plan as a mandatory gate.

The pass must be lossless:

- Collapse repeated facts into one authoritative section.
- Fold temporary brainstorm sections such as `What I already know`, `Assumptions`, and resolved `Open Questions` into Goal, Background, Requirements, Technical Notes, or Acceptance Criteria.
- Remove resolved open questions instead of leaving empty or already-answered sections.
- Merge parallel bug and requirement lists when they describe the same work; keep each defect's severity, evidence, and file:line anchors on the owning requirement.
- Preserve useful evidence, decisions, constraints, requirement IDs, and acceptance mappings; discard obsolete investigation details.
- Keep only genuinely blocking open questions.

After the pass, read `prd.md` top to bottom and verify that no fact is repeated across sections unless the repetition adds new information.

## Quality Bar

Before declaring planning ready:

- `prd.md` contains testable acceptance criteria.
- The PRD or inline plan has enough consistent scope and acceptance to guide execution.
- Repository-answerable questions have already been answered through inspection.
- Remaining open questions are genuinely about user intent or scope.
- Additional documents or manifests exist only where execution actually needs them.
- The requested next action is covered by existing authorization.

When implementation was already requested, activate any applicable task and proceed without another approval. When the user asked only for discovery/planning, deliver the plan. A remaining consequential blocker pauses only dependent work.
