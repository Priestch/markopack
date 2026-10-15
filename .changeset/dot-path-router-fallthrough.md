---
"@markopack/rspack": patch
---

dev: extension-suffixed URLs that miss the static asset dir now fall through to the router instead of 404ing — required for dot-path routes (e.g. plugin-generated `/sitemap.xml`).
