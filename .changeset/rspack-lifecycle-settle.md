---
"@markopack/rspack": patch
---

Fix build() hanging forever when post-compile steps throw; DevServer.close() now awaits shutdown

`build()`'s `compiler.close` callback is async — an error thrown by the
link-assets manifest injection or an adapter's `buildEnd` rejected that
callback's promise unhandled, leaving the promise returned by `build()`
unsettled: callers awaited it forever with only a stray unhandled-
rejection warning. The callback now catches and rejects (verified: a
throwing adapter rejects in <1s instead of hanging).

`DevServer.close()` also awaited nothing after stopping the watcher —
`server.close()` was fire-and-forget, and its callback only fires after
keep-alive connections drain. It now destroys open connections
(`closeAllConnections`) and awaits the server's close callback.
