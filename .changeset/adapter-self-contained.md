---
"@markopack/core": patch
"@markopack/adapter-node": patch
"@markopack/adapter-static": patch
"@markopack/adapter-netlify": patch
---

Decouple adapters from `@marko/run/adapter`

The adapters no longer import the upstream base adapter, whose module graph
pulls in Vite (`vite`, `@marko/vite`, `rolldown`, …) at config-load time —
~320ms and several MB — while nothing it provided was reachable under
markopack: `startDev` would boot a Vite dev server (markopack drives dev via
Rspack) and was never called, and the node adapter's inherited
`getEntryFile`/`startPreview` had no callers either. `closeSpawnedProcess`
(tree-killing process close, used by adapter-netlify's preview) now lives in
`@markopack/core/utils/server`, and adapter-netlify declares its
`@markopack/core` dependency explicitly.
