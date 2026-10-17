---
"@markopack/rspack": patch
---

Fix dev-server asset serving for query-suffixed URLs

The dev server routed extension-suffixed URLs to sirv (static assets)
by testing the extension regex against the raw request URL. Asset URLs
carrying a query string (`/static/css/index.css?v=…`) end with the
query parameter, not the extension, so they fell through to the router
and 404ed. The check now runs against the parsed pathname, so
query-suffixed assets serve from `dist/client` again. Static misses
still fall through to the router, keeping dot-path handler routes
(e.g. `/sitemap.xml`, expressed as `sitemap`.`xml` in the routes dir)
working — both cases are now covered by `npm run test:routes`.
