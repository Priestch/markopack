# create-markopack

## 0.3.0

## 0.2.2

## 0.2.1

## 0.2.0

### Patch Changes

- 77c3491: Remove the last Vite dependencies: `@markopack/core`'s `vite/*` subpath exports are renamed (`@markopack/core/vite/types` → `@markopack/core/types`, etc.), the `Adapter` interface drops the Vite-shaped `plugins`/`viteConfig` hooks, and no markopack package depends on `vite` or `@marko/vite` anymore.

## 0.1.5

### Patch Changes

- bd99702: Add missing dependencies: `sirv` in `@markopack/rspack` (used by dev server) and `@marko/runtime-tags` in create-markopack templates (required by Marko 6 compiled output).
- bd99702: Fix static adapter preview template: serve from `dist/server/public` (not `dist/client`), remove TypeScript syntax from `.mjs` output, and serve `404.html` for unknown paths.

## 0.1.4

### Patch Changes

- c1cd7bd: Fix layout template escape and update Marko to 6.x

## 0.1.3

### Patch Changes

- 8509201: Fix layout template to use input.content and improve install progress spinner

## 0.1.2

### Patch Changes

- 02e0fbf: Fix ESM imports and improve CLI progress feedback
