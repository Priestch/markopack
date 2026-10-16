---
"@markopack/compiler": patch
"@markopack/rspack": patch
---

Fix extracted `<style>` blocks end to end. compiler: pass `resolveVirtualDependency` for all compile outputs, not just hydrate, so styles materialize as virtual `.css`/`.scss` files instead of being silently dropped; materialized files keep their own extension. rspack: css rules now use rspack's native css modules (`type: "css/auto"`) with `output.cssFilename`/`cssChunkFilename` naming — the previous `javascript/auto` + plugin `filename` options emitted css next to js chunks under `static/js/` or failed to parse as JS; `.scss`-typed style blocks compile via sass-loader (new dependency).
