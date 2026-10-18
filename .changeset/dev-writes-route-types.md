---
"@markopack/rspack": minor
---

Write routes.d.ts in dev mode too

The generated route types were only written by production builds — under
`dev()` the file appeared only if a build had run before, leaving editors
without route types (and `GlobalDefineHandler` overloads) during pure-dev
work. Upstream writes them whenever routes are generated; markopack now
does the same: `dev()` writes `.marko-run/routes.d.ts` at startup, and
the route watcher rewrites it after every clean re-walk. Build behavior
is unchanged.
