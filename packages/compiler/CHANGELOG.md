# @markopack/compiler

## 0.4.0

### Minor Changes

- 2018544: Support Marko 6 lazy loading (`import X from "./x.marko" with { load: "idle" }`)

  - `@markopack/compiler`: the marko loader compiles lazily imported
    components with `entry: "load"` via the new `?load-entry` query, and
    records each one's ready id through a kind-aware `onAsset` registry
    (`__markopack_load_assets__`, separate from the page-asset registry so
    a file that is both keeps both ids). Relative imports in translator
    virtual modules (load-signal modules) are rewritten to absolute paths
    so they resolve from the flattened cache location.
  - `@markopack/compiler`: `MarkoRspackPlugin` discovers load entries from
    the registry during server compilation (filtered to modules present in
    the current build, so in-process multi-app builds can't cross-pollute),
    injects them as browser entries, and collects lazy-component css into
    a separate async bucket so pages don't eagerly link every lazy
    component's styles.
  - `@markopack/rspack`: the link-assets manifest gains entries keyed by
    ready id — `block` carries the component's stylesheet link, `defer`
    its load-entry script (`async`, since the trigger may fire long after
    parse). The browser build now uses `optimization: { runtimeChunk:
"single" }`: the ready handshake passes through module-level state in
    the dom runtime, so page entries and load entries must share one
    runtime instance instead of each inlining their own.

- fb317b6: Support `Run.href` in the browser

  `@marko/run`'s typed-link API (`Run.href("/products/$id", { params })`)
  only worked server-side under markopack: nothing defined `window.Run` in
  browser bundles, so client-side calls hit an undefined global. The
  `@marko/run` client runtime (which does `window.Run ||= { href }`) is now
  prepended to every browser entry — page entries and host entries alike —
  so hydrated code can call `Run.href` directly. The module is idempotent,
  so per-entry duplication is harmless. `virtual:marko-run/runtime/client`
  is also aliased now, matching upstream, for code that imports it
  explicitly. MarkoRspackPlugin gains a `browserEntryImports` option
  (modules prepended to every browser entry) which powers this.

### Patch Changes

- Import JS-referenced components into page browser entries so they hydrate

  The translator's `output: "hydrate"` entry compile only statically imports
  interactive components reachable through `.marko → .marko` imports. A
  component referenced by a plain JS module (e.g. a data module holding a
  component reference that a template renders via a dynamic tag) compiled
  fine server-side but never reached the browser graph — the resume payload
  referenced its template registration id, the module never executed, and
  hydration failed at runtime with `effects[i] is not a function`.

  The server compiler's entry discovery now diffs full-graph `.marko`
  reachability against the `.marko`-only closure per page entry and appends
  the difference to the browser entry's imports — ordered before the
  `?browser-entry` module, whose `init()` resolves template ids from the
  resume payload immediately. Lazy (`with { load: }`) components are
  excluded so their load entries keep working.

## 0.3.3

## 0.3.2

## 0.3.1

## 0.3.0

### Patch Changes

- 2f61bfe: Fix extracted `<style>` blocks end to end. compiler: pass `resolveVirtualDependency` for all compile outputs, not just hydrate, so styles materialize as virtual `.css`/`.scss` files instead of being silently dropped; materialized files keep their own extension. rspack: css rules now use rspack's native css modules (`type: "css/auto"`) with `output.cssFilename`/`cssChunkFilename` naming — the previous `javascript/auto` + plugin `filename` options emitted css next to js chunks under `static/js/` or failed to parse as JS; `.scss`-typed style blocks compile via sass-loader (new dependency).

## 0.2.2

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
