# Synchronize tmux-status v3 conversation recovery contract

## Goal

Synchronize EchoLog with a backward-compatible tmux-status schema v3 that preserves tmux instance identity and safely persists verified Codex/Grok conversation recovery mappings.

## Requirements

- Coordinate EchoLog Issue #19 with tmux-status Issue #1 and their dedicated feature branches.
- Define schema v3 as a strict superset of the published v2 producer and tmux identity contract.
- Keep tmux session identity separate from agent conversation identity; unconfirmed or conflicting identity evidence must remain `unknown` and must never be guessed from PID, cwd, title, or recency.
- Publish canonical JSON Schema and fixtures in tmux-status, with a controlled EchoLog copy, digest, local contract tests, and a remote drift-check workflow skeleton.
- Extend EchoLog to accept v1, v2, and v3, while strictly validating v3 and reusing the existing scheduled plugin collection job.
- Add an immutable `002` plugin migration and idempotent persistence for conversation-to-pane mappings and recovery information.
- Preserve plugin isolation and privacy: failures degrade only tmux-status; never store prompts, responses, pane contents, or terminal transcripts; never convert CPU, selection, or process liveness directly into work time.
- Add deterministic ordinary CI and request review through the repositories' existing Codex GitHub integration with `@codex review`.
- Protect both `main` branches as PR-only with admin enforcement and no force-push/deletion; require status checks only after their exact contexts have completed successfully.
- Create no more than one draft PR per repository and do not merge without user confirmation.
- Exclude all pre-existing user-local files and unrelated task artifacts from commits.

## Acceptance Criteria

- [ ] tmux-status v3 preserves every v2 required field and validates canonical confirmed, unknown, conflicting, empty-server, and invalid fixtures.
- [ ] EchoLog accepts v1/v2/v3, rejects malformed v3, and passes the same canonical fixture contract tests.
- [ ] Scheduled collection idempotently persists pane/conversation/recovery data through immutable migration `002`.
- [ ] Plugin parsing, execution, and persistence failures remain isolated from Core startup and active recording.
- [ ] Both repositories pass their unit/contract tests; EchoLog also passes typecheck, build, Skill validators, and Plugin validator.
- [ ] Ordinary CI workflows run deterministically; Codex review is requested through the bound GitHub integration, and the private-repository drift gate remains non-required before a successful run.
- [ ] Branch protection evidence confirms PR-only, admin enforcement, and force-push/deletion disabled on both `main` branches.
- [ ] Each repository has one draft PR with blockers, checks, privacy boundary, and rollout notes; neither PR is merged.

## Notes

- EchoLog: https://github.com/CubePlus1/echolog/issues/19
- tmux-status: https://github.com/CubePlus1/tmux-status/issues/1
- Both repositories already have the Codex GitHub integration bound; PR review is requested with `@codex review` and does not require a repository `OPENAI_API_KEY` secret.
- EchoLog needs a fine-grained token limited to private repository `CubePlus1/tmux-status` with `Contents: read` to enable the remote drift gate.
