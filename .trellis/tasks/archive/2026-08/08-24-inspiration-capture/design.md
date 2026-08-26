# Capture design

## Ownership

This task exclusively owns:

- `plugins/inspiration/{echolog.plugin.json,config.schema.json,package.json,tsconfig.json,tsup.config.ts}`
- `plugins/inspiration/src/{schema.ts,migrations.ts,store.ts,routes.ts}`
- Capture-focused tests under `tests/inspiration-capture.test.ts`

It MUST NOT edit Flow files, client/Web files, root registry/build files, README,
or shared `plugins/inspiration/src/types.ts` and `index.ts`.

## Data model

`inspirations` stores `id`, optimistic `version`, `content`, normalized `tags`,
optional `project`, lifecycle `status` (`inbox|kept|archived`), timestamps, and
`last_surfaced_at`. `inspiration_flow_settings` and
`inspiration_flow_deliveries` are created in the same private migration series
from the parent design so the Flow agent can implement its store independently.

No foreign key may point outside plugin-owned inspiration tables.

## API shape

- `POST /api/plugins/inspiration/inspirations`
- `GET /api/plugins/inspiration/inspirations`
- `GET /api/plugins/inspiration/inspirations/:id`
- `PATCH /api/plugins/inspiration/inspirations/:id`
- `POST /api/plugins/inspiration/inspirations/:id/archive`
- `POST /api/plugins/inspiration/inspirations/:id/restore`

Mutations return the canonical row. Version conflicts return `409` with
`currentVersion` when available. Search is PostgreSQL `ILIKE` over content;
tags/projects/statuses are exact deterministic filters.
