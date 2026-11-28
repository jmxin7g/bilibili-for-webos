# Bilibili Accelerator core

Imported from https://github.com/realzza/bilibili-accelerator, commit
`a74ec390c203560a16584aeecb8d081a10db7f59` (v0.5.1), on 2026-10-14.

- `routing.cjs`: unchanged `src/core/routing.js`.
- `rewrite.cjs`: unchanged `src/core/rewrite.js`; used for its candidate pool.
- `LICENSE`: original MIT license and copyright notice.

The `.cjs` extension makes the original CommonJS export work within this ESM
application. The webOS transport adapter is `../../media-routing.mjs`.
Browser request hooks, settings, UI and WebRTC changes are not imported.
