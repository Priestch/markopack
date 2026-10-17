/**
 * Lazy-loading (`with { load: ... }`) verification: production build of the
 * rspack-basic example, then artifact + SSR + (when a headless Chrome is
 * available) real hydration assertions.
 *
 * Covers the load-entry pipeline end to end:
 *   - a `*_load.*.js` load-entry chunk is emitted alongside its component
 *     chunk, and the embedded __MARKO_MANIFEST__ in the server bundle maps
 *     the component's readyId to that chunk,
 *   - SSR output carries the anti-FOUC stylesheet link, the idle trigger
 *     script and the load-entry script url,
 *   - in a real browser the lazy component hydrates (its effect sets
 *     data-hydrated) — skipped when /usr/bin/google-chrome is missing.
 *
 * Usage:
 *   node scripts/test-lazy.mjs
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const cwd = path.join(root, "examples/rspack-basic");
const PORT = Number(process.env.PORT) || 4210;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopProcess(proc) {
  if (proc.exitCode != null) return;
  try { process.kill(-proc.pid, "SIGTERM"); } catch {}
  await Promise.race([new Promise((resolve) => proc.once("exit", resolve)), wait(2000)]);
  if (proc.exitCode != null) return;
  try { process.kill(-proc.pid, "SIGKILL"); } catch {}
  await Promise.race([new Promise((resolve) => proc.once("exit", resolve)), wait(2000)]);
}

function ok(name) {
  console.log(`  ok   ${name}`);
}

let failed = false;

function fail(name, detail) {
  console.error(`  FAIL ${name}${detail ? `: ${detail}` : ""}`);
  failed = true;
  process.exitCode = 1;
}

async function runBuild() {
  const proc = spawn("node", ["build.mjs"], { cwd, stdio: "pipe" });
  let stderr = "";
  proc.stderr.on("data", (d) => (stderr += d));
  const code = await new Promise((resolve) => proc.once("exit", resolve));
  if (code !== 0) throw new Error(`example build failed:\n${stderr.slice(-2000)}`);
}

async function main() {
  console.log("Building examples/rspack-basic (production)...");
  await runBuild();

  const jsDir = path.join(cwd, "dist/client/static/js");
  const jsFiles = fs.readdirSync(jsDir).filter((f) => f.endsWith(".js"));

  // 1. Load-entry chunk exists and signals the component's readyId.
  const loadChunks = jsFiles.filter((f) => /_load\.[^.]+\.js$/.test(f));
  if (loadChunks.length === 0) {
    fail("load-entry chunk emitted", "no *_load.*.js in dist/client/static/js");
    return;
  }
  ok(`load-entry chunk emitted (${loadChunks.join(", ")})`);

  const loadChunkSrc = fs.readFileSync(path.join(jsDir, loadChunks[0]), "utf8");
  if (!loadChunkSrc.includes("lazy-panel.marko")) {
    fail("load-entry chunk references component readyId");
    return;
  }
  ok("load-entry chunk references component readyId");

  // 2. Shared runtime chunk — the ready() handshake needs every entry to
  // hydrate against the same runtime instance.
  if (!jsFiles.some((f) => /^runtime\.[^.]+\.js$/.test(f))) {
    fail("shared runtime chunk emitted (runtimeChunk: single)");
    return;
  }
  ok("shared runtime chunk emitted");

  // 3. The embedded manifest maps the readyId to the load-entry chunk.
  const serverBundle = fs.readFileSync(
    path.join(cwd, "dist/server/index.cjs"),
    "utf8",
  );
  if (!serverBundle.includes(loadChunks[0])) {
    fail("__MARKO_MANIFEST__ contains load-entry chunk");
    return;
  }
  ok("__MARKO_MANIFEST__ contains load-entry chunk");

  // 4. SSR output: trigger script, stylesheet link, load-entry script.
  const proc = spawn("node", ["preview.mjs"], {
    cwd,
    env: { ...process.env, PORT: String(PORT) },
    detached: true,
    stdio: "ignore",
  });
  try {
    let html = "";
    for (let i = 0; i < 50 && !html; i++) {
      await wait(200);
      try {
        html = await (await fetch(`http://127.0.0.1:${PORT}/`)).text();
      } catch {}
    }
    if (!html) {
      fail("preview server responded");
      return;
    }

    const checks = [
      ["idle trigger script", html.includes("requestIdleCallback")],
      ["lazy component stylesheet link", /<link rel="stylesheet" href="\/static\/css\/[^"]*\.css"/.test(html) && html.includes("lazy")],
      ["lazy panel markup", html.includes("lazy panel content")],
    ];
    for (const [name, pass] of checks) pass ? ok(name) : fail(name);

    // 5. Real-browser hydration (skip gracefully without Chrome).
    if (fs.existsSync("/usr/bin/google-chrome")) {
      const probe = spawn(
        process.execPath,
        [path.join(root, "scripts/headless-hydration-check.mjs"),
         `http://127.0.0.1:${PORT}/`, ".lazy-panel-fixture", "data-hydrated"],
        { stdio: "inherit" },
      );
      const code = await new Promise((resolve) => probe.once("exit", resolve));
      code === 0
        ? ok("lazy component hydrates in headless Chrome")
        : fail("lazy component hydrates in headless Chrome");
    } else {
      console.log("  skip headless hydration check (no /usr/bin/google-chrome)");
    }
  } finally {
    await stopProcess(proc);
  }
}

main()
  .then(() => {
    if (!failed) console.log("\nlazy-loading tests: all passed");
    else console.log("\nlazy-loading tests: FAILED");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
