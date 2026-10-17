---
"@markopack/compiler": minor
"@markopack/rspack": minor
---

Support Marko 6 lazy loading (`import X from "./x.marko" with { load: "idle" }`)

- `@markopack/compiler`: the marko loader compiles lazily imported
  components with `entry: "load"` via the new `?load-entry` query, and
  records each one's ready id through a kind-aware `onAsset` registry
  (`__markopack_load_assets__`, separate from the page-asset registry so
  a file that is both keeps both ids). Relative imports in translator
  virtual modules (load-signal modules) are rewritten to absolute paths
  so they resolve from the flattened cache location.
- `@markopack/compiler`: `MarkoRspackPlugin` discovers load entries from
  the registry during server compilation (filtered to modules present in
  the current build, so in-process multi-app builds can't cross-pollute),
  injects them as browser entries, and collects lazy-component css into
  a separate async bucket so pages don't eagerly link every lazy
  component's styles.
- `@markopack/rspack`: the link-assets manifest gains entries keyed by
  ready id — `block` carries the component's stylesheet link, `defer`
  its load-entry script (`async`, since the trigger may fire long after
  parse). The browser build now uses `optimization: { runtimeChunk:
  "single" }`: the ready handshake passes through module-level state in
  the dom runtime, so page entries and load entries must share one
  runtime instance instead of each inlining their own.
