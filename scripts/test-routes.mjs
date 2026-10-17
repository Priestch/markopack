/**
 * Route correctness test: starts the rspack dev server, hits every
 * route, and validates responses against expected values.
 *
 * Usage:
 *   node scripts/test-routes.mjs
 */

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const PORT = Number(process.env.PORT) || 4200;

const ROUTES = [
  // Static pages
  { path: "/", method: "GET", expect: { status: 200, contains: ["route atlas", "Explore routes", "Static page", "Dynamic slug"] } },
  { path: "/about", method: "GET", expect: { status: 200, contains: ["About", "static directory route"] } },
  { path: "/contact", method: "GET", expect: { status: 200, contains: ["Contact", "pathless segment"] } },
  { path: "/guides/getting-started", method: "GET", expect: { status: 200, contains: ["Getting Started"] } },
  { path: "/guides/advanced/performance", method: "GET", expect: { status: 200, contains: ["Performance"] } },

  // API handlers
  { path: "/api/users", method: "GET", expect: { status: 200, json: { type: "api-users", users: [{ id: 1, name: "Ada" }, { id: 2, name: "Linus" }] } } },
  { path: "/", method: "POST", expect: { status: 201, contains: ["Created!"] } },

  // Handler verb detection via export specifiers / TS annotations
  // (scripts/test-routes.mjs — see detectHandlerVerbs in @markopack/rspack)
  { path: "/api/aliased", method: "GET", expect: { status: 200, json: { type: "api-aliased", message: "Aliased exports" } } },
  { path: "/api/aliased", method: "POST", expect: { status: 201, contains: ["Aliased POST"] } },
  { path: "/api/typed", method: "GET", expect: { status: 200, json: { type: "api-typed", url: "/api/typed" } } },
  // DELETE only "exists" inside a comment — must not be registered
  { path: "/api/typed", method: "DELETE", expect: { status: 404 } },

  // Dynamic routes
  { path: "/blog/hello-world", method: "GET", expect: { status: 200, json: { type: "blog-post", params: { slug: "hello-world" }, message: "Dynamic segment route" } } },
  { path: "/products/books/42", method: "GET", expect: { status: 200, json: { type: "product", params: { category: "books", id: "42" }, message: "Nested dynamic segments route" } } },
  { path: "/docs/setup/install", method: "GET", expect: { status: 200, json: { type: "docs-catch-all", params: { rest: "setup/install" }, message: "Catch-all dynamic route" } } },

  // 404 for unknown routes
  { path: "/nonexistent", method: "GET", expect: { status: 404 } },
];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopProcess(proc) {
  if (proc.exitCode != null) return;
  // proc is detached with shell:true, so it leads its own process group —
  // kill the whole group or the dev-server grandchild survives.
  try { process.kill(-proc.pid, "SIGTERM"); } catch {}
  await Promise.race([new Promise((resolve) => proc.once("exit", resolve)), wait(2000)]);
  if (proc.exitCode != null) return;
  try { process.kill(-proc.pid, "SIGKILL"); } catch {}
  await Promise.race([new Promise((resolve) => proc.once("exit", resolve)), wait(2000)]);
}

