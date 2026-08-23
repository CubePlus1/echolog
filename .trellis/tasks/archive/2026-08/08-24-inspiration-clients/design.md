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
