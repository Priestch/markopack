# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

markopack is a monorepo providing Rspack integration for `@marko/run`. It lets developers build Marko SSR applications using raw Rspack with zero framework overhead. The project vendors selected source files from `@marko/run` (the upstream Vite-based toolkit) and adapts them for Rspack.

The sibling repo `markopress` consumes markopack via `pnpm link:` — local edits here take effect there immediately, and refactors must account for that consumer.

## Commands

```bash
# Build all packages
pnpm run build

# Build, then start the example dev server
pnpm run dev:example

# Build, then run smoke test against example
pnpm run verify:example

# Test route generation (builds core + rspack, then runs scripts/test-routes.mjs)
pnpm run test:routes

# Assert generated match objects against the installed @marko/run runtime
pnpm run test:contract

# Run adapter build tests (builds everything first)
pnpm run test:adapters

# Crawler regression guard (builds adapter-static, then runs scripts/test-crawler.mjs)
pnpm run test:crawler

# Dev-server route watching / hot route discovery
pnpm run test:dev-watch

# Sync vendored code from upstream @marko/run
pnpm run sync:marko-run          # apply
pnpm run sync:marko-run:check    # dry-run

# Benchmarks
pnpm run bench:setup && pnpm run bench:perf
```

Workspace management is **pnpm-only** (no package-lock; `linkWorkspacePackages: true` links intra-repo `^0.2.x` specs). The `bench/` fixtures are vendored standalone apps that still carry their own npm lockfiles — `bench-setup.mjs` runs `npm install` inside them on purpose (lockfile comparability); everything else uses pnpm.

There is no formal unit test suite — verification is done via the six scripts above: `verify:example` (smoke test), `test:routes`, `test:contract` (asserts generated match objects against the installed `@marko/run` runtime — guards against upstream drift like the 0.11 `route.options` breakage), `test:adapters`, `test:crawler`, and `test:dev-watch`.

## Architecture

### Package Dependency Graph

```
@markopack/core  ←  @markopack/compiler  ←  @markopack/rspack
```

The adapters are peers of this chain, not dependents of `@markopack/rspack`: `adapter-node` and `adapter-static` depend on `@markopack/core`; `adapter-netlify` has no markopack dependencies (it wraps the upstream `@marko/run` netlify adapter directly).

### Packages

- **`@markopack/core`** — Vendored route building, codegen, and middleware utilities adapted from `@marko/run`'s Vite internals. Built with `tsc`. Exports flat sub-paths (one level deep: `./codegen`, `./types`, `./constants`, `./adapter/middleware`, `./routes/*`, `./utils/*` — see `exports` in its package.json).

- **`@markopack/compiler`** — `MarkoRspackPlugin` class and `marko-loader`. Coordinates browser/server manifest sync across a Rspack MultiCompiler. Built with `tsup` for dual ESM/CJS output.

- **`@markopack/rspack`** — Public API: `build()` and `dev()` functions. Creates dual Rspack configs (web + node), handles route discovery and virtual module generation. Built with a custom `scripts/build.mjs`.

- **Adapters** (`adapter-node`, `adapter-static`, `adapter-netlify`) — Platform-specific deployment adapters. Each implements the `Adapter` interface from `@markopack/core/types` (wrapping the matching `@marko/run` adapter).

- **`create-markopack`** — Scaffolding CLI (bin: `create-markopack`, `npm create markopack`). Generates a starter app with the chosen adapter, including a standalone `preview.mjs` for local production preview. Built with a custom `scripts/build.mjs`.

- **`examples/`** — Two example apps: `rspack-basic` (the `dev:example` / `verify:example` vehicle, and the reference for route conventions) and `rspack-pure-marko`.

### Key Patterns

**Dual compilation**: Every build produces separate browser (`dist/client/`) and server (`dist/server/`) bundles via Rspack MultiCompiler. The `MarkoRspackPlugin` syncs dynamic entry points and asset manifests between them.

**Virtual modules**: Routes are generated as virtual files in `.marko-run/` at build time. The `NormalModuleReplacementPlugin` rewrites `virtual:marko-run/*` imports to these real files.

**Upstream vendoring**: `scripts/sync-from-marko-run.mjs` pulls selected files from `github.com/marko-js/run` into `packages/core/src/`. See `UPSTREAM_SYNC.md` for details.

**Route conventions**: File-based routing in `src/routes/` using `$slug` (dynamic), `$$rest` (catch-all), `+handler.ts` (API), `+page.marko` (page), `_group/` (pathless grouping).

**Dev server**: `packages/rspack/src/dev.ts`. Extension-suffixed URLs are served by sirv first, but a sirv miss falls through to the router instead of 404ing — required for dot-path routes (e.g. `/sitemap.xml`). Full-reload on server-bundle changes broadcasts via SSE (`/__markopack_reload`) to a client script injected into the first HTML chunk — `res.write`/`res.end` are wrapped for this, so be careful when touching response handling; a second broadcast fires after the server bundle swap to avoid serving from the stale bundle.

**Hot route discovery**: `packages/rspack/src/watch-routes.ts` re-walks routes incrementally in-process on file events. Unlike the upstream `@marko/run` Vite dev server, there is no full re-walk (which re-scales with total route count) on every route file event.

## Build Tooling

- **TypeScript**: Strict mode, ES2022 target, ESNext modules. Base config at `tsconfig.base.json`.
- **Compiler package**: Uses `tsup` for dual ESM/CJS.
- **Rspack package**: Custom build script (`packages/rspack/scripts/build.mjs`) using esbuild.
- **All other packages**: `tsc -p tsconfig.json`.
- **Node engines**: `@markopack/rspack`, `@markopack/compiler`, and `create-markopack` require Node >=20.19.0 || >=22.12.0.

## Release Process

Releases are driven by [changesets](https://github.com/changesets/changesets) + `.github/workflows/release.yml`, which runs on every push to `main`:

1. **Every user-visible change needs a changeset** — a file in `.changeset/*.md` with `patch`/`minor`/`major` bump frontmatter and a description. Commits without one ship silently in the next release.
2. **Push to main with pending changesets** → the workflow runs `pnpm run version` (`changeset version`: consumes the changesets, bumps package versions, updates CHANGELOGs) and opens/updates the **"chore: release packages"** PR from branch `changeset-release/main`.
3. **Merge that PR** → the next workflow run finds no pending changesets, so it runs `pnpm run release` (`pnpm run build && changeset publish`), publishes all bumped packages to npm, and pushes git tags (`@markopack/rspack@x.y.z` …).
4. There is no manual `npm publish` step — local `changeset publish` is never run; the npm publish happens only in CI.

Preconditions that silently block the release PR (the workflow fails before changesets/action runs):

- `pnpm install --frozen-lockfile` (pnpm **12**, per the workflow) must pass: commit `pnpm-lock.yaml` together with any `package.json` change, regenerated with pnpm 12 (a local pnpm 9 can write an incompatible lockfile). CI also runs this in `ci.yml` — a red Actions tab means no release PR.
- Dependencies with install scripts must be listed under `allowBuilds` in `pnpm-workspace.yaml`, otherwise pnpm 12 hard-fails with `ERR_PNPM_IGNORED_BUILDS` (this broke releases for both `2f61bfe` and `cac7947`).
