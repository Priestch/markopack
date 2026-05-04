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
  proc.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => proc.once("exit", resolve)), wait(2000)]);
  if (proc.exitCode == null) {
    proc.kill("SIGKILL");
    await Promise.race([new Promise((resolve) => proc.once("exit", resolve)), wait(2000)]);
  }
}

async function main() {
  const cwd = path.join(root, "examples/rspack-basic");
  const distPath = path.join(cwd, "dist");
  if (fs.existsSync(distPath)) fs.rmSync(distPath, { recursive: true, force: true });

  // Kill any stale process on the test port
  try { execFileSync("bash", ["-c", `lsof -ti :${PORT} | xargs kill -9`], { stdio: "ignore" }); } catch {}

  console.log("Starting rspack dev server...");
  const proc = spawn("npm", ["run", "dev"], {
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

  await stopProcess(proc);

  console.log(`\n  ${passed} passed, ${failed} failed, ${ROUTES.length} total`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
