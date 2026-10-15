---
"@markopack/core": patch
"@markopack/rspack": patch
---

Sync route codegen with upstream @marko/run (0.11.14 era):

- static route segments that arrive percent-encoded now match (`/a%20b`
  reaches the `a b` route); a malformed percent-escape is a clean 404
  instead of a thrown URIError
- QUERY requests render the page like GET when a `+handler.ts` exports
  `QUERY` (completes RFC 9110 QUERY support started in the builder sync)
- trailing-slash policy now applies in `invoke`, not only the generated
  fetch; route option merging no longer mutates shared middleware
  options; verb-specific middleware options are skipped for verbs they
  don't run on
- generated route types use the new `Run` namespace (MarkoRun members
  marked deprecated) and carry a conventions cheat-sheet pointer for
  coding agents
