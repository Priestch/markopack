---
"@markopack/rspack": patch
---

Ship real declaration files generated from source

`@markopack/rspack`'s hand-written `index.d.ts` stub lagged the actual API:
the `rspack` config-customization callback, `serverEntry`, and `routes`
options were untyped, and `emitRoutes` took `any[]` instead of `Route[]`.
Declarations are now emitted by `tsc` from the sources (which also type-
checks them — esbuild alone never did, and five errors had accumulated).
`DevServer` is exported as a type.
