---
"@markopack/rspack": patch
---

Detect handler verbs via AST instead of regex source scan

Handler verb detection now parses the file and collects export identifiers
(mirroring upstream's `getExportIdentifiers`), so `export { list as GET }`
specifier aliases and `export const GET: Handler = ...` TS annotations are
recognized — the old regex missed both shapes. It also stops matching verb
names inside comments and strings: previously a mention of
`export function DELETE(` in a comment registered DELETE on the route, and
the generated router then imported a nonexistent export, failing the entire
build. Unparseable sources fall back to the historical scan.
