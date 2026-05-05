# @markopack/compiler

Marko compiler plugin and loader for rspack. Used internally by `@markopack/rspack`.

## Install

```sh
npm install @markopack/compiler @rspack/core marko
```

## What it provides

- **`MarkoRspackPlugin`** — Coordinates SSR/browser manifest sync across a MultiCompiler. Handles dynamic entry point injection for server-rendered Marko components.
- **`marko-loader`** — rspack loader that compiles `.marko` files using `@marko/compiler`. Supports `output: "dom"` (browser) and `output: "html"` (server).

## Usage

This package is primarily used by `@markopack/rspack`. You typically don't need to use it directly.

```js
import MarkoRspackPlugin from "@markopack/compiler";

const plugin = new MarkoRspackPlugin({
  entries: { web: webEntry, node: nodeEntry },
  sourceMaps: true,
});

plugin.browserApply(webCompiler);
plugin.serverApply(nodeCompiler);
plugin.applyDependencies(multiCompiler, isWatchMode);
```
