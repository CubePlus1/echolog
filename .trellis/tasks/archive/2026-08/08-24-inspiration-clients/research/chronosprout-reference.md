# Chronosprout frontend reference

User-provided local reference:
`/Users/sc/0code/0toy/0HKT/eoove-labs-chronosprout`.

Relevant source files reviewed on 2026-08-26:

- `web/src/main.js`
- `web/src/style.css`
- `web/index.html`
- `web/README.md`

Patterns to adapt within EchoLog's existing Web contribution contract:

- A focused idea-card stage with clear project/status metadata and tag chips.
- Strong visual hierarchy between the current inspiration, outcome controls,
  settings, and the delivery-history rail/list.
- Compact state markers, empty/failure states, responsive layout, visible focus,
  and reduced-motion behavior.
- Scoped native JavaScript/CSS with escaped dynamic values and no runtime
  dependency.

Patterns intentionally not copied:

- AI confidence, agent trace, evidence, repository, or revival fields.
- Suiya archive/extract/revive execution semantics.
- Offline JSON export/data bridge, global page shell, or keyboard mappings that
  would conflict with EchoLog.

EchoLog invariants remain authoritative: ready-only loading, canonical HTTP
APIs, failed deliveries are non-actionable, no Schedule integration, and no
screenshots/prompts/replies stored.
