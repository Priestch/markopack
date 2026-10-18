---
"@markopack/compiler": minor
"@markopack/rspack": minor
---

Support `Run.href` in the browser

`@marko/run`'s typed-link API (`Run.href("/products/$id", { params })`)
only worked server-side under markopack: nothing defined `window.Run` in
browser bundles, so client-side calls hit an undefined global. The
`@marko/run` client runtime (which does `window.Run ||= { href }`) is now
prepended to every browser entry — page entries and host entries alike —
so hydrated code can call `Run.href` directly. The module is idempotent,
so per-entry duplication is harmless. `virtual:marko-run/runtime/client`
is also aliased now, matching upstream, for code that imports it
explicitly. MarkoRspackPlugin gains a `browserEntryImports` option
(modules prepended to every browser entry) which powers this.
