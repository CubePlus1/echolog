# Schedule abort terminalization implementation plan

1. Freeze task context and disjoint implementation/test ownership.
2. In parallel:
   - implementation agent adds abort classification and pre-finalize guards;
   - regression agent updates the abort unit contract and adds real Host
     timeout/stop/late-resolution tests.
3. Main integrates and inspects every await-to-persistence boundary.
4. Run focused Schedule/Host tests, explicit PostgreSQL integration, full
   `pnpm test`, `pnpm typecheck`, `pnpm build`, and diff-check.
5. Dispatch an independent read-only reviewer; resolve any P0-P2 and re-review.
6. Update durable specs/PR tracking, append implementation and archive commits,
   record the session, and leave push/merge to the owning integration workflow.
