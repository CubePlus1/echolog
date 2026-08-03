# Implementation plan

1. Protect tmux-status `main` as PR-only with admin enforcement and force-push/deletion disabled; leave required checks empty.
2. Finalize tmux-status v3 producer fields, canonical JSON Schema, fixtures, snapshot/recovery rendering, and Python contract/unit tests.
3. Add EchoLog controlled contract copy and digest, v1/v2/v3 parser/types, shared fixture tests, immutable migration `002`, and idempotent store integration.
4. Verify plugin degradation and privacy invariants; run both repositories' local test suites plus EchoLog typecheck/build and Skill/Plugin validators.
5. Add ordinary CI and the private-contract drift workflow skeleton; use the repositories' bound Codex GitHub integration for PR review.
6. Commit only scoped paths in each repository, push both feature branches, and create at most one draft PR per repository.
7. Inspect actual workflow runs and exact check contexts. Configure only successful deterministic checks as required; keep missing-secret gates non-required.
8. Request `@codex review`, report findings and branch-protection evidence, and wait for user confirmation without merging.

## Validation commands

- tmux-status: `python3 -m unittest discover -s tests -v`
- EchoLog: `pnpm test`, `pnpm typecheck`, `pnpm build`
- Skill/Plugin validators: official local validators for both tmux-status Skill and EchoLog Codex Plugin/Skills
- Contract drift: local digest/fixture check without secrets; remote workflow only with `TMUX_STATUS_CONTRACT_READ_TOKEN`

## Rollback points

- Before commit: revert only task-owned paths, preserving all pre-existing dirty files.
- After push: revert commits on feature branches; do not rewrite protected `main`.
- Runtime: disable tmux-status or revert consumer code; preserve migration `002` data.
