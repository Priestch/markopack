# @markopack/adapter-static

## 0.4.0

### Minor Changes

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

### Patch Changes

- 1818cdb: Require @marko/run ^0.11.14 (peer dependency floor)

  The generated code assumes the 0.11.14 runtime: client-disconnect render
  abort, same-origin-referer context.back(), //-path origin handling, the
  deferred response head, and the lazy router facade all shipped there.
  Users resolving 0.11.0–0.11.13 against the previous ^0.11.0 floor got
  silently broken behavior. The peer range now starts at ^0.11.14 to fail
  installation instead of failing at runtime.

- Updated dependencies [1818cdb]
  - @markopack/core@0.4.0

## 0.3.3

### Patch Changes

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

## 0.3.2

### Patch Changes

- @markopack/core@0.3.2

## 0.3.1

### Patch Changes

- @markopack/core@0.3.1

## 0.3.0

### Patch Changes

- 5887a9a: Fix static crawler OOM on large sites: cap concurrent visits at 100 and deduplicate the start queue

  Upstream's crawler fired every queued path at once (`startPaths.map(visit)` plus every link discovered mid-flight) with no concurrency cap, so peak memory scaled with concurrent visits × per-render cost — quadratic on nav-heavy sites, OOM-ing past ~2500 routes. The start queue was also not deduplicated (`seen` only guarded link discovery), so overlapping entries each spawned their own visit.

  The promise-wave queue is now a path queue drained by a bounded worker pool (100), duplicate start paths collapse before seeding, and the first visit error propagates after in-flight visits settle (upstream's `Promise.all` abandoned the rest unobserved). `visit()` also awaits `finished(pageWriter)` to match upstream 2.0.10, so `crawl()` no longer resolves while page files are still flushing.

  Validated on a 5003-route site with a full nav on every page: all routes crawled exactly once, ~4.3 GB peak (previously OOM at 4 GB and 8 GB heaps). Unit-tested in `npm run test:crawler` (concurrency cap, dedup, link/redirect discovery, error propagation).

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
