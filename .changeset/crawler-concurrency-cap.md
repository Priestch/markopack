---
"@markopack/adapter-static": patch
---

Fix static crawler OOM on large sites: cap concurrent visits at 100 and deduplicate the start queue

Upstream's crawler fired every queued path at once (`startPaths.map(visit)` plus every link discovered mid-flight) with no concurrency cap, so peak memory scaled with concurrent visits × per-render cost — quadratic on nav-heavy sites, OOM-ing past ~2500 routes. The start queue was also not deduplicated (`seen` only guarded link discovery), so overlapping entries each spawned their own visit.

The promise-wave queue is now a path queue drained by a bounded worker pool (100), duplicate start paths collapse before seeding, and the first visit error propagates after in-flight visits settle (upstream's `Promise.all` abandoned the rest unobserved). `visit()` also awaits `finished(pageWriter)` to match upstream 2.0.10, so `crawl()` no longer resolves while page files are still flushing.

Validated on a 5003-route site with a full nav on every page: all routes crawled exactly once, ~4.3 GB peak (previously OOM at 4 GB and 8 GB heaps). Unit-tested in `npm run test:crawler` (concurrency cap, dedup, link/redirect discovery, error propagation).
