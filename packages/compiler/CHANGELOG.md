# @markopack/compiler

## 0.2.1

## 0.2.0

### Minor Changes

- 77c3491: SSR asset injection (linkAssets) for page CSS and hydration scripts.

  Server-rendered pages now emit their browser chunks: hashed CSS `<link>` tags at the start of `<head>` and hydration `<script type="module">` tags before the hydration bootstrap — bringing markopack to parity with `@marko/vite`.

  - `marko-loader` recognizes `?server-entry` / `?browser-entry` resource queries and compiles those modules with `entry: "page"` + `linkAssets` instrumentation (hydrate output's virtual dependencies are materialized under `node_modules/.cache/markopack/virtual`)
  - `MarkoRspackPlugin` discovers page browser entries from the server compile, feeds them into the browser compiler as dynamic entries, and sequences the MultiCompiler so the browser build only starts after the server one
  - `@markopack/rspack` builds the page→assets manifest and injects it into the emitted server bundle; in dev the manifest is kept live as browser chunks are re-emitted
  - codegen fix: data passed to `next(data)` in handlers now reaches the page render context (`$global.data`)

  Also: dynamic entry names are sanitized so emitted chunks never start with `.` (e.g. `.marko-run_x.js` → `marko-run_x.js`), and `@markopack/rspack` accepts a `rspack(config, side)` callback option for per-compiler config tweaks.

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
