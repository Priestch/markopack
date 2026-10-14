---
"@markopack/core": minor
"@markopack/adapter-node": patch
"@markopack/adapter-netlify": patch
"create-markopack": patch
---

Remove the last Vite dependencies: `@markopack/core`'s `vite/*` subpath exports are renamed (`@markopack/core/vite/types` → `@markopack/core/types`, etc.), the `Adapter` interface drops the Vite-shaped `plugins`/`viteConfig` hooks, and no markopack package depends on `vite` or `@marko/vite` anymore.
