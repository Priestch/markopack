# @markopack/adapter-node

## 0.3.3

### Patch Changes

- @markopack/core@0.3.3

## 0.3.2

### Patch Changes

- @markopack/core@0.3.2

## 0.3.1

### Patch Changes

- @markopack/core@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies [939d286]
  - @markopack/core@0.3.0

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

- Updated dependencies [f6043a3]
  - @markopack/core@0.2.1

## 0.2.0

### Patch Changes

- 77c3491: Remove the last Vite dependencies: `@markopack/core`'s `vite/*` subpath exports are renamed (`@markopack/core/vite/types` → `@markopack/core/types`, etc.), the `Adapter` interface drops the Vite-shaped `plugins`/`viteConfig` hooks, and no markopack package depends on `vite` or `@marko/vite` anymore.
- Updated dependencies [77c3491]
- Updated dependencies [77c3491]
  - @markopack/core@0.2.0

## 0.1.5

### Patch Changes

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
