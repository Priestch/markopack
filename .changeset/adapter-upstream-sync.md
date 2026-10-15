---
"@markopack/adapter-static": patch
"@markopack/adapter-netlify": patch
---

Sync adapters with upstream @marko/run:

- adapter-static preview: the 404 page now really answers 404 — sirv's
  `send` ends with an unconditional `writeHead(200)` that discarded the
  status set from `setHeaders`; a `forceStatus` wrapper pins it
- adapter-netlify: preview process shutdown uses the runtime's
  `closeSpawnedProcess` (SIGTERM → SIGKILL tree kill) instead of a bare
  `kill()`; `spawn` no longer passes an args array alongside `shell: true`
  (Node DEP0190); edge function config uses the declarative
  `path`/`excludedPath` API, excluding `/static/*` (markopack's asset
  prefix) instead of a dotted-path regex
