# Implementation plan

1. Add the Trellis task context and set the branch/base metadata; inspect current Web, plugin-host, and README contracts.
2. Implement volume indexing and selected-book face generation in `web/app.js`; preserve current live pages only in today's period.
3. Replace the all-sheet DOM array with a bounded logical-sheet window and update proxy, layout, navigation, and timeline/TOC handlers.
4. Split live plugin loading with `loadLive`; stop full-history polling and refresh history only on structural changes/actions.
5. Add focused tests for the date-bucket helpers and run typecheck, unit tests, build, and CI-equivalent checks; verify bounded rendering and plugin live-load behavior in the browser acceptance pass.
6. Rewrite README to current functionality, quick start, plugin architecture, and bundled plugin capabilities; remove roadmap/planning claims.
7. Run browser acceptance against an isolated local server, record DOM/request/performance evidence, then review diff and issue scope.
8. Commit the implementation, push the feature branch, open one draft PR linked to #26, request Codex review, address findings, and only then mark the task complete.
