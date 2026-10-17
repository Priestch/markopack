# @markopack/core

## 0.3.3

## 0.3.2

## 0.3.1

## 0.3.0

### Patch Changes

- 939d286: Tree-kill spawned dev processes

  `spawnServer` shells out (`shell: true`), so a plain `proc.kill()` only
  signalled the shell — its children (the actual dev server) survived as
  orphans. The child now gets its own process group (`detached` on unix)
  and `close()` delegates to `closeSpawnedProcess`, which signals the whole
  group (SIGTERM, then SIGKILL).

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

## 0.2.1

### Patch Changes

- f6043a3: Sync route codegen with upstream @marko/run (0.11.14 era):

  - static route segments that arrive percent-encoded now match (`/a%20b`
    reaches the `a b` route); a malformed percent-escape is a clean 404
    instead of a thrown URIError
  - QUERY requests render the page like GET when a `+handler.ts` exports
    `QUERY` (completes RFC 9110 QUERY support started in the builder sync)
  - trailing-slash policy now applies in `invoke`, not only the generated
    fetch; route option merging no longer mutates shared middleware
    options; verb-specific middleware options are skipped for verbs they
    don't run on
  - generated route types use the new `Run` namespace (MarkoRun members
    marked deprecated) and carry a conventions cheat-sheet pointer for
    coding agents

## 0.2.0

### Minor Changes

- 77c3491: SSR asset injection (linkAssets) for page CSS and hydration scripts.

  Server-rendered pages now emit their browser chunks: hashed CSS `<link>` tags at the start of `<head>` and hydration `<script type="module">` tags before the hydration bootstrap — bringing markopack to parity with `@marko/vite`.

  - `marko-loader` recognizes `?server-entry` / `?browser-entry` resource queries and compiles those modules with `entry: "page"` + `linkAssets` instrumentation (hydrate output's virtual dependencies are materialized under `node_modules/.cache/markopack/virtual`)
  - `MarkoRspackPlugin` discovers page browser entries from the server compile, feeds them into the browser compiler as dynamic entries, and sequences the MultiCompiler so the browser build only starts after the server one
  - `@markopack/rspack` builds the page→assets manifest and injects it into the emitted server bundle; in dev the manifest is kept live as browser chunks are re-emitted
  - codegen fix: data passed to `next(data)` in handlers now reaches the page render context (`$global.data`)

  Also: dynamic entry names are sanitized so emitted chunks never start with `.` (e.g. `.marko-run_x.js` → `marko-run_x.js`), and `@markopack/rspack` accepts a `rspack(config, side)` callback option for per-compiler config tweaks.

- 77c3491: Remove the last Vite dependencies: `@markopack/core`'s `vite/*` subpath exports are renamed (`@markopack/core/vite/types` → `@markopack/core/types`, etc.), the `Adapter` interface drops the Vite-shaped `plugins`/`viteConfig` hooks, and no markopack package depends on `vite` or `@marko/vite` anymore.

## 0.1.5

## 0.1.4

### Patch Changes

- c1cd7bd: Fix layout template escape and update Marko to 6.x

## 0.1.3

### Patch Changes

- 8509201: Fix layout template to use input.content and improve install progress spinner

## 0.1.2

### Patch Changes

- 02e0fbf: Fix ESM imports and improve CLI progress feedback
