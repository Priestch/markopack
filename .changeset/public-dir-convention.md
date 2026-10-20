---
"@markopack/adapter-static": minor
"@markopack/rspack": minor
---

Add a <root>/public/ convention for static assets (Vite publicDir semantics)

Projects can now ship source static assets from a `public/` directory at
the app root. In dev, they are served as a sirv pass in the chain
`clientDist → public → router` — the public sirv is lazily initialized per
request, so assets may appear mid-session (e.g. the markopress image
pipeline writing on first render). The router fallback stays last so
dot-path routes (`/sitemap.xml`) are never swallowed by static lookup.
In static builds, `buildEnd` copies `public/` into the output after
removing `outDir` and before merging the client bundle — built artifacts
win over source assets, same precedence as Vite. Previously markopack had
no public concept at all; this is the groundwork for site assets like
robots.txt and favicons.
