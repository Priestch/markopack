---
"@markopack/adapter-static": patch
---

Preserve existing public HTML documents during link discovery instead of requesting them from the router and reporting false 404s. Only skip exact existing `.html`/`.htm` files (including encoded paths and query strings), so HTML-suffixed application routes and explicit crawl seeds remain supported. Write a 404 response only for the configured 404 page; broken links remain diagnostics and no longer produce junk documents such as `privacy_policy.html.html`.
