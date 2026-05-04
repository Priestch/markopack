# Upstream Sync Guide

This workspace vendors selected source files from `@marko/run` and official adapter packages to keep rspack integration stable.

## Source of Truth

- Always sync from the git repo (never from a local clone by default).
- Default repo: `https://github.com/marko-js/run.git`
- Default ref: `main`
- Local mirror cache path: `${TMPDIR}/rs-marko-run-sync/marko-run`

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
  - `packages/run/src/adapter/middleware.ts`
- Official adapter sources (node/static/netlify), preferring monorepo adapter paths and falling back to `node_modules/@marko/run-adapter-*`.

## After Sync

Run:

```bash
npm run verify:example
```

Then review and commit with a message like:

```text
chore(sync): update vendored core and adapters from @marko/run
```
