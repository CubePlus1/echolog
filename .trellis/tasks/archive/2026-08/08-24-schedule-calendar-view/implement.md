# Schedule calendar views implementation plan

1. Web agent reads the frozen parent/child contracts and owns only
   `plugins/schedule/web/**` plus `tests/schedule-web.test.ts`.
2. Implement one load source and pure range/group/render helpers for month,
   week, and day faces; add create and explicit transition actions.
3. Test grouping, escaping, canonical request bodies, expectedVersion,
   ignore/no-write semantics, stylesheet lifecycle, and unavailable cleanup.
4. Main agent registers the static asset root after the Web agent finishes and
   runs Web host plus full integration validation.
