# Design: bounded book rendering and split refresh

## Data and volume model

Keep the API contract unchanged for callers, but derive a client-side volume index from the initial history response. The index contains four fixed current-month periods plus one entry per prior month. Each volume has a stable key, local date bounds, label, count, and the records belonging to it. The current period is the only volume that receives the live summary, active-task pages, form, and bundled-plugin pages.

The initial load may fetch the existing bounded history payload so hierarchy and parent links remain available. Subsequent live polls fetch `/records?limit=1&order=updated` as a lightweight latest-record probe, `/records/active`, and `/summary/today`; a full history refresh is triggered when the probe or today's record count changes for a record inside the bounded snapshot, or after an explicit write action. Updates to records outside the bounded snapshot advance the probe token without rebuilding the visible history.

## Book and DOM window

`state.faces` remains a complete lightweight face sequence for the selected volume, but `state.sheets` becomes a `Map<sheetIndex, HTMLElement>`. A small radius around `state.flipped` is materialized (the current sheet, the previous sheet needed for the left page, and nearby sheets for prefetch). A one-step flip creates the target sheet if necessary, changes state, lays out only the materialized map, and trims distant sheets after the CSS transition. `state.sheetCount` still represents the logical book length for indicators and clamping.

The existing transparent left-page hit proxy remains the sole pointer target for cloned back-page controls. Its source is resolved by logical sheet index, not by an array position that assumes every sheet is mounted.

## Navigation

The existing timeline becomes a volume selector. It displays the four current-month books and historical month books, with the selected volume marked active. TOC volume rows dispatch `selectVolume` rather than trying to jump into an unmounted page. `selectVolume` resets the logical page to the selected book's cover and rebuilds only that book's window.

## Plugin live data

Extend the Web plugin host with an optional `loadLive` contribution. The bundled screen-time Web module keeps its full `load` for book rebuilds and exposes `loadLive` for today's screen data only. This avoids re-requesting rules/settings/provider metadata during every live tick while keeping the visible current screen page fresh.

## README and verification

README describes the shipped Web volume behavior and plugin host contract, not a planned roadmap. Browser verification records logical sheet count, mounted sheet count, request URLs over two polling cycles, and one-step navigation responsiveness. Unit tests cover volume boundaries, selection, bounded sheet materialization, and live polling behavior.
