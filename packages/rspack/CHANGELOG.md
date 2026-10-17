# @markopack/rspack

## 0.3.0

### Minor Changes

- fb24dfc: dev: full-reload support — SSE channel `/__markopack_reload`, a reload client injected into the first HTML chunk served through the router, and a debounced reload broadcast whenever either compiler finishes a clean rebuild (plus a second broadcast after the server bundle is swapped in, so a reload never lands on a stale bundle).
- cac7947: Load an optional rspack.config.{ts,mts,cts,js,mjs,cjs} from the app root

  Apps can now define an rspack config file that merges with markopack's
  generated configs. An object export merges into the browser config —
  arrays (module.rules, plugins) concatenate with the generated ones,
  plain objects shallow-merge, everything else replaces. A function
  export receives every generated config, `(config, side) => config`,
  for per-side control (the programmatic `rspack` option from before
  still applies last).

  Preprocessor rules (sass, less, …) belong here rather than in
  markopack's defaults — `sass`/`sass-loader` are no longer dependencies
  of `@markopack/rspack`. The basic example demonstrates this: it adds
  its sass rule via `rspack.config.mjs` with app-local `sass` +
  `sass-loader` devDependencies.

### Patch Changes

- 6aca808: Fix component CSS extraction: enable experiments.css, wire configs to the app root

  The style-extraction rules shipped inert: `experiments.css` was never
  enabled (so `type: "css/auto"` was a no-op and no stylesheet was ever
  emitted), and the CssExtract loader in `use` is the legacy webpack path,
  not the experimental native-css one. Rules now use `type: "css"` with
  only lightningcss in `use`.

  Intra-workspace dependencies were also resolving to published npm
  tarballs instead of the workspace sources (semver ranges +
  `linkWorkspacePackages` lost to a lockfile pinned to registry tarballs),
  so local loader fixes silently never ran. All intra-repo deps are now
  `workspace:*`.

  Both generated configs set `context: root` — without it rspack anchored
  resolution to `process.cwd()`, making bare loader names and relative
  paths depend on where the build was launched from.

- fb24dfc: dev: extension-suffixed URLs that miss the static asset dir now fall through to the router instead of 404ing — required for dot-path routes (e.g. plugin-generated `/sitemap.xml`).
- 939d286: Fix build() hanging forever when post-compile steps throw; DevServer.close() now awaits shutdown

  `build()`'s `compiler.close` callback is async — an error thrown by the
  link-assets manifest injection or an adapter's `buildEnd` rejected that
  callback's promise unhandled, leaving the promise returned by `build()`
  unsettled: callers awaited it forever with only a stray unhandled-
  rejection warning. The callback now catches and rejects (verified: a
  throwing adapter rejects in <1s instead of hanging).

  `DevServer.close()` also awaited nothing after stopping the watcher —
  `server.close()` was fire-and-forget, and its callback only fires after
  keep-alive connections drain. It now destroys open connections
  (`closeAllConnections`) and awaits the server's close callback.

- 2f61bfe: Fix extracted `<style>` blocks end to end. compiler: pass `resolveVirtualDependency` for all compile outputs, not just hydrate, so styles materialize as virtual `.css`/`.scss` files instead of being silently dropped; materialized files keep their own extension. rspack: css rules now use rspack's native css modules (`type: "css/auto"`) with `output.cssFilename`/`cssChunkFilename` naming — the previous `javascript/auto` + plugin `filename` options emitted css next to js chunks under `static/js/` or failed to parse as JS; `.scss`-typed style blocks compile via sass-loader (new dependency).
- Updated dependencies [939d286]
- Updated dependencies [2f61bfe]
  - @markopack/core@0.3.0
  - @markopack/compiler@0.3.0

## 0.2.2

### Patch Changes

- 8eefd00: Clean stale generated files from `.marko-run/` on route discovery

  Every rebuild regenerates the route entries, page templates, and router in
  `.marko-run/`, but files whose source routes no longer exist were never
  removed — they accumulated forever (a probe route deleted days ago kept its
  generated files around). Discovery now deletes any generated-pattern file
  (`__marko-run__*`, `*.marko`, `__fallback_index.html`) that the current run
  didn't write; anything else in the directory is left untouched.

