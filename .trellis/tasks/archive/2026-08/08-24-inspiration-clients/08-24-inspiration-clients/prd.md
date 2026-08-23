# Inspiration CLI Web and report clients

## Goal

Expose Capture and Flow through thin HTTP CLI commands, ready-only Web pages,
and a concise daily-report section without duplicating backend policy.

## Requirements

- Top-level `el inspiration` supports capture, inbox/list, show, edit,
  archive/restore, Flow next/outcome, settings, and history/deliveries.
- Global `--json` prints raw API success/error bodies and all failures are
  non-zero; help documents values and examples.
- Web contributes Inbox and Flow faces through the existing plugin Web Host,
  escapes all dynamic text/attributes, and delegates all validation/selection
  to canonical plugin APIs.
- Web assets are imported only for a ready plugin and unmounted when unavailable.
- Daily report summarizes captures/surfaces/outcomes without embedding stored
  inspiration bodies by default.

## Acceptance Criteria

- [x] CLI is an HTTP-thin client with raw `--json`, non-zero errors, and complete
  command help.
- [x] Web Inbox can capture/filter/edit/archive and Flow can next/respond using
  only `/api/plugins/inspiration/*`.
- [x] Disabled/degraded plugins add no Web faces and return structured errors
  through CLI/API.
- [x] Dynamic Web text is escaped and no schedule UI/action exists.
- [x] Daily report contribution is covered by tests.
