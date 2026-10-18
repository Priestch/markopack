/**
 * `Run.href` browser support verification: production build of the
 * rspack-basic example, then SSR + artifact + (when a headless Chrome is
 * available) real browser assertions.
 *
 * Covers the window.Run bootstrap end to end:
 *   - SSR output of /about carries a link whose href was built by
 *     `Run.href` at render time (server-side globalThis.Run, set by the
 *     aliased @marko/run internal runtime),
 *   - every browser entry chunk embeds the @marko/run client runtime (the
 *     `window.Run ||= { href }` bootstrap) — checked via a stable marker
 *     from the bundled url-builder source,
 *   - in a real browser the hydrated probe component computes
 *     `Run.href("/products/$id", { params: { id: "42" } })` client-side and
 *     writes it to data-run-href — skipped when Chrome is missing.
 *
 * Usage:
 *   node scripts/test-run-href.mjs
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const cwd = path.join(root, "examples/rspack-basic");
const PORT = Number(process.env.PORT) || 4211;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopProcess(proc) {
  if (proc.exitCode != null) return;
  try { process.kill(-proc.pid, "SIGTERM"); } catch {}
  await Promise.race([new Promise((resolve) => proc.once("exit", resolve)), wait(2000)]);
  try { process.kill(-proc.pid, "SIGKILL"); } catch {}
  await Promise.race([new Promise((resolve) => proc.once("exit", resolve)), wait(2000)]);
}

function ok(name) {
  console.log(`  ok   ${name}`);
}

let failed = false;

function fail(name, detail) {
  console.error(`  FAIL ${name}${detail ? `: ${detail}` : ``}`);
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
        html = await (await fetch(`http://127.0.0.1:${PORT}/about`)).text();
      } catch {}
    }
    if (!html) {
      fail("preview server responded");
      return;
    }

    // 1. SSR-side Run.href: the typed link's href was resolved at render
    //    time by globalThis.Run (set when the server runtime loaded).
    //    Marko's HTML serializer omits quotes on simple values, so accept
    //    both href=/products/17 and href="/products/17".
    /href=(["']?)\/products\/17\1[\s>]/.test(html)
      ? ok("SSR Run.href resolves /products/$id → /products/17")
      : fail("SSR Run.href resolves /products/$id → /products/17", "href=/products/17 missing from /about HTML");

    // 2. Browser chunks embed the window.Run bootstrap. The bundled
    //    url-builder carries parsePathParts + its "/$" scanning literal —
    //    a stable minification-resistant marker (string literal, and the
    //    parse loop reads it).
    const jsDir = path.join(cwd, "dist/client/static/js");
    const jsFiles = fs.readdirSync(jsDir).filter((f) => f.endsWith(".js"));
    const withBootstrap = jsFiles.filter((f) =>
      fs.readFileSync(path.join(jsDir, f), "utf8").includes('"/$"'),
    );
    withBootstrap.length > 0
      ? ok(`window.Run bootstrap bundled into ${withBootstrap.length} chunk(s)`)
      : fail("window.Run bootstrap bundled", "no client chunk contains the url-builder source");

    // 3. Real-browser check: the hydrated probe computes Run.href
    //    client-side and writes /products/42 to data-run-href.
    if (fs.existsSync("/usr/bin/google-chrome")) {
      const probe = spawn(
        process.execPath,
        [path.join(root, "scripts/headless-hydration-check.mjs"),
         `http://127.0.0.1:${PORT}/about`, ".run-href-fixture", "data-run-href", "/products/42"],
        { stdio: "inherit" },
      );
      const code = await new Promise((resolve) => probe.once("exit", resolve));
      code === 0
        ? ok("browser Run.href resolves /products/$id → /products/42 after hydration")
        : fail("browser Run.href resolves /products/$id → /products/42 after hydration");
    } else {
      console.log("  skip headless Run.href check (no /usr/bin/google-chrome)");
    }
  } finally {
    await stopProcess(proc);
  }
}

main()
  .then(() => {
    if (!failed) console.log("\nrun.href tests: all passed");
    else console.log("\nrun.href tests: FAILED");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
