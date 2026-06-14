# markopack

**Rspack integration for [`@marko/run`](https://github.com/marko-js/run)** — build Marko SSR applications using raw Rspack with zero framework overhead.

## Overview

markopack is a monorepo that lets you use Marko's file-based routing and SSR system with [Rspack](https://rspack.rs/) instead of Vite. Drop it into any Marko project and get the same route conventions, adapters, and hot reload you'd get from `@marko/run` — without Vite.


## Quick Start

```bash
npm create markopack@latest
```

The CLI will ask for a project name, adapter, and whether to use TypeScript, then scaffold and install everything for you.

**Non-interactive:**

```bash
npm create markopack@latest my-app -- --adapter node --typescript
```

Once scaffolded:

```bash
cd my-app
npm run dev    # start the dev server
npm run build  # production build
```

## Architecture

```
@markopack/core  ←  @markopack/compiler  ←  @markopack/rspack
                                              ↕
                                   adapters (node, static, netlify)
```

Every build produces two Rspack bundles coordinated by a **MultiCompiler**:

- **browser** (`dist/client/`) — DOM hydration bundle, compiled with `output: "dom"`
- **server** (`dist/server/`) — CJS SSR bundle, compiled with `output: "html"`

`MarkoRspackPlugin` syncs dynamic entry points (one per Marko component used server-side) and the client asset manifest between the two compilers.

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

Routes live in `src/routes/` by default and map directly to URL paths.

## Repository Commands

```bash
# Build all packages
npm run build

# Build packages + run the example dev server
npm run dev:example

# Build packages + smoke-test the example
npm run verify:example

# Test route generation
npm run test:routes

# Sync vendored code from upstream @marko/run
npm run sync:marko-run          # apply changes
npm run sync:marko-run:check    # dry-run (no writes)
```

## Examples

- **[`examples/rspack-basic`](./examples/rspack-basic)** — Multi-page app demonstrating static routes, dynamic segments, catch-all routes, layout groups, API handlers, and hot reload.

## Contributing

See [`UPSTREAM_SYNC.md`](./UPSTREAM_SYNC.md) for how vendored `@marko/run` internals are kept in sync with upstream.

## License

MIT
