---
"@markopack/rspack": minor
---

Load an optional rspack.config.{ts,mts,cts,js,mjs,cjs} from the app root

Apps can now define an rspack config file that merges with markopack's
generated configs. An object export merges into the browser config —
arrays (module.rules, plugins) concatenate with the generated ones,
plain objects shallow-merge, everything else replaces. A function
export receives every generated config, `(config, side) => config`,
for per-side control (the programmatic `rspack` option from before
still applies last).

Preprocessor rules (sass, less, …) belong here rather than in
markopack's defaults — `sass`/`sass-loader` are no longer dependencies
of `@markopack/rspack`. The basic example demonstrates this: it adds
its sass rule via `rspack.config.mjs` with app-local `sass` +
`sass-loader` devDependencies.
