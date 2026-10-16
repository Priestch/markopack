---
"@markopack/rspack": patch
---

Fix component CSS extraction: enable experiments.css, wire configs to the app root

The style-extraction rules shipped inert: `experiments.css` was never
enabled (so `type: "css/auto"` was a no-op and no stylesheet was ever
emitted), and the CssExtract loader in `use` is the legacy webpack path,
not the experimental native-css one. Rules now use `type: "css"` with
only lightningcss in `use`.

Intra-workspace dependencies were also resolving to published npm
tarballs instead of the workspace sources (semver ranges +
`linkWorkspacePackages` lost to a lockfile pinned to registry tarballs),
so local loader fixes silently never ran. All intra-repo deps are now
`workspace:*`.

Both generated configs set `context: root` — without it rspack anchored
resolution to `process.cwd()`, making bare loader names and relative
paths depend on where the build was launched from.
