# @rs-marko-run/rspack

Direct rspack integration for `@marko/run`. Builds Marko SSR apps using raw rspack — no rsbuild overhead.

## Install

```sh
npm install @rs-marko-run/rspack @rspack/core marko @marko/run
```

## Usage

```js
import { build, dev } from "@rs-marko-run/rspack";

// Production build
await build({ root: process.cwd() });

// Dev server with hot reload
const server = await dev({ root: process.cwd(), port: 3000 });
```

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

## Adapters

```js
import nodeAdapter from "@rs-marko-run/adapter-node";

await build({ root: ".", adapter: nodeAdapter() });
```

## What it does

- Walks `src/routes/` and generates virtual route modules
- Creates separate web + node rspack configs for SSR
- Handles server-side bundle hot reload in dev mode
- Supports all `@marko/run` route conventions (`$slug`, `$$rest`, `+handler.ts`, `+page.marko`)
