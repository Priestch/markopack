# Cross-entry shared chunks — feedback from the pdflux pilot

> **Status: implemented (2026-11-11).** Asks 1–3 shipped in `@markopack/rspack`:
> default `splitChunks: { chunks: 'all' }`, the pinned `marko-runtime`
> cacheGroup, per-key deep-merge of `optimization.splitChunks.cacheGroups`
> in the object form, and a fail-fast managed-invariant guard (explicit
> opt-out: `optimization.splitChunks = false`). Ask 3 was widened one
> notch beyond "opt-out only": thresholds and cacheGroup additions are
> also exposed, because the guard makes the invariant structural rather
> than dependent on user restraint. Ask 4 (dedicated regression example)
> is still open — meanwhile covered by the existing verify scripts.
> Acceptance numbers to be re-measured on pdflux.
>
> Origin: filed 2026-11-11 from the pai-websites replication pilot
> (paoding-officialweb, a 24-site Gatsby monorepo being rebuilt on
> markopress/markopack; first site = pdflux, 9 routes / 24 built pages).

## The problem, measured on the real site

The pdflux production build emits one **self-contained chunk per route
entry**: nothing is shared between entries except the rspack runtime. Numbers
from `pnpm build` (raw / gzip-9):

| Route | Entry chunk | Notes |
|---|---|---|
| `/` | 458 KB / 134.7 KB | marko runtime + xgplayer + all landing components |
| `/en` | 454 KB / 133.9 KB | ~the entire landing payload shipped **a second time** — the two pages share ~99% of their modules |
| `/guide/*` ×16 | 127 KB / 44.9 KB each | sizes within ±5 bytes of each other |
| `/log` | 96 KB / 32.1 KB | |
| `/blog` | 88 KB / 30.6 KB | |
| `/apidocs` | 54 KB / 17.6 KB | |

The strongest evidence is the CSS: the 16 guide pages each get a stylesheet
with the **same contenthash** (`guide_*.4beae23f.css`, 220 KB raw / 29.4 KB gz
each) — byte-identical bootstrap+theme+guide-content shipped sixteen times.
Total `static/js` for the site is 3.4 MB where the Gatsby original deploys
~1 MB for the same pages.

First-visit totals still favor markopack ~2–3× over the Gatsby original
(pdflux.com measured: landing 985 KB raw / 317 KB gz across 11 files vs ours
477 KB / 137 KB across 2). But **cross-route navigation** inverts the story:
on Gatsby the framework/app/shared chunks are cached, so landing → guide adds
4.3 KB; on markopack every route downloads a full self-contained entry
(127 KB / 44.9 KB gz for a guide page). Content sites live on multi-page
browsing — this is the wrong default for them.

## Verified facts (markopack source, 2026-11-11)

- `packages/rspack/src/config.ts:229` — `optimization: { runtimeChunk:
  "single" }` and nothing else. Rspack's production default is
  `splitChunks: { chunks: 'async' }` (webpack parity), which never extracts
  modules shared across **initial** entries. Page entries statically import
  their component trees, so shared modules (marko runtime, theme deps,
  site-common components, vendor libs) are copied into every entry.
- `packages/compiler/src/MarkoRspackPlugin.ts:424-463` — per-entry asset
  collection walks `entrypoint.chunks`, i.e. the entrypoint's full initial
  chunk list. A split chunk an entry depends on would **already** land in
  that entry's manifest with no manifest-side changes.
- `packages/rspack/src/link-assets.ts:53` — page scripts emit as
  `<script type="module">`; ESM chunk imports make execution order safe with
  extra shared chunks.
- The `runtimeChunk: "single"` comment (config.ts:223-228) documents the
  deeper invariant: the dom runtime's `ready()` handshake keeps `readyIds` in
  module-level state, and page entries + lazy load-entries must hydrate
  against the **same runtime module instance**.

## The invariant any fix must keep

`@marko/runtime-tags` (the dom runtime: `ready()`/`readyIds`) must resolve to
exactly **one module instance per page load**. Today that holds by accident —
each page has a single initial entry, so its one embedded copy is the only
one. Naively flipping `chunks: 'all'` could split runtime-tags differently
between an initial shared chunk and an async (load-entry) chunk per page —
the same class of breakage the `runtimeChunk` comment guards against, one
level up.

## Asks

1. **Default `splitChunks: { chunks: 'all' }`** so modules shared by ≥2
   entries extract once (rspack's default `minSize`/`minChunks` thresholds
   keep tiny sites from sprouting single-module chunks). Watch
   `maxInitialRequests` headroom for the module-script pattern.
2. **Pin the marko runtime into one named initial chunk** via a cacheGroup
   (`test: /[\\/]@marko[\\/]runtime-tags[\\/]/`, `name: 'marko-runtime'`,
   `chunks: 'all'`, `enforce: true`) — makes the single-instance invariant
   structural instead of accidental. CSS ride-along is fine: the css
   experiment follows the js module graph, so this also deduplicates the
   sixteen identical guide stylesheets.
3. **Keep it markopack-owned, not a user-merge key** (layering principle from
   `rspack-capability-exposure.md`): a raw user `splitChunks` override can
   violate the ready() invariant silently. If exposure is ever wanted, allow
   `splitChunks: false` (opt-out) only.
4. **Regression coverage**: an example app with two pages sharing a
   component plus one `<load>`-lazy component, asserting (a) the shared
   module's bytes appear once across page entries, (b) lazy hydration still
   completes (ready handshake across initial + async chunks), (c) both
   pages' manifests list the shared chunk.

## Acceptance (re-run on pdflux when implemented)

- Guide pages: page entry ≤ ~30 KB + one shared chunk; the 16 identical
  stylesheets collapse to a shared stylesheet + per-page deltas.
- `/` and `/en` share the landing payload (xgplayer etc. downloaded once).
- First-visit totals no worse than today; second-route navigation downloads
  the page delta only.
