---
"@markopack/rspack": patch
---

Serve @marko/run/router through the runtime facade in dev

In dev, server-side imports of `@marko/run/router` (middleware, handlers,
app code) now resolve to @marko/run's router facade, which defers to the
`__marko_run__` global instead of statically importing the generated
router — matching upstream. App code reachable from middleware can no
longer create an evaluation cycle with the generated router, which
imports that code back through its routes; request-time match()/fetch()/
invoke() calls behave identically (verified by the basic-handler fixture
in both dev and preview modes). Production builds keep the direct alias.
