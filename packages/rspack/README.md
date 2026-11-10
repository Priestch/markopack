# @markopack/rspack

Direct rspack integration for `@marko/run`. Builds Marko SSR apps using raw rspack — zero framework overhead.

## Install

```sh
npm install @markopack/rspack @rspack/core marko @marko/run
```

## Usage

```js
import { build, dev } from "@markopack/rspack";

// Production build
await build({ root: process.cwd() });

// Dev server with hot reload, reverse proxy, and default headers
const server = await dev({
  root: process.cwd(),
  port: 3000,
  proxy: { "/api/v1": { target: "https://staging.example.com", changeOrigin: true } },
  headers: { "cache-control": "no-store" },
});
```

See the [main README](../../README.md) for config customization (`rspack.config.*`, the `rspack` callback) and the list of managed invariants.

## Options

| Option | Default | Description |
|---|---|---|
| `root` | `process.cwd()` | Project root directory |
| `entry` | `"./src/index.ts"` | Browser entry point |
| `outputDir` | `"dist"` | Output directory |
| `routesDir` | `"src/routes"` | Routes directory |
| `mode` | `"production"` (build) / `"development"` (dev) | Build mode |
| `port` | `3000` | Dev server port |
| `adapter` | `null` | Adapter plugin (node, static, netlify) |
| `trailingSlashes` | `"RedirectWithout"` | Trailing slash handling |
| `debug` | `false` | Debug logging |
| `rspack` | — | `(config, side) => config` callback applied to both generated configs |
| `proxy` | — | Dev-only reverse proxy: `{ "/prefix": http-proxy-middleware options }` |
| `headers` | — | Dev-only default response headers: `{ name: value }` |
| `routes` | `true` | Set `false` for pure-Marko mode (no `@marko/run`) |
| `serverEntry` | `"./src/server.ts"` | Server entry for pure-Marko mode |

## Adapters

```js
import nodeAdapter from "@markopack/adapter-node";

await build({ root: ".", adapter: nodeAdapter() });
```

## What it does

- Walks `src/routes/` and generates virtual route modules
- Creates separate web + node rspack configs for SSR
- Handles server-side bundle hot reload in dev mode
- Supports all `@marko/run` route conventions (`$slug`, `$$rest`, `+handler.ts`, `+page.marko`)
