# Design: tmux-status v3 synchronization

## Contract ownership and compatibility

tmux-status owns `contracts/v3/tmux-status.schema.json` and representative fixtures. Schema v3 is additive over v2: it retains producer metadata and stable tmux server/session/window/pane instance fields while adding explicit pane aliases and `agent_conversations`.

EchoLog accepts legacy unversioned/v1 payloads and the existing strict v2 payload. It validates v3 independently in TypeScript against the same contract semantics, stores a controlled schema/fixture copy with a SHA-256 manifest, and never imports or duplicates the Python collector.

## v3 identity model

Each pane retains v2 fields and adds `tmux_target`, `pane_id`, `pane_pid`, `working_directory`, and `agent_conversations`.

Each conversation entry includes:

- `tool` and a `process_instances` object mapping each agent PID to exactly one process-incarnation key;
- `conversation_id_kind`;
- `conversation_id` as a UUID or `null`;
- `conversation_id_status` as `confirmed` or `unknown`;
- `identity_source` and nullable `source_path`;
- nullable `stable_mapping_key` and `resume_command`.

Confirmed entries require a UUID, a derived `<tool>:<conversation_id>` stable key, and resume command. Unknown entries require all three to be null. Conflicting evidence is represented as unknown, never resolved heuristically. Process-incarnation keys prevent PID reuse from merging unknown observations but are never conversation-ID evidence.

## Runtime persistence

The existing tmux-status scheduled job remains the only collection loop. `TmuxObservationStore.observe()` continues pane-minute persistence and additionally upserts conversation mappings in the same transaction.

Migration `002_tmux_agent_conversations` creates an additive table keyed by an observation identity. Confirmed mappings include pane instance, cwd, tool, verified conversation ID, and the producer's derived stable mapping key. Unknown observations include the PID-to-incarnation map; this key identifies an observation row and is never presented as a conversation ID.

The row preserves tmux target/IDs, pane and agent PIDs, cwd, identity status/source/path, optional verified ID, stable key, resume command, and first/last observation timestamps. Repeated or older snapshots are idempotent, and reordered writes retain the earliest first-observed timestamp without replacing newer metadata.

## Failure isolation

Adapter/schema, executable, timeout, and database errors propagate through the plugin host so only tmux-status becomes degraded. No Core table or recorder path depends on the new table.

## CI and cross-repository drift

Each repository gets deterministic ordinary CI. Codex review uses the repositories' existing GitHub integration and is requested on the PR with `@codex review`; no duplicate API-backed GitHub Actions workflow or repository `OPENAI_API_KEY` secret is introduced.

The EchoLog drift workflow compares the controlled copy and digest with the canonical private repository. It requires a fine-grained read-only token; absence is a visible blocker and the gate remains non-required. Local contract tests remain secret-free.

## Rollout and rollback

Rollout order is producer contract first, then EchoLog consumer. v1/v2 compatibility permits independent deployment. Rollback reverts code or disables the plugin; immutable migration tables and captured local data remain. No down migration deletes user data.
