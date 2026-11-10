---
"@markopack/rspack": minor
---

Extract cross-entry shared chunks by default (from the pdflux pilot feedback, `docs/cross-entry-shared-chunks.md`):

- Browser builds now set `optimization.splitChunks = { chunks: "all" }`. Previously every route entry was self-contained: rspack's default `chunks: "async"` never extracts modules shared across *initial* entries, so the marko runtime, theme deps and site-common components were copied into every entry — measured as 16 byte-identical 220 KB stylesheets on the pilot site, and a full landing-payload re-download on every cross-route navigation. Shared modules now extract once; second-route visits download the page delta only.
- `@marko/runtime-tags` is pinned into one named initial chunk (`marko-runtime` cacheGroup, `enforce: true`, `priority: 10`), making the ready()/readyIds single-instance invariant structural instead of accidental — without the pin, `chunks: "all"` could duplicate the runtime between an initial shared chunk and an async load-entry chunk and break lazy hydration silently.
- `optimization.splitChunks.cacheGroups` now deep-merges per key in object-form `rspack.config.*` (like `resolve.alias`), so tuning thresholds or adding vendor groups can't drop the managed group.
- New managed-invariant guards fail fast when a config layer changes `optimization.runtimeChunk` or modifies/drops the `marko-runtime` cacheGroup, with a pointer to the README's "Managed invariants" section. Explicit opt-out: `optimization.splitChunks = false` returns to self-contained entries.
