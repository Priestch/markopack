# @markopack/adapter-static

## 0.2.2

### Patch Changes

- 0e2f931: Decouple adapters from `@marko/run/adapter`

  The adapters no longer import the upstream base adapter, whose module graph
  pulls in Vite (`vite`, `@marko/vite`, `rolldown`, …) at config-load time —
  ~320ms and several MB — while nothing it provided was reachable under
  markopack: `startDev` would boot a Vite dev server (markopack drives dev via
  Rspack) and was never called, and the node adapter's inherited
  `getEntryFile`/`startPreview` had no callers either. `closeSpawnedProcess`
  (tree-killing process close, used by adapter-netlify's preview) now lives in
  `@markopack/core/utils/server`, and adapter-netlify declares its
  `@markopack/core` dependency explicitly.

- Updated dependencies [0e2f931]
  - @markopack/core@0.2.2

## 0.2.1

### Patch Changes

- 61e3204: Sync adapters with upstream @marko/run:

  - adapter-static preview: the 404 page now really answers 404 — sirv's
    `send` ends with an unconditional `writeHead(200)` that discarded the
    status set from `setHeaders`; a `forceStatus` wrapper pins it
  - adapter-netlify: preview process shutdown uses the runtime's
    `closeSpawnedProcess` (SIGTERM → SIGKILL tree kill) instead of a bare
    `kill()`; `spawn` no longer passes an args array alongside `shell: true`
    (Node DEP0190); edge function config uses the declarative
    `path`/`excludedPath` API, excluding `/static/*` (markopack's asset
    prefix) instead of a dotted-path regex

- bcf6fcd: Fix static exports missing browser assets: crawled pages now land in `public/`
  alongside the client bundle's JS/CSS (previously `/static/...` references 404'd
  on hydrated pages), stale files from earlier builds are cleaned before
  crawling, and a route that fails to render now fails the build instead of
  being silently left out. Crawler synced with upstream @marko/run (relative
  link resolution, redirect handling, rel token matching).
- Updated dependencies [f6043a3]
  - @markopack/core@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies [77c3491]
- Updated dependencies [77c3491]
  - @markopack/core@0.2.0

## 0.1.5

### Patch Changes

- 035318b: Fix CJS module interop in static adapter's buildEnd: dynamic `import()` of a CJS bundle wraps exports under `.default`, so `fetch` was undefined. Now falls back to `mod.default?.fetch`.
  - @markopack/core@0.1.5

## 0.1.4

### Patch Changes

- c1cd7bd: Fix layout template escape and update Marko to 6.x
- Updated dependencies [c1cd7bd]
  - @markopack/core@0.1.4

## 0.1.3

### Patch Changes

- 8509201: Fix layout template to use input.content and improve install progress spinner
- Updated dependencies [8509201]
  - @markopack/core@0.1.3

## 0.1.2

### Patch Changes

- 02e0fbf: Fix ESM imports and improve CLI progress feedback
- Updated dependencies [02e0fbf]
  - @markopack/core@0.1.2
