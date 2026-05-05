# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

markopack is a monorepo providing Rspack integration for `@marko/run`. It lets developers build Marko SSR applications using raw Rspack with zero framework overhead. The project vendors selected source files from `@marko/run` (the upstream Vite-based toolkit) and adapts them for Rspack.

## Commands

```bash
# Build all packages
npm run build

# Build, then start the example dev server
npm run dev:example

# Build, then run smoke test against example
npm run verify:example

# Test route generation (builds core + rspack, then runs scripts/test-routes.mjs)
npm run test:routes

# Sync vendored code from upstream @marko/run
npm run sync:marko-run          # apply
npm run sync:marko-run:check    # dry-run

# Benchmarks
npm run bench:setup && npm run bench:perf
```

There is no formal test suite — verification is done via `npm run verify:example` (smoke test) and `npm run test:routes`.

## Architecture

### Package Dependency Graph

```
@markopack/core  ←  @markopack/compiler  ←  @markopack/rspack
                                              ↕
                                   adapters (node, static, netlify)
```

### Packages

- **`@markopack/core`** — Vendored route building, codegen, and middleware utilities adapted from `@marko/run`'s Vite internals. Built with `tsc`. Exports deeply nested sub-paths (e.g. `@markopack/core/vite/codegen`).

- **`@markopack/compiler`** — `MarkoRspackPlugin` class and `marko-loader`. Coordinates browser/server manifest sync across a Rspack MultiCompiler. Built with `tsup` for dual ESM/CJS output.

- **`@markopack/rspack`** — Public API: `build()` and `dev()` functions. Creates dual Rspack configs (web + node), handles route discovery and virtual module generation. Built with a custom `scripts/build.mjs`.

- **Adapters** (`adapter-node`, `adapter-static`, `adapter-netlify`) — Platform-specific deployment adapters. Each implements the `Adapter` interface from `@markopack/core/vite/types`.

### Key Patterns

**Dual compilation**: Every build produces separate browser (`dist/client/`) and server (`dist/server/`) bundles via Rspack MultiCompiler. The `MarkoRspackPlugin` syncs dynamic entry points and asset manifests between them.

**Virtual modules**: Routes are generated as virtual files in `.marko-run/` at build time. The `NormalModuleReplacementPlugin` rewrites `virtual:marko-run/*` imports to these real files.

**Upstream vendoring**: `scripts/sync-from-marko-run.mjs` pulls selected files from `github.com/marko-js/run` into `packages/core/src/`. See `UPSTREAM_SYNC.md` for details.

**Route conventions**: File-based routing in `src/routes/` using `$slug` (dynamic), `$$rest` (catch-all), `+handler.ts` (API), `+page.marko` (page), `_group/` (pathless grouping).

## Build Tooling

- **TypeScript**: Strict mode, ES2022 target, ESNext modules. Base config at `tsconfig.base.json`.
- **Compiler package**: Uses `tsup` for dual ESM/CJS.
- **Rspack package**: Custom build script (`packages/rspack/scripts/build.mjs`) using esbuild.
- **All other packages**: `tsc -p tsconfig.json`.
- **Node engines**: `@markopack/rspack` and `@markopack/compiler` require Node >=20.19.0 || >=22.12.0.
