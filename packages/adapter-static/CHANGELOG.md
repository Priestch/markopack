# @markopack/adapter-static

## 0.1.5

### Patch Changes

- 035318b: Fix CJS module interop in static adapter's buildEnd: dynamic `import()` of a CJS bundle wraps exports under `.default`, so `fetch` was undefined. Now falls back to `mod.default?.fetch`.
  - @markopack/core@0.1.5

## 0.1.4

### Patch Changes

- c1cd7bd: Fix layout template escape and update Marko to 6.x
- Updated dependencies [c1cd7bd]
  - @markopack/core@0.1.4

## 0.1.3

### Patch Changes

- 8509201: Fix layout template to use input.content and improve install progress spinner
- Updated dependencies [8509201]
  - @markopack/core@0.1.3

## 0.1.2

### Patch Changes

- 02e0fbf: Fix ESM imports and improve CLI progress feedback
- Updated dependencies [02e0fbf]
  - @markopack/core@0.1.2
