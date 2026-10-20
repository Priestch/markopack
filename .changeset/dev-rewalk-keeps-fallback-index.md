---
"@markopack/rspack": patch
---

Stop deleting __fallback_index.html on route re-walk

The dev route re-walk's stale-file cleanup treated `__fallback_index.html`
as a generated artifact and deleted it — but the fallback is written once
at config time as the `HtmlRspackPlugin` template and is never in `keep`,
so the first route add/remove during dev destroyed the HTML template
mid-session (re-walk → `HtmlRspackPlugin` read error). The generated-file
pattern now covers only per-route entries and page templates; the fallback
and everything else in `.marko-run/` (e.g. `routes.d.ts`) is left alone.