async function main() {
  const cwd = path.join(root, "examples/rspack-basic");
  const distPath = path.join(cwd, "dist");
  if (fs.existsSync(distPath)) fs.rmSync(distPath, { recursive: true, force: true });

  // Plant stale generated files whose source routes no longer exist —
  // route discovery must clean them out of .marko-run on startup.
  const markoRunDir = path.join(cwd, ".marko-run");
  fs.mkdirSync(markoRunDir, { recursive: true });
  const staleFiles = [
    path.join(markoRunDir, "__marko-run__stale-probe.js"),
    path.join(markoRunDir, "stale-probe.marko"),
  ];
  for (const file of staleFiles) fs.writeFileSync(file, "// stale\n");

  // Kill any stale process on the test port
  try { execFileSync("bash", ["-c", `lsof -ti :${PORT} | xargs kill -9`], { stdio: "ignore" }); } catch {}

  console.log("Starting rspack dev server...");
  const proc = spawn("pnpm", ["run", "dev"], {
    cwd,
    shell: true,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(PORT) },
  });

  let logs = "";
  proc.stdout.on("data", (chunk) => { logs += String(chunk); });
  proc.stderr.on("data", (chunk) => { logs += String(chunk); });

  // Wait for server to be ready
  let port = PORT;
  for (let i = 0; i < 60; i++) {
    const allPorts = [...logs.matchAll(/http:\/\/localhost:(\d+)/g)].map((m) => Number(m[1]));
    const detected = allPorts.length ? allPorts[allPorts.length - 1] : PORT;
    port = detected;

    try {
      const res = await fetch(`http://127.0.0.1:${detected}/`);
      if (res.status === 200) break;
    } catch {
      // not ready
    }
    await wait(500);
  }

  console.log(`  ready on port ${port}`);

  const staleLeft = staleFiles.filter((f) => fs.existsSync(f));
  if (staleLeft.length) {
    console.error(`  FAIL stale .marko-run files survived: ${staleLeft.map((f) => path.basename(f)).join(", ")}`);
    await stopProcess(proc);
    process.exitCode = 1;
    return;
  }
  console.log("  ok   stale .marko-run files cleaned");

  console.log(`\nTesting ${ROUTES.length} routes...\n`);

  let passed = 0;
  let failed = 0;

  for (const route of ROUTES) {
    const url = `http://127.0.0.1:${port}${route.path}`;
    let res;
    try {
      res = await fetch(url, { method: route.method });
    } catch (err) {
      console.log(`  FAIL ${route.method} ${route.path}  (fetch error: ${err.message})`);
      failed++;
      continue;
    }

    const text = await res.text();
    const errors = [];

    if (res.status !== route.expect.status) {
      errors.push(`status ${res.status} (expected ${route.expect.status})`);
    }

    if (route.expect.contains) {
      for (const s of route.expect.contains) {
        if (!text.includes(s)) errors.push(`missing "${s}"`);
      }
    }

    if (route.expect.json) {
      try {
        const json = JSON.parse(text);
        for (const [key, value] of Object.entries(route.expect.json)) {
          if (JSON.stringify(json[key]) !== JSON.stringify(value)) {
            errors.push(`json.${key}: got ${JSON.stringify(json[key])}, expected ${JSON.stringify(value)}`);
          }
        }
      } catch {
        errors.push(`not JSON: ${text.slice(0, 100)}`);
      }
    }

    if (errors.length === 0) {
      console.log(`  ok   ${route.method} ${route.path}`);
      passed++;
    } else {
      console.log(`  FAIL ${route.method} ${route.path}`);
      for (const e of errors) console.log(`       ${e}`);
      failed++;
    }
  }

  // Component <style> blocks must survive compilation: /about mounts
  // style-probe.marko (a nested component with a plain <style>), whose rule
  // has to reach the browser via an extracted stylesheet linked from the
  // SSR HTML — not be silently dropped by the translator.
  {
    const res = await fetch(`http://127.0.0.1:${port}/about`);
    const html = await res.text();
    const href = html.match(/<link rel="stylesheet" href="([^"]+\.css)"/)?.[1];
    const errors = [];
    if (!href) {
      errors.push("no stylesheet link in SSR HTML");
    } else {
      const css = await (await fetch(`http://127.0.0.1:${port}${href}`)).text();
      if (!css.includes(".style-probe-nested-component p")) {
        errors.push(`probe rule missing from ${href}`);
      }
    }
    if (errors.length) {
      console.log("  FAIL component <style> survives to extracted css");
      for (const e of errors) console.log(`       ${e}`);
      failed++;
    } else {
      console.log("  ok   component <style> survives to extracted css");
      passed++;
    }
  }

  // Extension-suffixed routes must reach the router even though the dev
  // server serves static assets first: /sitemap.xml is a handler route
  // (escaped-dot directory name), not a file in dist/client.
  {
    let ok = false;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/sitemap.xml`);
      const text = await res.text();
      ok = res.status === 200 && text.includes("<urlset");
    } catch {}
    console.log(`  ${ok ? "ok  " : "FAIL"} dot-path route /sitemap.xml reaches the router`);
    ok ? passed++ : failed++;
  }

  // Asset URLs with a query string must still be served by sirv — the
  // extension check runs against the parsed pathname, and a raw-URL check
  // would send `...css?v=1` to the router (404).
  {
    let ok = false;
    try {
      const page = await (await fetch(`http://127.0.0.1:${port}/about`)).text();
      const href = page.match(/<link rel="stylesheet" href="([^"]+\.css)"/)?.[1];
      if (href) {
        const res = await fetch(`http://127.0.0.1:${port}${href}?v=abc123`);
        ok = res.status === 200 && (await res.text()).includes(".style-probe-nested-component");
      }
    } catch {}
    console.log(`  ${ok ? "ok  " : "FAIL"} asset with query string serves from dist/client`);
    ok ? passed++ : failed++;
  }

  await stopProcess(proc);

  console.log(`\n  ${passed} passed, ${failed} failed, ${passed + failed} total`);
  // Exit explicitly: lingering keep-alive sockets from fetch keep the loop alive.
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
