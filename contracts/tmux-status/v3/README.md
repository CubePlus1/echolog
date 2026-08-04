# Controlled tmux-status v3 contract copy

These files are a byte-for-byte controlled copy of the canonical `contracts/v3` directory in the private `CubePlus1/tmux-status` producer repository. EchoLog uses the copy for secret-free local and pull-request contract tests; it does not copy the Python collector.

Local integrity check:

```sh
cd contracts/tmux-status/v3
shasum -a 256 -c SHA256SUMS
uvx --from check-jsonschema==0.33.3 check-jsonschema \
  --schemafile tmux-status.schema.json fixtures/*.json
python3 validate_semantics.py fixtures/*.json
```

The remote drift workflow needs `TMUX_STATUS_CONTRACT_READ_TOKEN`, restricted to `CubePlus1/tmux-status` with read-only Contents permission. Until that secret is configured and the workflow succeeds, remote drift enforcement remains intentionally non-required.

Persisted resource values use the canonical bounds: aggregate CPU is at most `1,000,000%`, and memory is at most `1,000,000,000 MB`; reporting thresholds use the same limits.
