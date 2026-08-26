# Design

Treat the first-page snapshot as an authoritative refresh of the leading window,
not an instruction to discard already loaded tail pages. Track whether pagination
has expanded the delivery window. While expanded, merge first-page snapshots by
ID: use the server's newest first-page order and values, then retain older cached
rows absent from that page. Keep the pagination cursor from the expanded window;
do not regress it to the first-page cursor. A fresh activation/unmount resets the
expanded state normally.

The merge helper is shared by full load and live load so Host refresh and polling
cannot diverge. Tests must render after the real action refresh path and after a
later live snapshot.
