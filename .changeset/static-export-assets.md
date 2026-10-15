---
"@markopack/adapter-static": patch
---

Fix static exports missing browser assets: crawled pages now land in `public/`
alongside the client bundle's JS/CSS (previously `/static/...` references 404'd
on hydrated pages), stale files from earlier builds are cleaned before
crawling, and a route that fails to render now fails the build instead of
being silently left out. Crawler synced with upstream @marko/run (relative
link resolution, redirect handling, rel token matching).
