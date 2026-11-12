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

### Measured (2026-11-11, pdflux `pnpm build`, post-implementation)

All four criteria pass, with headroom:

- Guide page entry JS: **282 bytes** (was 127 KB); per-guide CSS **8.4 KB**
  delta (was a 220 KB byte-identical copy ×16). Site-wide `static/js`:
  **640 KB total** (was 3.4 MB) — 5.3×.
- `marko-runtime.fbbbc089.js` (55 KB) appears once as a named initial chunk —
  the cacheGroup pin is visible in the output.
- Landing payload (incl. xgplayer) lives in shared chunks; `index`/`en`
  entries are 1.0 KB page shells. `/` and `/en` no longer duplicate it.
- Second-route navigation (e.g. `/` → `/guide/…`) downloads the 282-byte
  entry + tiny CSS delta; every shared chunk is cached from the first visit.

### Post-acceptance cross-check (2026-11-11, full-site comparison vs Gatsby)

One remaining wart, found while comparing the whole deployable artifact
against the live Gatsby original (method: `webpack.stats.json` on
pdflux.com byte-verified against the CDN `webpack-runtime` `a.u` chunk
map — the full 21-JS + 1-CSS deployment inventory, no network-capture
guessing):

- **Per-entry CSS is still duplicated when byte-identical.** The 16 real
  guide pages each emit a `guide_*.css` of 8,405 B with the *same*
  contenthash (`91fba42a`) but distinct filenames — md5-verified 16/17
  byte-identical (the 17th is the `/guide` redirect page). #15 removed
  the entry-level duplication; identical per-entry CSS could be emitted
  once and referenced by every entry sharing it (~127 KB raw / 36 KB gz
  saved). Polish item, not a blocker.

### sharedCss recipe — resolved with a companion fix (2026-11-12)

Resolution of the wart above. The recipe works mechanically (34 → 10 CSS
files, zero md5-duplicated groups) but the first attempt on pdflux found
**two real cascade regressions** in Playwright computed-style A/B, both
rooted in the site depending on cross-chunk load order (bootstrap →
reset → page CSS), which splitChunks re-partitioning does not preserve:

1. `reset.scss` extracted into the shared chunk landed *before* the
   bootstrap vendor chunk → `body { line-height: 1.666 }` overridden by
   bootstrap's 1.5 (header/nav computed line-height 26.656 → 24 px).
2. Excluding `reset.scss` via `test` pushed it to the *end* of the link
   order → `.default-btn { display: inline-block }` (same specificity as
   `.download-mobile { display: none }`, pure order tie-break) overrode
   it — the mobile-download button became visible on desktop.

**The fix that makes the recipe applicable**: merge bootstrap + reset
into a **single CSS module** (`src/styles/base.scss` — note dart-sass
passes `@import "x.css"` with extension through as a plain-CSS
`@import url()`, so bootstrap must be compiled from
`bootstrap/scss/bootstrap`), import it from every page *and* the guide
theme's `mp-layout.marko`, and re-add the `sharedCss` cacheGroup. Module-
internal order is then structurally guaranteed, and the extracted base
chunk consistently lands first in the link order.

Verified result: CSS 25 → 9 files (480 KB → 328 KB raw, 93 KB → 51 KB
gz, −45%), deployable JS+CSS 1,012 KB/257 KB → 860 KB/215 KB gz; Playwright
computed styles zero-diff across 7 pages / 64 element samples (both
regression canaries pass). First-visit CSS per route is unchanged (the
base chunk must load anyway) — the win is cross-page caching (15 guide
pages no longer each carry an identical 8.4 KB copy) and deploy weight.

**Takeaway for other markopack sites**: order-significant override
stylesheets (reset-style files) must be merged into the same module as
the stylesheet they override before splitChunks grouping is safe.

Context from the same comparison: deployable JS+CSS is now 2,488 KB raw /
737 KB gz across 22 files (Gatsby live) vs 1,036 KB / 263 KB gz across 59
files (markopack); first-visit totals favor markopack 2.0–8.4× per route
and cross-route deltas 1.2–100× (`/guide/charge` 21.2 vs 17.2 KB gz,
`/apidocs` 295.0 vs 2.9 KB gz). Full tables: `pai-websites/docs/pdflux-analysis.md` §3.6.

## Downstream recipe — shared CSS (self-serve, pending promotion to default)

Why `splitChunks: { chunks: 'all' }` alone didn't dedupe the remaining
8.4 KB: rspack's production default `minSize: 20000` rejects split
candidates below 20 KB, so shared CSS modules smaller than that stay in
every entry (byte-identical copies, distinct `[name]`-derived filenames).
The `marko-runtime` pin deduped its CSS only by ride-along (css follows
the js module graph), not by selecting css modules itself. A site can fix
this locally today — no markopack change needed — with its own cacheGroup:

```js
// rspack.config.mjs (site root) — object form deep-merges cacheGroups
// per key, so the managed `marko-runtime` group is untouched.
export default {
  optimization: {
    splitChunks: {
      cacheGroups: {
        sharedCss: {
          type: /^css(?:\/|$)/, // 'css' alone misses css/module + css/auto
          chunks: "all",
          minChunks: 2,
          minSize: 0, // per-group override; global js minSize unaffected
          priority: 10, // above default (-20) / defaultVendors (-10)
          // No `name`, no `enforce`: a fixed name merges unrelated shared
          // css into one chunk (pages fetch styles they don't need) and
          // enforce bypasses maxInitialRequests.
        },
      },
    },
  },
};
```

Per-entry manifests pick the shared `.chunk.css` up automatically
(asset collection walks `entrypoint.chunks`). Verify with a
duplicate-content scan over `dist/static/css` (expect zero groups >1)
plus a cascade spot-check: splitChunks does not guarantee css import
order — if a page's style priority changes, raise `minChunks` or scope
`test` rather than reaching for `enforce`. Full rollback is the existing
`optimization.splitChunks = false` opt-out.

Promotion criterion: if pdflux validates dedup + cascade (the numbers
above suggest ~127 KB raw / 36 KB gz saved), upstream adds this
cacheGroup to the generated config as a **tunable default, not a managed
invariant** — removing it can only cost payload, never hydration, so the
guard stays limited to `marko-runtime`. Until then this section is the
of-record recipe for downstream sites.

