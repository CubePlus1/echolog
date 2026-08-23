# Client implementation plan

- [x] Add typed CLI contribution metadata and full `el inspiration` HTTP-thin
  command tree in the Core CLI composition point.
- [x] Add ready-only native-JS Inbox and Flow contribution with escaped output.
- [x] Add client/Web tests for paths, JSON/error behavior, actions, and absence
  of schedule semantics.
- [x] Add a report renderer/helper or contract consumed by parent integration.
- [x] Run focused tests and typecheck; report changed files only.

Validation: `pnpm exec tsx --test tests/inspiration-clients.test.ts`,
`pnpm typecheck`, and CLI help smoke checks.
