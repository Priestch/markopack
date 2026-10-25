# @markopack/rspack

## 0.4.0

### Minor Changes

- 7339654: Expose the actual listening port on the dev server handle

  `dev()` resolves to a `DevServer` that until now only had `close()`. The
  requested port is a hint — the server bumps it when taken — so callers
  (that is: test harnesses spawning dev servers at `port: 0`) had to guess.
  The handle now carries `port` with the actual bound port (0 in pure-Marko
  mode, where the user entry owns the port). Powering the new fixture-test
  workspace (`test/`, `pnpm run test:fixtures`).

- 1818cdb: Write routes.d.ts in dev mode too

  The generated route types were only written by production builds — under
  `dev()` the file appeared only if a build had run before, leaving editors
  without route types (and `GlobalDefineHandler` overloads) during pure-dev
  work. Upstream writes them whenever routes are generated; markopack now
  does the same: `dev()` writes `.marko-run/routes.d.ts` at startup, and
  the route watcher rewrites it after every clean re-walk. Build behavior
  is unchanged.

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

- 7c2b60d: Add a <root>/public/ convention for static assets (Vite publicDir semantics)

  Projects can now ship source static assets from a `public/` directory at
  the app root. In dev, they are served as a sirv pass in the chain
  `clientDist → public → router` — the public sirv is lazily initialized per
  request, so assets may appear mid-session (e.g. the markopress image
  pipeline writing on first render). The router fallback stays last so
  dot-path routes (`/sitemap.xml`) are never swallowed by static lookup.
  In static builds, `buildEnd` copies `public/` into the output after
  removing `outDir` and before merging the client bundle — built artifacts
  win over source assets, same precedence as Vite. Previously markopack had
  no public concept at all; this is the groundwork for site assets like
  robots.txt and favicons.

- Serve and ship a project `public/` directory (Vite `publicDir` convention)

  markopack had no notion of a public directory: dev served static assets
  from the compiled client output only, and static builds shipped exactly
  what the build produced. Projects now get the standard `public/`
  convention at the root:

  - dev: extension-suffixed URLs fall through client assets to
    `<root>/public` (sirv, lazily initialized so assets can appear
    mid-session) before reaching the router.
  - static adapter: `buildEnd` copies `<root>/public` into the output root
    before crawled pages and client assets are merged, so build outputs
    win on collision (same semantics as Vite).

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

- b470fd7: Stop deleting \_\_fallback_index.html on route re-walk

  The dev route re-walk's stale-file cleanup treated `__fallback_index.html`
  as a generated artifact and deleted it — but the fallback is written once
  at config time as the `HtmlRspackPlugin` template and is never in `keep`,
  so the first route add/remove during dev destroyed the HTML template
  mid-session (re-walk → `HtmlRspackPlugin` read error). The generated-file
  pattern now covers only per-route entries and page templates; the fallback
  and everything else in `.marko-run/` (e.g. `routes.d.ts`) is left alone.

- e081d12: Serve @marko/run/router through the runtime facade in dev

  In dev, server-side imports of `@marko/run/router` (middleware, handlers,
  app code) now resolve to @marko/run's router facade, which defers to the
  `__marko_run__` global instead of statically importing the generated
  router — matching upstream. App code reachable from middleware can no
  longer create an evaluation cycle with the generated router, which
  imports that code back through its routes; request-time match()/fetch()/
  invoke() calls behave identically (verified by the basic-handler fixture
  in both dev and preview modes). Production builds keep the direct alias.

- 1818cdb: Require @marko/run ^0.11.14 (peer dependency floor)

  The generated code assumes the 0.11.14 runtime: client-disconnect render
  abort, same-origin-referer context.back(), //-path origin handling, the
  deferred response head, and the lazy router facade all shipped there.
  Users resolving 0.11.0–0.11.13 against the previous ^0.11.0 floor got
  silently broken behavior. The peer range now starts at ^0.11.14 to fail
  installation instead of failing at runtime.

- Updated dependencies
- Updated dependencies [2018544]
- Updated dependencies [1818cdb]
- Updated dependencies [fb317b6]
  - @markopack/compiler@0.4.0
  - @markopack/core@0.4.0

## 0.3.3

### Patch Changes

- f807958: Fix broken asset references in the fallback HTML

  The fallback `index.html` injected `<script>`/`<link>` tags for every
  entry the browser compiler saw, including the per-page entries
  (`about_l24j`, `marko-run_Qime`, …) that MarkoRspackPlugin merges in.
  Two problems: pages with nothing to hydrate compile to a 0-byte browser
  chunk that the plugin then deletes, leaving script tags that 404; and
  the remaining entries' JS/CSS were eagerly loaded on every page when
  they belong to the runtime's per-route loading. The fallback HTML now
  references only the `index` bootstrap entry — page assets are loaded
  per-route through the link-assets manifest, as before. This also
  removes the duplicate stylesheet (identical content, two `<link>`s)
  that showed up on the index page.

- f807958: Warn instead of silently swallowing recoverable build errors

  - `@markopack/rspack`: when handler verb detection fails to read a
    handler file (ENOENT race, permissions), the route silently matched
    no HTTP method and 404ed with no trace of why — it now logs a warning
    naming the file.
  - `@markopack/adapter-static`: a failed copy of the browser `client/`
    output into the crawled `public/` directory used to vanish entirely,
    leaving pages referencing `/static/...` assets that 404ed (a missing
    `client/` dir from a routes-only build stays silent); a failed
    cleanup of the built server entry now reports itself too.
  - @markopack/core@0.3.3
  - @markopack/compiler@0.3.3

## 0.3.2

### Patch Changes

- 4ce0169: Fix dev-server asset serving for query-suffixed URLs

  The dev server routed extension-suffixed URLs to sirv (static assets)
  by testing the extension regex against the raw request URL. Asset URLs
  carrying a query string (`/static/css/index.css?v=…`) end with the
  query parameter, not the extension, so they fell through to the router
  and 404ed. The check now runs against the parsed pathname, so
  query-suffixed assets serve from `dist/client` again. Static misses
  still fall through to the router, keeping dot-path handler routes
  (e.g. `/sitemap.xml`, expressed as `sitemap`.`xml` in the routes dir)
  working — both cases are now covered by `npm run test:routes`.

  - @markopack/core@0.3.2
  - @markopack/compiler@0.3.2

## 0.3.1

### Patch Changes

- 4ba7622: Clean dist on production builds

  `output.clean` is now enabled for both compilers in production mode
  (web cleans `dist/client`, node cleans `dist/server`, each its own
  output path). Previously every rebuild left another wave of orphaned
  contenthash chunks accumulating in dist. Dev builds keep their output
  unchanged. Files adapters write after the compile (e.g. adapter-static's
  crawled `server/public`) are regenerated by `buildEnd` after cleaning,
  so they are unaffected.

  - @markopack/core@0.3.1
  - @markopack/compiler@0.3.1

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
