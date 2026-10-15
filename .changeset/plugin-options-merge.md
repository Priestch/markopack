---
"@markopack/rspack": patch
---

Honor the value returned by an adapter's `pluginOptions()` hook: it is now
merged back into the build options (matching @marko/run's contract) before
`routesDir` / `trailingSlashes` are read, instead of being discarded.
