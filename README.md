# markopack

**Rspack integration for [`@marko/run`](https://github.com/marko-js/run)** — build Marko SSR applications using raw Rspack with zero framework overhead.

## Overview

markopack lets you use Marko's file-based routing and SSR system with [Rspack](https://rspack.rs/) instead of Vite. Drop it into any Marko project and get the same route conventions, adapters, and hot reload you'd get from `@marko/run` — without Vite.

Requires Node `>=20.19.0 || >=22.12.0`.

## Quick Start

```bash
npm create markopack@latest
```

The CLI asks for a project name, adapter (`node`, `static`, or `netlify`), and whether to use TypeScript, then scaffolds and installs everything for you.

**Non-interactive:**

```bash
npm create markopack@latest my-app -- --adapter node --typescript
```

Once scaffolded:

```bash
cd my-app
npm run dev      # dev server: hot reload + hot route discovery
npm run build    # production build → dist/client + dist/server
npm run preview  # serve the production build locally
```

## How It Works

Every build produces two Rspack bundles coordinated by a **MultiCompiler**:

- **browser** (`dist/client/`) — DOM hydration bundle, compiled with `output: "dom"`
- **server** (`dist/server/`) — CJS SSR bundle, compiled with `output: "html"`

`MarkoRspackPlugin` syncs dynamic entry points and the client asset manifest between the two compilers. Routes are generated as virtual modules in `.marko-run/` at build time. In dev, server-bundle changes swap the server in place (browser reloads over SSE) and new route files are picked up without a restart.

Lazily loaded components — the [`load` import attribute](https://markojs.com/docs/reference/lazy-loading) — are supported: each lazy component gets its own load-entry chunk, and SSR output carries the trigger script plus the anti-FOUC stylesheet link so the component hydrates when its trigger fires.

## Project Setup

A markopack project is two small scripts around the `dev()` / `build()` APIs — this is all the scaffolding `create-markopack` generates:

```js
// dev.mjs
import { dev } from "@markopack/rspack";

dev({ root: import.meta.dirname, entry: "./src/index.ts" });
```

```js
// build.mjs
import { build } from "@markopack/rspack";

build({ root: import.meta.dirname, entry: "./src/index.ts", mode: "production" });
```

```ts
// src/index.ts — browser entry: hydrate the server-rendered page
import Page from "./routes/+page.marko";

Page.renderSync({}).appendTo(document.body);
```

Other notable options: `outputDir`, `port`, `adapter`, `routesDir`, `trailingSlashes`, and `rspack` — a `(config, side) => config` callback applied to each generated config. See the `RspackOptions` type for the full list.

### Adapters

- **node** (default) — no `adapter` option needed; `dist/server/index.cjs` is a standalone Node server.
- **static** — `@markopack/adapter-static` crawls your routes and emits pre-rendered HTML.
- **netlify** — `@markopack/adapter-netlify` wraps the upstream `@marko/run` Netlify adapter.

### Customizing Rspack

An `rspack.config.{ts,js,mjs,…}` file in the app root is picked up automatically: an object export is merged into the browser config (arrays like `module.rules` concatenate), a function export receives every generated config as `(config, side) => config | void`.

```js
// rspack.config.mjs
export default {
  module: {
    rules: [{ test: /\.scss$/, use: "sass-loader" }],
  },
};
```

## Route Conventions

markopack inherits all `@marko/run` conventions:

| File | Purpose |
|---|---|
| `+page.marko` | Page template |
| `+layout.marko` | Layout wrapper |
| `+handler.ts` | API / route handler |
| `+middleware.ts` | Per-route middleware |
| `+meta.ts` | Route metadata |
| `$slug/` | Dynamic segment |
| `$$rest/` | Catch-all segment |
| `_group/` | Pathless layout group |
| `+404.marko` | Not-found page |
| `+500.marko` | Error page |

Routes live in `src/routes/` by default and map directly to URL paths. TypeScript route types are generated into `.marko-run/routes.d.ts` on build when a `tsconfig.json` is present.

## Pure Marko Mode (no `@marko/run`)

Only want Marko components + SSR, without the file-routing layer? Pass `routes: false` — `@marko/run` is then not needed at all. You provide your own server entry and own the HTTP server:

```js
// build.mjs
import { build } from "@markopack/rspack";

build({
  root: import.meta.dirname,
  routes: false,                     // skip the routing pipeline
  entry: "./src/index.ts",           // browser entry (hydration)
  serverEntry: "./src/server.ts",    // your own server
  mode: "production",
});
```

```ts
// src/server.ts — you own the HTTP server
import http from "node:http";
import App from "./app.marko";

const server = http.createServer((req, res) => {
  res.setHeader("content-type", "text/html;charset=UTF-8");
  res.end(`<!DOCTYPE html><html><body>${App.render({}).toString()}</body></html>`);
});
server.listen(3000);

// markopack's dev mode calls this before reloading the server bundle,
// releasing the port so the new server can listen again.
export function close() {
  server.close();
  server.closeAllConnections?.();
}
```

See [`examples/rspack-pure-marko`](./examples/rspack-pure-marko) for a complete working example.

## Examples

- **[`examples/rspack-basic`](./examples/rspack-basic)** — Multi-page app demonstrating static routes, dynamic segments, catch-all routes, layout groups, API handlers, and hot reload.
- **[`examples/rspack-pure-marko`](./examples/rspack-pure-marko)** — Pure Marko app with `routes: false`: no `@marko/run`, custom server entry, SSR + hydration.

## Developing markopack

This repository is a pnpm workspace — use pnpm for all commands:

```bash
pnpm install
pnpm run build            # build all packages
pnpm run verify:example   # build + smoke-test the example app
pnpm run test:routes      # route generation tests
pnpm run test:contract    # generated match objects vs installed @marko/run runtime
pnpm run test:adapters    # adapter build tests
pnpm run test:crawler     # adapter-static crawler regression guard
pnpm run test:dev-watch   # dev-server route watching / hot route discovery

pnpm run sync:marko-run:check   # dry-run vendored-code sync from upstream @marko/run
pnpm run bench:setup && pnpm run bench:perf
```

Releases are driven by [changesets](https://github.com/changesets/changesets): every user-visible change needs a `.changeset/*.md` file; merging the auto-opened "chore: release packages" PR publishes to npm from CI.

## Contributing

See [`UPSTREAM_SYNC.md`](./UPSTREAM_SYNC.md) for how vendored `@marko/run` internals are kept in sync with upstream.

## License

MIT
