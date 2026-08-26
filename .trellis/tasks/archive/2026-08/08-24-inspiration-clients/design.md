# Client design

## Ownership

This task exclusively owns:

- `plugins/inspiration/src/cli.ts`
- `plugins/inspiration/web/index.js`
- Inspiration command registration in `src/cli/index.ts`
- Client/Web/report tests in `tests/inspiration-clients.test.ts`

It MUST NOT edit backend stores/routes/schema, package manifest/config,
`plugins/inspiration/src/types.ts` or `index.ts`, root registry/build files, or
README.

## Boundary

CLI and Web know only HTTP DTOs. They do not select candidates, infer status,
resolve active records, or perform schedule conversion. Web follows the Shell
contribution contract (`faces/load/loadLive/renderFace/handleAction/unmount`).
The plugin `index.ts` integration owned by the parent will register the report
section using a backend summary method exposed by the agreed service contract.

## PR #36 shared validation/pagination

`@echolog/plugin-inspiration/http-validation` is a pure package subpath with no
database or service imports. Both plugin HTTP routes and the root CLI import its
offset-aware ISO validator. `pagination.ts` owns opaque delivery cursor
encoding/decoding; clients pass cursors through and never reconstruct them.

## Frontend reference adaptation

The user-provided Chronosprout Web is a visual/interaction reference, not a
domain or data-contract dependency. EchoLog adapts its focused card hierarchy,
compact metadata/tag treatment, clear action bar, history rail/list, responsive
breakpoints, focus visibility, and reduced-motion treatment inside the existing
Inspiration contribution. It does not copy confidence/Agent/evidence/revival
fields, offline export behavior, or archive/extract/revive semantics.

## Live contribution invalidation

The Shell merges `loadLive()` data but its Core `liveSignature()` and
`patchLiveDom()` deliberately cover Core faces only. The Inspiration
contribution uses the `refresh` and `root` values already supplied at
activation. It signatures the rendered Inbox and Flow snapshots separately,
requests a Host refresh only on a real change, and retains the old rendered
state while an input under `#pages` is active. The next quiet poll retries the
pending invalidation. Unmount advances a lifecycle generation so in-flight and
future live loads cannot mutate state or request refresh. Polls that overlap a
slow Host rebuild wait on one contribution-owned refresh promise before taking
their next snapshot, preventing duplicate whole-book rebuilds.
