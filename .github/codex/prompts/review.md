Review this pull request in read-only mode. Focus on correctness, backward compatibility, database migration safety, plugin failure isolation, tmux-status v3 contract drift, and privacy.

Verify that v1/v2 inputs remain supported, v3 never guesses conversation IDs, unknown identities stay null, scheduled persistence is idempotent, and no prompt, response, reasoning, terminal transcript, or pane content is stored.

Use read-only inspection. Review the committed tests and ordinary CI evidence, but do not run build or test commands that write caches or artifacts. Do not edit files, use network tools, expose secrets, or recommend merging.

Return `verdict: fail` for any actionable correctness, data-loss, privacy, security, migration, or contract-compatibility finding. Return `verdict: pass` only when no blocking finding remains.
