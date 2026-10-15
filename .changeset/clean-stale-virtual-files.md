---
"@markopack/rspack": patch
---

Clean stale generated files from `.marko-run/` on route discovery

Every rebuild regenerates the route entries, page templates, and router in
`.marko-run/`, but files whose source routes no longer exist were never
removed — they accumulated forever (a probe route deleted days ago kept its
generated files around). Discovery now deletes any generated-pattern file
(`__marko-run__*`, `*.marko`, `__fallback_index.html`) that the current run
didn't write; anything else in the directory is left untouched.
