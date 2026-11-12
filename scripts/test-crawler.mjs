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
 *   5. Asset links are skipped (no visit, no junk `<asset>.html`), while
 *      dotted page routes (`/docs/v1.2`) keep being crawled.
 *   6. Existing public HTML is preserved and not requested from the router;
 *      HTML-suffixed routes without a public file still get discovered.
 *   7. Only the configured 404 page is written for a 404 response.
 *
 * Run: pnpm run test:crawler
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
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

  // --- 5: asset links skipped; dotted page routes keep crawling -----------
  {
    const pages = new Map([
      [
        "/page-0",
        `<a href="/_markopress/image/ab12/pic.png">original</a> <a href="/docs/v1.2">dotted</a>`,
      ],
      ["/docs/v1.2", `<a href="/page-0">back</a>`],
    ]);
    const visits = [];
    const makeRequest = async (request) => {
      const p = new URL(request.url).pathname;
      visits.push(p);
      const body = pages.get(p);
      if (body === undefined) return new Response("nope", { status: 404 });
      return new Response(`<!DOCTYPE html><html><body>${body}</body></html>`, {
        headers: { "content-type": "text/html" },
      });
    };
    const crawler = createCrawler(makeRequest, {
      out: path.join(out, "d"),
      notFoundPath: "/404",
    });
    await crawler.crawl(["/page-0"]);
    // The asset link is never fetched…
    assert.ok(
      !visits.includes("/_markopress/image/ab12/pic.png"),
      "asset link was visited",
    );
    // …while a dotted page route discovered via <a> still is.
    assert.ok(visits.includes("/docs/v1.2"), "dotted page route not visited");
    // And nothing wrote a junk 404 document next to where the asset belongs.
    const written = readdirSync(path.join(out, "d"), { recursive: true });
    assert.ok(
      !written.some((f) => String(f).includes("pic.png")),
      `junk asset html written: ${written.filter((f) => String(f).includes("pic.png"))}`,
    );
    console.log("  asset-link skip + dotted-route crawl ✓");
  }

  // --- 6: copied public HTML is not a router page -------------------------
  {
    const dest = path.join(out, "public-html");
    mkdirSync(path.join(dest, "legal"), { recursive: true });
    const publicFiles = new Map([
      ["privacy_policy.html", "<!DOCTYPE html><p>Public privacy policy</p>"],
      ["terms_of_service.html", "<!DOCTYPE html><p>Public terms</p>"],
      ["legal/privacy policy.htm", "<!DOCTYPE html><p>Nested public policy</p>"],
    ]);
    for (const [file, body] of publicFiles) {
      writeFileSync(path.join(dest, file), body);
    }
    const visits = [];
    const crawler = createCrawler(async (request) => {
      const p = new URL(request.url).pathname;
      visits.push(p);
      if (p === "/") {
        return new Response(`
          <a href="/privacy_policy.html">Privacy</a>
          <a href="/terms_of_service.html?lang=en#terms">Terms</a>
          <a href="/legal/privacy%20policy.htm">Nested</a>
          <a href="/generated.html">Real HTML-suffixed route</a>
        `, { headers: { "content-type": "text/html" } });
      }
      if (p === "/generated.html") {
        return new Response("<p>Generated route</p>", {
          headers: { "content-type": "text/html" },
        });
      }
      return new Response("<p>Not found</p>", {
        status: 404,
        headers: { "content-type": "text/html" },
      });
    }, { out: dest, notFoundPath: "/404" });
    const results = await crawler.crawl(["/"]);
    assert.deepEqual(visits.sort(), ["/", "/404", "/generated.html"]);
    assert.equal(results.notFound.length, 0, "public HTML reported as missing");
    for (const [file, body] of publicFiles) {
      assert.equal(readFileSync(path.join(dest, file), "utf8"), body);
      assert.ok(!existsSync(path.join(dest, file + ".html")), `${file}.html written`);
    }
    assert.ok(results.success.some(({ path, file }) => path === "/generated.html" && file));
    // Explicit routes remain authoritative even when a copied public file
    // has the same URL: seed paths must not be filtered like discovered links.
    const seededVisits = [];
    const seededCrawler = createCrawler(async (request) => {
      seededVisits.push(new URL(request.url).pathname);
      return new Response("<p>Explicit route</p>", {
        headers: { "content-type": "text/html" },
      });
    }, { out: dest });
    const seeded = await seededCrawler.crawl(["/privacy_policy.html"]);
    assert.deepEqual(seededVisits, ["/privacy_policy.html"]);
    assert.equal(seeded.success.length, 1);
    assert.equal(readFileSync(seeded.success[0].file, "utf8"), "<p>Explicit route</p>");
    assert.equal(readFileSync(path.join(dest, "privacy_policy.html"), "utf8"), publicFiles.get("privacy_policy.html"));
    console.log("  public HTML preserved + HTML-suffixed route discovery + explicit seeds ✓");
  }

  // --- 7: missing links stay diagnostic-only; configured 404 still writes --
  for (const notFoundPath of ["/404", "/404/"]) {
    const dest = path.join(out, notFoundPath.endsWith("/") ? "404-slash" : "404");
    const crawler = createCrawler(async (request) => {
      const p = new URL(request.url).pathname;
      return new Response(p === "/"
        ? '<a href="/missing-page">Broken page</a><a href="/missing.html">Missing HTML</a>'
        : "<p>Not found</p>", {
        status: p === "/" ? 200 : 404,
        headers: { "content-type": "text/html" },
      });
    }, { out: dest, notFoundPath });
    const results = await crawler.crawl(["/"]);
    assert.deepEqual(results.notFound.map(({ path }) => path).sort(), ["/missing-page", "/missing.html"]);
    assert.deepEqual(results.records.map(({ path }) => path).sort(), ["/missing-page", "/missing.html"]);
    assert.ok(results.notFound.every(({ file }) => file === undefined), "404 response wrote a junk page");
    const notFoundFile = path.join(dest, notFoundPath.endsWith("/") ? "404/index.html" : "404.html");
    assert.equal(readFileSync(notFoundFile, "utf8"), "<p>Not found</p>");
    assert.ok(!existsSync(path.join(dest, "missing-page.html")));
    assert.ok(!existsSync(path.join(dest, "missing.html.html")));
  }
  console.log("  only configured 404 page written (with/without trailing slash) ✓");

  console.log("crawler tests: all passed");
} finally {
  rmSync(out, { recursive: true, force: true });
}
