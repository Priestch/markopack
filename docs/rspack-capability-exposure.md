# Rspack capability exposure — feedback from the pdflux pilot

> **Status: implemented (2026-11-10).** Asks 1–4 shipped in `@markopack/rspack`
> (dev `proxy`/`headers`, object-form server-side merge, invariant guards +
> docs, `DefinePlugin` recipe). See `.changeset/rspack-capability-exposure.md`
> and `scripts/test-dev-proxy.mjs`. The design principle and verified facts
> below are retained as the rationale.

> Filed 2026-11-09 from the pai-websites replication pilot
> (paoding-officialweb, a 24-site Gatsby monorepo, being rebuilt on
> markopress/markopack; first site = pdflux, 9 routes). Scaffolding the real
> site hit the config surface in three places within a day. This doc states
> the design principle we'd propose, the facts as verified in source, and the
> concrete asks.

## Principle: expose by layering, not by raw merge

"Expose as much of rspack as possible" is the right *posture* for markopack —
it is the product's differentiator vs `@marko/run`'s Vite path. But as a
*mechanism*, "merge everything the user hands us" is wrong, because markopack
owns invariants a plain rspack config can silently break:

- **Dual-compiler coordination** — browser/server manifest sync via
  `MarkoRspackPlugin`; plugin-array surgery or output restructuring on one
  side desyncs hydration.
- **Managed entries** — routes are virtual modules; a user `entry`/splitChunks
  override fights the route watcher.
- **Hydrate emission ordering** — `?browser-entry` must run before
  `clientHydrateImports`; lazy components ride on this.
- **Dev server response wrapping** — SSE full-reload wraps `res.write`/
  `res.end`; user middleware must compose with it, not replace it.

The existing three layers are the right shape and should stay:

| Layer | Reach | Verified |
|---|---|---|
| `dev/build({ rspack: (config, side) => config })` | programmatic, per side, after file config | `index.ts:227` (`options.rspack?.(customized, side)`) |
| `rspack.config.*` function form `(config, side)` | per side, surgical | `index.ts:221-224` |
| `rspack.config.*` object form | **browser side only** (by design; comment at `index.ts:217-219`) | `index.ts:220-222` |

What's missing is (a) capabilities that live **outside the compiler config**,
(b) one asymmetry worth revisiting, (c) guard rails.

## Concrete asks (ordered by pilot impact)

### 1. `dev({ proxy })` — blocking gap

The dev server is hand-rolled (`http.createServer` at `dev.ts:171`), so a
`devServer` key in any config layer is dead config — the capability is simply
not reachable today. The pilot's `/blog` page fetches `/api/v1/blog` from the
product backend at runtime; the Gatsby original proxies it via
`developMiddleware` (http-proxy-middleware → test backend). Local development
of any site with runtime APIs needs the equivalent:

```js
dev({
  root, entry,
  proxy: { "/api/v1": { target: "https://pdflux.dev.cheftin.cn", changeOrigin: true } },
})
```

- Shape: same as rspack `devServer.proxy` (path → options/bypass/array), so
  rspack docs transfer.
- Must register **after/beside** the SSE-wrapped response handling (compose,
  not wrap the wrapper); proxy pass-through must not double-inject the reload
  script into proxied responses (skip injection for non-HTML or proxied
  content types).
- Build path unaffected (production is same-origin on the real domain).

### 2. Revisit the browser-only object merge for `module.rules`-class needs

SSR needs the same loaders on the server side (e.g. `less-loader`: the server
bundle must process `.less` imports or SSR renders unstyled HTML). Today the
object form silently skips the server side, which makes the "easy" form a trap
for exactly the most common customization. Options:

- merge `module.rules` (and a small allowlist of safe-to-merge keys) into both
  sides from the object form; or
- keep as-is but fail-fast warn when the object form contains keys that only
  make sense server-side (`module.rules` with non-`type: 'asset'` rules …) —
  too clever; prefer the first;
- or minimally: document the trap at the top of the object-form JSDoc and in
  the README table.

### 3. Document + guard the managed invariants

A short "do not touch" list in the README (entries, plugin array order around
`MarkoRspackPlugin`, `output` structure, `resolve.conditions` for the Marko
compiler), plus cheap runtime guards in `customize()`/`withMarkoPlugin()`:
if user config replaces `entry` or removes the Marko plugin, fail with a
pointer to this list instead of a mysterious hydration desync at runtime.

### 4. (nice to have) `dev({ headers })` and a documented `define` recipe

Pilot sites inject env (`GATSBY_*`-equivalents) via `builtins.define` through
the function form today; a one-paragraph README recipe ("environment
variables in markopack") would remove the guesswork. Same for shared headers
on static assets (CDN cache headers parity with source deploys).

## Acceptance (from the pilot)

pdflux on markopack with: `.less` processed on **both** sides via the object
form (or a documented two-line function form), `/api/v1` proxied in dev,
production build byte-equivalent to today's. Then the pilot's remaining
markopack blocker list is empty.

**Result:** object-form rules now merge into the server config too (CSS rules
rewritten to `asset/source` there); `/api/v1`-style proxying verified
end-to-end in `scripts/test-dev-proxy.mjs`. On the example's production
build, 31/32 output files are hash-identical; the server bundle is
byte-identical apart from `__MARKO_MANIFEST__` JSON key order (the new
server-side rule changes rspack's module traversal order) — the manifest
itself is equal as an object. All 10 verification scripts pass.
