/**
 * Dev route-watch test: verifies the "re-generate × re-walk" orchestration
 * in packages/rspack (watch-routes.ts + per-side VirtualModulesPlugin).
 *
 * Scenarios:
 *   1. add a new route file      -> hot-discovered via writeModule
 *   2. edit that route file      -> updated via Rspack's native watcher
 *   3. delete the route file     -> 404 after router regeneration
 *   4. edit a pre-existing route -> regression: native path still works
 *   5. same-batch: new route + layout edit (marko-run deadlock scenario
 *      ported to Rspack) -> new route serves, no request hangs
 *
 * Every request is latency-checked; any single request > 5s is treated as
 * a deadlock symptom and fails the run.
 *
 * Usage:
 *   node scripts/test-dev-watch.mjs   (expects @markopack/* already built)
 */

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const cwd = path.join(root, "examples/rspack-basic");
const routesDir = path.join(cwd, "src", "routes");
const PORT = Number(process.env.PORT) || 4210;

const POLL_TIMEOUT_MS = 15_000;
const SLOW_REQUEST_MS = 5_000;

const MARKO_RUN_DIR = path.join(cwd, ".marko-run");
const ROUTER_FILE = path.join(MARKO_RUN_DIR, "__marko-run__router.js");

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

// ---- file mutation tracking (restore exactly, leave no dirt) ----

const saved = new Map(); // absolute file -> original content, or null if it didn't exist

function mutateFile(file, content) {
  if (!saved.has(file)) {
    saved.set(file, fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : null);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function deleteFile(file) {
  if (!saved.has(file)) {
    saved.set(file, fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : null);
  }
  try { fs.rmSync(path.dirname(file), { recursive: true, force: true }); } catch {}
}

function restoreAll() {
  for (const [file, original] of [...saved].reverse()) {
    try {
      if (original === null) {
        fs.rmSync(path.dirname(file), { recursive: true, force: true });
      } else {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, original);
      }
    } catch (err) {
      console.error(`  restore failed for ${file}:`, err);
    }
  }
  saved.clear();
}

// ---- request helpers with latency watchdog ----

let slowRequests = 0;

async function timedFetch(url) {
  const start = Date.now();
  const res = await fetch(url);
  const text = await res.text();
  const elapsed = Date.now() - start;
  if (elapsed > SLOW_REQUEST_MS) {
    slowRequests++;
    console.log(`  ! SLOW request ${url} took ${elapsed}ms (>${SLOW_REQUEST_MS}ms — deadlock symptom)`);
  }
  return { status: res.status, text, elapsed };
}

function describe(res) {
  if (!res) return "no response";
  if (res.error) return `error: ${res.error.message}`;
  return `status ${res.status}, body: ${res.text.slice(0, 120).replace(/\n/g, " ")}`;
}

async function pollUntil(label, url, check, timeoutMs = POLL_TIMEOUT_MS) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    try {
      last = await timedFetch(url);
      if (check(last)) {
        console.log(`  ok   ${label} (${Date.now() - start}ms)`);
        return last;
      }
    } catch (err) {
      last = { error: err };
    }
    await wait(250);
  }
  throw new Error(
    `${label}: condition not met within ${timeoutMs}ms — last: ${describe(last)}\n` +
    watcherDiagnostics(),
  );
}

function watcherDiagnostics() {
  const lines = ["  [diagnostics]"];
  try {
    const router = fs.readFileSync(ROUTER_FILE, "utf-8");
    const stat = fs.statSync(ROUTER_FILE);
    lines.push(
      `  router.js exists, mtime ${stat.mtime.toISOString()}, mentions watch-test: ${router.includes("watch-test")}`,
    );
  } catch {
    lines.push("  router.js missing — the initial route build never wrote it");
  }
  try {
    const entries = fs.readdirSync(MARKO_RUN_DIR).filter((f) => f.includes("watch-test"));
    lines.push(`  .marko-run files mentioning watch-test: ${entries.length ? entries.join(", ") : "(none)"}`);
  } catch {
    lines.push("  .marko-run dir missing");
  }
  return lines.join("\n");
}

// ---- test pages ----

const pageV1 = `<section>
  <h1>dev route watch probe</h1>
  <p>WATCH_TEST_MARKER_1</p>
</section>
`;

const pageV2 = `<section>
  <h1>dev route watch probe</h1>
  <p>WATCH_TEST_MARKER_1</p>
  <p>WATCH_TEST_MARKER_2</p>
</section>
`;

const pageBatch = `<section>
  <h1>same-batch probe</h1>
  <p>WATCH_TEST_MARKER_3</p>
</section>
`;

