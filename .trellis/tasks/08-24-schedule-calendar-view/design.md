# Schedule calendar views design

The plugin exports `activate({ api, refresh, root })`. Activation adds one
plugin stylesheet and returns a contribution with `load`, `faces`,
`renderFace`, `handleAction`, and `unmount`.

`load` calculates a bounded current window and requests the canonical item
range once. Month/week/day faces filter and group that normalized item array;
they never write a second model. Controls carry action and item id. The handler
resolves the current item from loaded data so every mutation sends its latest
`version` as `expectedVersion`, then lets the host refresh the book.

The module uses host escaping helpers for render values and `textContent` for
inline errors. It injects a `<link>` for `/plugins/schedule/styles.css` and
removes only that owned element on unmount.
