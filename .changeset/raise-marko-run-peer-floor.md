---
"@markopack/core": patch
"@markopack/rspack": patch
"@markopack/adapter-node": patch
"@markopack/adapter-static": patch
"@markopack/adapter-netlify": patch
---

Require @marko/run ^0.11.14 (peer dependency floor)

The generated code assumes the 0.11.14 runtime: client-disconnect render
abort, same-origin-referer context.back(), //-path origin handling, the
deferred response head, and the lazy router facade all shipped there.
Users resolving 0.11.0–0.11.13 against the previous ^0.11.0 floor got
silently broken behavior. The peer range now starts at ^0.11.14 to fail
installation instead of failing at runtime.