async function main() {
  // Clean dist so dev starts fresh
  const distPath = path.join(cwd, "dist");
  if (fs.existsSync(distPath)) fs.rmSync(distPath, { recursive: true, force: true });
  // Remove test-route leftovers from a previous failed run
  for (const dir of ["watch-test", "watch-test2"]) {
    const p = path.join(routesDir, dir);
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  }

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
  proc.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`Dev server exited with code ${code}`);
      console.error(logs.slice(-2000));
      process.exit(1);
    }
  });

  const dumpLogs = () => {
    console.error("\n  [dev server log tail]");
    console.error(logs.split("\n").slice(-40).join("\n"));
  };

  try {
    // Wait for the server to be reachable with 200 on /
    let port = PORT;
    let ready = false;
    for (let i = 0; i < 60; i++) {
      const allPorts = [...logs.matchAll(/http:\/\/localhost:(\d+)/g)].map((m) => Number(m[1]));
      if (allPorts.length) port = allPorts[allPorts.length - 1];
      if (proc.exitCode != null) throw new Error(`Dev server exited unexpectedly with code ${proc.exitCode}`);
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`);
        if (res.status === 200) { ready = true; break; }
      } catch { /* not listening yet */ }
      await wait(500);
    }
    if (!ready) throw new Error("dev server never became ready");
    const base = `http://127.0.0.1:${port}`;
    console.log(`  ready on port ${port}`);

    // 1. Add a brand-new route file — invisible to Rspack's own watcher;
    //    must be discovered via the routes watcher + writeModule.
    const watchTestPage = path.join(routesDir, "watch-test", "+page.marko");
    mutateFile(watchTestPage, pageV1);
    await pollUntil(
      "new route /watch-test -> 200 with marker 1",
      `${base}/watch-test`,
      (r) => r.status === 200 && r.text.includes("WATCH_TEST_MARKER_1"),
    );

    // 2. Edit the (now in-graph) route file — must go through Rspack's
    //    native watcher path.
    mutateFile(watchTestPage, pageV2);
    await pollUntil(
      "edited route /watch-test -> marker 2",
      `${base}/watch-test`,
      (r) => r.status === 200 && r.text.includes("WATCH_TEST_MARKER_2"),
    );

    // 3. Delete the route — router regenerates without it -> 404.
    deleteFile(watchTestPage);
    await pollUntil(
      "deleted route /watch-test -> 404",
      `${base}/watch-test`,
      (r) => r.status === 404,
    );

    // 4. Regression: editing a pre-existing route still hot-updates.
    const aboutPage = path.join(routesDir, "about", "+page.marko");
    const aboutOriginal = fs.readFileSync(aboutPage, "utf-8");
    mutateFile(aboutPage, aboutOriginal + "\n<p>ABOUT_EDIT_MARKER_X7</p>\n");
    await pollUntil(
      "regression: edited /about -> marker",
      `${base}/about`,
      (r) => r.status === 200 && r.text.includes("ABOUT_EDIT_MARKER_X7"),
    );

    // 5. Same-batch: create a new route AND edit +layout.marko in one go —
    //    the scenario that deadlocks marko-run's dev server.
    const layoutFile = path.join(routesDir, "+layout.marko");
    const layoutOriginal = fs.readFileSync(layoutFile, "utf-8");
    const batchPage = path.join(routesDir, "watch-test2", "+page.marko");
    mutateFile(batchPage, pageBatch);
    mutateFile(layoutFile, layoutOriginal + "\n<!-- dev-watch same-batch probe -->\n");
    await pollUntil(
      "same-batch: new route /watch-test2 -> 200 with marker 3",
      `${base}/watch-test2`,
      (r) => r.status === 200 && r.text.includes("WATCH_TEST_MARKER_3"),
    );
    // Layout edit applied and every prior route still answers (no hang).
    await pollUntil(
      "same-batch: /about still serves after layout edit",
      `${base}/about`,
      (r) => r.status === 200 && r.text.includes("About"),
    );

    if (slowRequests > 0) {
      throw new Error(`${slowRequests} request(s) exceeded ${SLOW_REQUEST_MS}ms — possible dev-server deadlock`);
    }

    console.log("\nAll dev-watch checks passed.");
  } catch (err) {
    console.error(`\nFAIL: ${err.message}`);
    dumpLogs();
    throw err;
  } finally {
    restoreAll();
    await stopProcess(proc);
    if (fs.existsSync(distPath)) fs.rmSync(distPath, { recursive: true, force: true });
  }

  // Exit explicitly: lingering keep-alive sockets from fetch keep the loop alive.
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
