---
"@markopack/rspack": patch
"@markopack/adapter-static": patch
---

Warn instead of silently swallowing recoverable build errors

- `@markopack/rspack`: when handler verb detection fails to read a
  handler file (ENOENT race, permissions), the route silently matched
  no HTTP method and 404ed with no trace of why — it now logs a warning
  naming the file.
- `@markopack/adapter-static`: a failed copy of the browser `client/`
  output into the crawled `public/` directory used to vanish entirely,
  leaving pages referencing `/static/...` assets that 404ed (a missing
  `client/` dir from a routes-only build stays silent); a failed
  cleanup of the built server entry now reports itself too.
