---
"create-markopack": patch
---

Fix scaffolded app dependencies

Generated apps pinned `@markopack/rspack` at `^0.1.0` regardless of the
scaffold's own version, so `npm create markopack` installed a
long-outdated toolkit. The `@markopack/*` ranges are now derived from
the scaffold's own version (all markopack packages version together).
`@markopack/core` is also listed explicitly: the generated `preview.mjs`
imports its middleware directly, which only resolved by hoisting
luck — under pnpm's strict `node_modules` it failed with
`ERR_MODULE_NOT_FOUND`.
