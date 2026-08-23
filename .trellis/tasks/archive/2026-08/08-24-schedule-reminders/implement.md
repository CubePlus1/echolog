# Schedule data and reminders implementation plan

1. Backend agent creates the Schedule package metadata, schema, migrations,
   types, validators, store, reminder service, routes, plugin definition, and
   backend/integration tests in its exclusive files.
2. CLI agent adds the `el schedule` command tree and isolated HTTP server tests
   in its exclusive files, targeting the frozen parent routes.
3. Main agent wires workspace build/registry/config only after both agents
   finish, then runs focused tests and resolves cross-layer issues.
4. Independent check validates concurrency, dedupe, restart, failure, disabled,
   degraded, timeout, JSON, error, and no-Core-dependency criteria.
