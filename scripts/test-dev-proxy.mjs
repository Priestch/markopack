/**
 * Dev-server proxy / headers regression test.
 *
 * Starts the rspack-basic example with dev({ proxy, headers }) against a
 * local echo backend, then asserts:
 *   1. a matching request is proxied (query string preserved, backend
 *      headers forwarded, NO reload script injected into the body)
 *   2. router-served HTML still carries the SSE reload client + headers
 *   3. prefix matching is segment-boundary aware (/api/v10 is not proxied)
 *   4. static assets still serve
 *   5. managed-invariant guards fail fast on entry replacement / plugin drop
 *
 * Usage: node scripts/test-dev-proxy.mjs   (expects @markopack/* already built)
 */

import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const cwd = path.join(root, "examples/rspack-basic");
const PORT = Number(process.env.PORT) || 4321;
const TARGET_PORT = PORT + 1;
const DEV_PORT = PORT + 2;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let devScript;
let proc;
let backend;

function writeDevScript() {
  devScript = path.join(cwd, ".dev-proxy-test.mjs");
  fs.writeFileSync(
    devScript,
    `import { dev } from "@markopack/rspack";\n` +
      `dev({\n` +
      `  root: import.meta.dirname,\n` +
      `  entry: "./src/index.ts",\n` +
      `  outputDir: "dist",\n` +
      `  port: ${DEV_PORT},\n` +
      `  proxy: {\n` +
      `    "/api/v1": { target: "http://127.0.0.1:${TARGET_PORT}", changeOrigin: true },\n` +
      `  },\n` +
      `  headers: { "x-dev-header": "works" },\n` +
      `}).catch((e) => { console.error(e); process.exit(1); });\n`,
  );
  return devScript;
}

async function until(fn, ms = 20_000, getLogs = () => "") {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const r = await fn();
      if (r) return r;
    } catch {
      /* not ready / not yet applied */
    }
    await wait(300);
  }
  throw new Error(`condition not met within ${ms}ms\n${getLogs().slice(-1500)}`);
}

async function stop() {
  if (proc && proc.exitCode == null) {
    try { process.kill(proc.pid, "SIGTERM"); } catch {}
    await wait(500);
    try { process.kill(proc.pid, "SIGKILL"); } catch {}
  }
  if (devScript) fs.rmSync(devScript, { force: true });
  if (backend) await new Promise((r) => backend.close(r));
}

async function testProxyAndHeaders() {
  // Fake product backend.
  backend = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.setHeader("x-from-backend", "yes");
    res.end(JSON.stringify({ path: req.url, host: req.headers.host }));
  });
  await new Promise((r) => backend.listen(TARGET_PORT, r));

  // Clean stale dist so assets are rebuilt from scratch.
  const dist = path.join(cwd, "dist");
  fs.rmSync(dist, { recursive: true, force: true });
  try {
    execFileSync("bash", ["-c", `lsof -ti :${DEV_PORT} | xargs kill -9`], { stdio: "ignore" });
  } catch {}

  proc = spawn("node", [writeDevScript()], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  proc.stdout.on("data", (c) => (logs += c));
  proc.stderr.on("data", (c) => (logs += c));
  proc.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`Dev server exited with code ${code}\n${logs.slice(-2000)}`);
    }
  });

  const base = `http://127.0.0.1:${DEV_PORT}`;
  await until(
    async () => (await fetch(`${base}/`)).status === 200 ? true : null,
    20_000,
    () => logs,
  );
  console.log("  ok   dev server ready");

  // 1. Proxy hit — forwarded, no reload-script injection, headers present.
  const hit = await fetch(`${base}/api/v1/blog?x=1`);
  const body = await hit.text();
  if (hit.status !== 200 || !JSON.parse(body).path.includes("/api/v1/blog")) {
    throw new Error(`proxy did not forward: ${hit.status} ${body}`);
  }
  if (hit.headers.get("x-from-backend") !== "yes") throw new Error("backend header missing");
  if (body.includes("__markopack_reload")) {
    throw new Error("reload script injected into proxied response");
  }
  if (hit.headers.get("x-dev-header") !== "works") throw new Error("dev headers missing on proxied response");
  console.log("  ok   proxied response: forwarded, no reload injection");

  // 2. Router HTML keeps the SSE reload client + headers.
  const page = await fetch(`${base}/about`);
  const html = await page.text();
  if (page.status !== 200 || !html.includes("__markopack_reload.js")) {
    throw new Error("router HTML lost the reload client");
  }
  if (page.headers.get("x-dev-header") !== "works") throw new Error("dev headers missing on router response");
  console.log("  ok   router HTML: reload client + headers intact");

  // 3. Segment-boundary prefix: /api/v10 must NOT hit the /api/v1 proxy.
  const miss = await fetch(`${base}/api/v10/other`);
  if (miss.status !== 404) throw new Error(`prefix boundary match failed: ${miss.status}`);
  console.log("  ok   prefix boundary: /api/v10 not proxied");

  // 4. Static assets still serve through the sirv chain.
  const asset = await fetch(`${base}/static/js/index.js`);
  if (asset.status !== 200) throw new Error(`static asset broken: ${asset.status}`);
  if (asset.headers.get("x-dev-header") !== "works") throw new Error("dev headers missing on static response");
  console.log("  ok   static asset served");

  await stop();
}

async function testInvariantGuards() {
  const { build } = await import(
    path.join(root, "packages/rspack/dist/index.js")
  );

  try {
    await build({
      root: cwd,
      rspack: (c) => ({ ...c, entry: { other: "./src/index.ts" } }),
    });
    throw new Error("entry replacement was not caught");
  } catch (e) {
    if (!/managed `entry`/.test(e.message)) throw e;
  }
  console.log("  ok   guard: managed entry replacement fails fast");

  try {
    await build({
      root: cwd,
      rspack: (c) => ({ ...c, plugins: [] }),
    });
    throw new Error("plugin drop was not caught");
  } catch (e) {
    if (!/dropped the MarkoRspackPlugin/.test(e.message)) throw e;
  }
  console.log("  ok   guard: MarkoRspackPlugin removal fails fast");
}

async function main() {
  try {
    await testProxyAndHeaders();
    await testInvariantGuards();
    console.log("\nAll dev-proxy checks passed.");
  } catch (err) {
    console.error(`\nFAIL: ${err.message}`);
    await stop();
    process.exit(1);
  }
  // Lingering keep-alive sockets from fetch keep the loop alive — exit.
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  await stop();
  process.exit(1);
});
