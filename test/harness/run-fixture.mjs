/**
 * Fixture worker — runs ONE fixture in ONE mode. Spawned as a child process
 * by scripts/test-fixtures.mjs so per-fixture globals (__marko_run__,
 * __MARKO_MANIFEST__, Run) never bleed across fixtures.
 *
 * Usage: node test/harness/run-fixture.mjs <fixtureDir> <preview|dev>
 * Env:   UPDATE_SNAPSHOTS=1 to (re)generate expectations.
 *
 * Flow per fixture (port of upstream main.test.ts's testPage):
 *   - stage a scratch copy in test/.work/<name>/ (fixtures have no
 *     src/index.ts, which build()'s web entry requires — a shim is added
 *     there, keeping the synced fixture dir pristine)
 *   - preview: in-process build() + startPreviewServer()
 *   - dev: in-process dev() + poll until the router stops answering 503
 *   - drive a BrowserPage through the upstream snapshot flow:
 *     "# Loading" from pristine server HTML, then post-hydration HTML, then
 *     one diff section per step; non-HTML responses snapshot the body text.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, dev } from "@markopack/rspack";
import { BrowserPage } from "./browser-page.mjs";
import { startPreviewServer } from "./preview-server.mjs";
import {
  normalizeHTML,
  htmlSnapshot,
  getStepString,
  compareOrWriteSnapshot,
} from "./snapshot.mjs";

const debug = process.env.DEBUG_FIXTURE === "1";
const dbg = (...args) => debug && console.error("[fixture]", ...args);

const here = path.dirname(fileURLToPath(import.meta.url));
const testRoot = path.resolve(here, "..");
const workspaceRoot = path.resolve(testRoot, "..");

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory()) copyDir(path.join(from, entry.name), path.join(to, entry.name));
    else fs.copyFileSync(path.join(from, entry.name), path.join(to, entry.name));
  }
}

/**
 * Upstream fixtures target Marko 5, where relative tags are auto-discovered
 * from `components/` directories. Marko 6 discovers them from `tags/` only
 * (see the Marko 5–6 interop guide), so staged copies get the directories
 * renamed and explicit `components/` import specifiers rewritten. Tag names
 * derive from file basenames, so rendered output is unaffected.
 */
function migrateComponentsToTags(srcDir) {
  const dirs = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "components") dirs.push(path.join(dir, entry.name));
      else walk(path.join(dir, entry.name));
    }
  })(srcDir);
  if (!dirs.length) return;
  for (const dir of dirs) fs.renameSync(dir, dir.replace(/components$/, "tags"));
  (function rewrite(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) rewrite(full);
      else if (/\.(marko|ts|js|mjs)$/.test(entry.name)) {
        const text = fs.readFileSync(full, "utf8");
        const next = text.replaceAll(/(["'])((?:\.\.?\/)+)components\//g, "$1$2tags/");
        if (next !== text) fs.writeFileSync(full, next);
      }
    }
  })(srcDir);
}

async function loadConfig(fixtureDir) {
  const sidecarPath = path.join(fixtureDir, "markopack.test.mjs");
  const sidecar = fs.existsSync(sidecarPath)
    ? (await import(sidecarPath)).default
    : {};
  const config = await import(path.join(fixtureDir, "test.config.ts"));
  return { sidecar, config };
}

