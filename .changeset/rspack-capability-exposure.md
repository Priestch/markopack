---
"@markopack/rspack": minor
---

Expose more of rspack's capability surface through markopack:

- `dev({ proxy })` — reverse proxy for runtime APIs, in the familiar Vite `server.proxy` object form (`{ "/api/v1": { target, changeOrigin, bypass, ... } }`). Proxied responses are passed through untouched: the SSE full-reload client is injected only into router-served HTML. WebSocket upgrades and segment-boundary prefix matching are supported.
- `dev({ headers })` — default response headers applied to static, router, and proxied responses.
- `rspack.config.*` object exports now merge their safe subset (`module`, `resolve`, `devtool`, `stats`) into the **server config too**, so one loader rule (e.g. `less-loader`/`sass-loader`) serves SSR and hydration. CSS rules are rewritten to `asset/source` on the server side; `resolve.alias` object-merges instead of dropping generated route aliases. Keys outside the subset still apply to the browser only and now warn.
- Managed invariants (`entry`, `MarkoRspackPlugin`) are guarded with fail-fast errors pointing at the new "Managed invariants" README section.
- Documented the `DefinePlugin` recipe for environment variables and a `test:dev-proxy` regression script.
