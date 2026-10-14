# Upstream Sync Guide

This workspace vendors selected source files from `@marko/run` and official adapter packages to keep rspack integration stable.

## Source of Truth

- Always sync from the git repo (never from a local clone by default).
- Default repo: `https://github.com/marko-js/run.git`
- Default ref: `main`
- Local mirror cache path: `${TMPDIR}/markopack-sync/marko-run`

## Commands

- Check if sync would change files:

```bash
npm run sync:marko-run:check
```

- Apply sync:

```bash
npm run sync:marko-run
```

- Apply sync from custom repo/ref:

```bash
node scripts/sync-from-marko-run.mjs --repo https://github.com/marko-js/run.git --ref <commit-or-tag-or-branch>
```

- Environment overrides:

```bash
MARKO_RUN_REPO=https://github.com/marko-js/run.git MARKO_RUN_REF=<sha> npm run sync:marko-run
```

## What Gets Synced

- Core route/codegen/utils used by rspack integration:
  - `packages/run/src/vite/**` selected files
- Official adapter sources (node/static/netlify), preferring monorepo adapter paths and falling back to `node_modules/@marko/run-adapter-*`.

## What Is No Longer Synced

- `adapter/middleware.ts` — replaced by a re-export of `@marko/run/adapter/middleware` (a public export since 0.11 with an identical API).
- `utils/server.ts` — trimmed to the subset markopack's adapters use (`loadEnv`, `spawnServer`, `getAvailablePort`); the cluster-mode machinery was dropped.
- `adapter-node/src/ensure-runtime.ts` — trimmed to the production passthrough; the upstream Vite dev-server bootstrap can't run under markopack, which drives dev itself.
- Vite-shaped hooks — the vendored `Adapter` interface no longer has `plugins`/`viteConfig`, and no package depends on `vite` or `@marko/vite`. After syncing `core/src/types.ts` these local modifications must be re-applied.
- `adapter-static/src/crawler.ts` — carries a local fix upstream doesn't have (as of @marko/run-adapter-static 2.0.10): a bounded worker pool (100 concurrent visits) replaces the `Promise.all` promise-wave loop, the start queue is deduplicated before seeding, and the first visit error propagates after in-flight visits settle. Without the cap, peak memory scales quadratically on nav-heavy sites and static builds OOM past ~2500 routes. After syncing this file the fix must be re-applied — `npm run test:crawler` guards it. The file also awaits `finished(pageWriter)` in `visit()` to match upstream 2.0.10 (the vendored copy had drifted from an older ref, letting `crawl()` resolve while page files were still flushing). Upstream report is pending a decision.

## After Sync

Run:

```bash
npm run verify:example
npm run test:contract
npm run test:crawler
```

`test:contract` is the one that catches codegen/runtime drift (e.g. a new field the runtime reads off match objects) — run it first after any sync.

Then review and commit with a message like:

```text
chore(sync): update vendored core and adapters from @marko/run
```
