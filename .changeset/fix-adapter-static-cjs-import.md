---
"@markopack/adapter-static": patch
---

Fix CJS module interop in static adapter's buildEnd: dynamic `import()` of a CJS bundle wraps exports under `.default`, so `fetch` was undefined. Now falls back to `mod.default?.fetch`.
