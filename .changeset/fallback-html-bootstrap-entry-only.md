---
"@markopack/rspack": patch
---

Fix broken asset references in the fallback HTML

The fallback `index.html` injected `<script>`/`<link>` tags for every
entry the browser compiler saw, including the per-page entries
(`about_l24j`, `marko-run_Qime`, …) that MarkoRspackPlugin merges in.
Two problems: pages with nothing to hydrate compile to a 0-byte browser
chunk that the plugin then deletes, leaving script tags that 404; and
the remaining entries' JS/CSS were eagerly loaded on every page when
they belong to the runtime's per-route loading. The fallback HTML now
references only the `index` bootstrap entry — page assets are loaded
per-route through the link-assets manifest, as before. This also
removes the duplicate stylesheet (identical content, two `<link>`s)
that showed up on the index page.
