---
"@markopack/rspack": minor
---

dev: full-reload support — SSE channel `/__markopack_reload`, a reload client injected into the first HTML chunk served through the router, and a debounced reload broadcast whenever either compiler finishes a clean rebuild (plus a second broadcast after the server bundle is swapped in, so a reload never lands on a stale bundle).
