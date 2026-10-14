#!/usr/bin/env node
/**
 * Unit test for the vendored static-adapter crawler (packages/adapter-static).
 *
 * Covers the local divergence from upstream (see UPSTREAM_SYNC.md):
 *   1. Concurrency cap — max in-flight requests never exceed
 *      MAX_CONCURRENT_VISITS (100), even when every page links every page.
 *   2. Start-queue dedup — duplicate entries in `paths` are crawled once.
 *   3. Link discovery + redirect scheduling still work through the pool.
 *   4. First error propagates out of crawl() after in-flight visits settle.
 *
 * Run: npm run test:crawler
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import createCrawler from "../packages/adapter-static/dist/crawler.js";

const ORIGIN = "http://localhost";

/**
 * Fake site: N pages, every page links every page (nav amplification
 * topology), each with a distinct marker. `/page-k` redirects to `/page-j`
 * for the redirect-scheduling path. One page can be made to fail.
 */
function makeFakeSite({ pages = 300, failPath } = {}) {
  const visits = [];
  let inFlight = 0;
  let maxInFlight = 0;

  const makeRequest = async (request) => {
    const url = new URL(request.url);
    const p = url.pathname;
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise((r) => setTimeout(r, 5)); // hold visits open so concurrency is observable
      visits.push(p);

      if (p === failPath) {
        throw new Error(`boom: ${p}`);
      }
      if (p === "/redirect-src") {
        return new Response(null, {
          status: 301,
          headers: { location: "/page-1" },
        });
      }
      const match = /^\/page-(\d+)$/.exec(p);
      if (!match) {
        return new Response("nope", { status: 404 });
      }
      const links = Array.from(
        { length: pages },
        (_, i) => `<a href="/page-${i}">p${i}</a>`,
      ).join("");
      return new Response(
        `<!DOCTYPE html><html><body><h1>Page ${match[1]}</h1>${links}</body></html>`,
        { headers: { "content-type": "text/html" } },
      );
    } finally {
      inFlight--;
    }
  };

  return { makeRequest, stats: () => ({ visits, maxInFlight }) };
}

const out = mkdtempSync(path.join(tmpdir(), "markopack-crawler-test-"));

try {
  // --- 1+2+3: cap + dedup + discovery, nav-amplification topology --------
  {
    const paths = ["/page-0", "/page-0", "/page-1", "/page-1", "/page-2"];
    const { makeRequest, stats } = makeFakeSite({ pages: 300 });
    const crawler = createCrawler(makeRequest, { out: path.join(out, "a") });

    await crawler.crawl(paths);

    const { visits, maxInFlight } = stats();
    // Dedup: each page requested exactly once despite duplicated start list
    // and every page linking every page.
    const counts = new Map();
    for (const v of visits) counts.set(v, (counts.get(v) || 0) + 1);
    for (const [p, n] of counts) assert.equal(n, 1, `${p} visited ${n}x`);
    // Discovery: nav links pulled in all 300 pages, not just the 3 starts.
    assert.equal(counts.size, 300, `expected 300 unique pages, got ${counts.size}`);
    // Cap: pool must be bounded (≤100) and actually parallel (>1).
    assert.ok(
      maxInFlight <= 100,
      `concurrency ${maxInFlight} exceeded the 100 cap`,
    );
    assert.ok(maxInFlight > 1, `pool never ran in parallel (max ${maxInFlight})`);
    // Output: one html file per visited page.
    assert.equal(readdirSync(path.join(out, "a")).length, 300);
    console.log(`  cap/dedup/discovery: ${counts.size} pages, maxInFlight=${maxInFlight} ✓`);
  }

  // --- redirect scheduling through the pool ------------------------------
  {
    const { makeRequest, stats } = makeFakeSite({ pages: 5 });
    const crawler = createCrawler(makeRequest, { out: path.join(out, "b") });
    await crawler.crawl(["/redirect-src"]);
    const { visits } = stats();
    assert.ok(visits.includes("/redirect-src"), "redirect source visited");
    assert.ok(visits.includes("/page-1"), "redirect target scheduled and visited");
    console.log("  redirect scheduling ✓");
  }

  // --- 4: first error propagates, in-flight settle ------------------------
  {
    const { makeRequest } = makeFakeSite({ pages: 150, failPath: "/page-3" });
    const crawler = createCrawler(makeRequest, { out: path.join(out, "c") });
    await assert.rejects(
      () => crawler.crawl(["/page-0"]),
      (err) => err instanceof Error && err.message === "boom: /page-3",
    );
    console.log("  error propagation ✓");
  }

  console.log("crawler tests: all passed");
} finally {
  rmSync(out, { recursive: true, force: true });
}