- f99ddb6: Detect handler verbs via AST instead of regex source scan

  Handler verb detection now parses the file and collects export identifiers
  (mirroring upstream's `getExportIdentifiers`), so `export { list as GET }`
  specifier aliases and `export const GET: Handler = ...` TS annotations are
  recognized — the old regex missed both shapes. It also stops matching verb
  names inside comments and strings: previously a mention of
  `export function DELETE(` in a comment registered DELETE on the route, and
  the generated router then imported a nonexistent export, failing the entire
  build. Unparseable sources fall back to the historical scan.

- ecf96d2: Ship real declaration files generated from source

  `@markopack/rspack`'s hand-written `index.d.ts` stub lagged the actual API:
  the `rspack` config-customization callback, `serverEntry`, and `routes`
  options were untyped, and `emitRoutes` took `any[]` instead of `Route[]`.
  Declarations are now emitted by `tsc` from the sources (which also type-
  checks them — esbuild alone never did, and five errors had accumulated).
  `DevServer` is exported as a type.

- Updated dependencies [0e2f931]
  - @markopack/core@0.2.2
  - @markopack/compiler@0.2.2

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

- 4677c27: Honor the value returned by an adapter's `pluginOptions()` hook: it is now
  merged back into the build options (matching @marko/run's contract) before
  `routesDir` / `trailingSlashes` are read, instead of being discarded.
- Updated dependencies [f6043a3]
  - @markopack/core@0.2.1
  - @markopack/compiler@0.2.1

## 0.2.0

### Minor Changes

- 77c3491: SSR asset injection (linkAssets) for page CSS and hydration scripts.

  Server-rendered pages now emit their browser chunks: hashed CSS `<link>` tags at the start of `<head>` and hydration `<script type="module">` tags before the hydration bootstrap — bringing markopack to parity with `@marko/vite`.

  - `marko-loader` recognizes `?server-entry` / `?browser-entry` resource queries and compiles those modules with `entry: "page"` + `linkAssets` instrumentation (hydrate output's virtual dependencies are materialized under `node_modules/.cache/markopack/virtual`)
  - `MarkoRspackPlugin` discovers page browser entries from the server compile, feeds them into the browser compiler as dynamic entries, and sequences the MultiCompiler so the browser build only starts after the server one
  - `@markopack/rspack` builds the page→assets manifest and injects it into the emitted server bundle; in dev the manifest is kept live as browser chunks are re-emitted
  - codegen fix: data passed to `next(data)` in handlers now reaches the page render context (`$global.data`)

  Also: dynamic entry names are sanitized so emitted chunks never start with `.` (e.g. `.marko-run_x.js` → `marko-run_x.js`), and `@markopack/rspack` accepts a `rspack(config, side)` callback option for per-compiler config tweaks.

### Patch Changes

- Updated dependencies [77c3491]
- Updated dependencies [77c3491]
  - @markopack/core@0.2.0
  - @markopack/compiler@0.2.0

## 0.1.5

### Patch Changes

- bd99702: Add missing dependencies: `sirv` in `@markopack/rspack` (used by dev server) and `@marko/runtime-tags` in create-markopack templates (required by Marko 6 compiled output).
  - @markopack/core@0.1.5
  - @markopack/compiler@0.1.5

## 0.1.4

### Patch Changes

- c1cd7bd: Fix layout template escape and update Marko to 6.x
- Updated dependencies [c1cd7bd]
  - @markopack/core@0.1.4
  - @markopack/compiler@0.1.4

## 0.1.3

### Patch Changes

- 8509201: Fix layout template to use input.content and improve install progress spinner
- Updated dependencies [8509201]
  - @markopack/core@0.1.3
  - @markopack/compiler@0.1.3

## 0.1.2

### Patch Changes

- 02e0fbf: Fix ESM imports and improve CLI progress feedback
- Updated dependencies [02e0fbf]
  - @markopack/core@0.1.2
  - @markopack/compiler@0.1.2