async function startServer(mode, scratch, sidecar) {
  if (mode === "preview") {
    await build({
      root: scratch,
      entry: "./src/index.ts",
      outputDir: "dist",
      mode: "production",
      adapter: sidecar.adapter ?? null,
      rspack: sidecar.rspack,
    });
    const server = await startPreviewServer({ root: scratch });
    return { port: server.port, close: () => server.close() };
  }

  const server = await dev({
    root: scratch,
    entry: "./src/index.ts",
    outputDir: "dist",
    port: 0,
    adapter: sidecar.adapter ?? null,
    rspack: sidecar.rspack,
  });

  // The dev router answers 503 until the first server bundle is ready.
  const base = `http://127.0.0.1:${server.port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    const res = await fetch(base).catch(() => null);
    if (res && res.status !== 503) break;
    if (Date.now() > deadline) throw new Error("dev server did not become ready");
    await new Promise((r) => setTimeout(r, 250));
  }
  return { port: server.port, close: () => server.close() };
}

async function testPage(page, { fixtureDir, pathname, steps, referer, base }) {
  const norm = (html) =>
    normalizeHTML(html, { fixtureRoot: fixtureDir, workspaceRoot });

  let snapshot = "# Loading\n\n";
  let prevHtml = "";

  const url = new URL(pathname, base);
  const referrerUrl = referer
    ? referer instanceof URL
      ? referer
      : new URL(referer, url)
    : undefined;

  await page.goto(url.href, { referer: referrerUrl?.href });

  if (page.window) {
    // Pre-hydration markup, from the pristine server response.
    prevHtml = norm(page.serializeServerHTML(page.serverHTML));
    snapshot += htmlSnapshot(prevHtml);

    const finalHtml = norm(getHTML(page));
    if (finalHtml !== prevHtml) {
      snapshot += htmlSnapshot(finalHtml, prevHtml);
      prevHtml = finalHtml;
    }

    for (const [i, step] of steps.entries()) {
      snapshot += `# Step ${i}\n${getStepString(step)}\n\n`;
      await step({ page, response: page.response });
      const html = norm(getHTML(page));
      if (html === prevHtml) continue;
      snapshot += htmlSnapshot(html, prevHtml);
      prevHtml = html;
    }
  } else {
    snapshot += "```\n" + (await page.response.text()) + "\n```\n\n";
  }

  return snapshot;
}

function getHTML(page) {
  const { document } = page;
  return (document.getElementById("app") || document.body)?.innerHTML || "";
}

async function main() {
  const [fixtureDirArg, mode] = process.argv.slice(2);
  if (!fixtureDirArg || !["preview", "dev"].includes(mode)) {
    throw new Error("usage: run-fixture.mjs <fixtureDir> <preview|dev>");
  }
  const fixtureDir = path.resolve(fixtureDirArg);
  const name = path.basename(fixtureDir);

  const { sidecar, config } = await loadConfig(fixtureDir);
  if (mode === "dev" && config.skip_dev) return process.exit(3);
  if (mode === "preview" && config.skip_preview) return process.exit(3);

  // Upstream parity: fixture output must not depend on proxy headers.
  process.env.TRUST_PROXY = "1";

  const scratch = path.join(testRoot, ".work", name);
  fs.rmSync(scratch, { recursive: true, force: true });
  copyDir(path.join(fixtureDir, "src"), path.join(scratch, "src"));
  migrateComponentsToTags(path.join(scratch, "src"));
  // Web-entry shim — fixtures only ship src/routes/**.
  fs.writeFileSync(path.join(scratch, "src", "index.ts"), "");

  const steps = config.steps
    ? Array.isArray(config.steps)
      ? config.steps
      : [config.steps]
    : [];
  const pathname = config.path || "/";

  const page = new BrowserPage();
  dbg("staged; starting server", mode);
  const server = await startServer(mode, scratch, sidecar);
  dbg("server up on", server.port);
  try {
    const snapshot = await testPage(page, {
      fixtureDir,
      pathname,
      steps,
      referer: config.referer,
      base: `http://127.0.0.1:${server.port}`,
    });
    dbg("testPage done, snapshot bytes:", snapshot.length);
    const result = compareOrWriteSnapshot({ fixtureDir, mode, content: snapshot });
    if (!result.ok) {
      console.error(result.report);
      process.exitCode = 1;
    } else if (result.written) {
      console.log(`snapshot written: __snapshots__/${mode}.expected.md`);
    }
  } finally {
    await page.close().catch(() => {});
    await server.close().catch(() => {});
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

// Explicit exit: preview keep-alive sockets and rspack handles keep the loop
// alive after the work is done (same reason smoke-example.mjs exits by hand).
main().then(
  () => process.exit(process.exitCode || 0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
