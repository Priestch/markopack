/**
 * Fixture-suite orchestrator — spawns one child per fixture per mode so
 * per-fixture globals never bleed (see test/harness/run-fixture.mjs).
 *
 * Usage:  node scripts/test-fixtures.mjs
 * Env:    FIXTURE_MODE=preview|dev|both   (default both; CI sets preview)
 *         FIXTURES=<glob>                 (filter, e.g. "basic-*")
 *         UPDATE_SNAPSHOTS=1              (passthrough: regenerate snapshots)
 *         FIXTURE_TIMEOUT_MS              (per fixture+mode, default 90000)
 *
 * Exit codes follow the house style: 0 all pass, 1 any fail.
 * Fixture-worker exit 3 means skip (skip_dev/skip_preview).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturesRoot = path.join(root, "test", "fixtures");
const worker = path.join(root, "test", "harness", "run-fixture.mjs");

const modeEnv = process.env.FIXTURE_MODE || "both";
const modes = modeEnv === "both" ? ["preview", "dev"] : [modeEnv];
const filter = process.env.FIXTURES || null;
const timeoutMs = Number(process.env.FIXTURE_TIMEOUT_MS) || 90_000;

function fixtureNames() {
  const names = fs
    .readdirSync(fixturesRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .filter((n) => fs.existsSync(path.join(fixturesRoot, n, "test.config.ts")))
    .sort();
  if (!filter) return names;
  const re = new RegExp("^" + filter.replaceAll(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
  return names.filter((n) => re.test(n));
}

// Fixture configs are .ts files loaded with a dynamic import. Default-on
// type stripping needs Node >= 22.18 / 23.6; on older 22.x/23.x the flag
// exists but is opt-in. This machine has several Node installs (fnm), so
// the resolving version can vary per shell — normalize here instead of
// trusting the caller's node.
function stripTypesArgs() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  const needsFlag =
    (major === 22 && minor < 18) || (major === 23 && minor < 6);
  if (!needsFlag) return [];
  return ["--experimental-strip-types"];
}

function runWorker(fixtureDir, mode) {
  const flagArgs = stripTypesArgs();
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [...flagArgs, worker, fixtureDir, mode], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: flagArgs.length
        ? {
            ...process.env,
            // Grandchildren (rspack workers, dev servers) inherit too.
            NODE_OPTIONS: [
              process.env.NODE_OPTIONS,
              ...flagArgs,
            ].filter(Boolean).join(" "),
          }
        : process.env,
    });
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
    }, timeoutMs);
    proc.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

async function main() {
  const names = fixtureNames();
  if (names.length === 0) {
    console.error(`no fixtures found in test/fixtures/${filter ? `matching "${filter}"` : ""}`);
    process.exit(1);
  }

  console.log(`fixtures: ${names.length} × [${modes.join(", ")}]\n`);
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const failures = [];

  for (const name of names) {
    for (const mode of modes) {
      const label = `${name} [${mode}]`;
      const t0 = Date.now();
      const { code, out } = await runWorker(path.join(fixturesRoot, name), mode);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (code === 0) {
        passed++;
        console.log(`  ok    ${label} (${secs}s)`);
      } else if (code === 3) {
        skipped++;
        console.log(`  skip  ${label} (config)`);
      } else {
        failed++;
        failures.push({ label, out });
        console.log(`  FAIL  ${label} (${secs}s)`);
      }
    }
  }

  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
  if (failures.length) {
    for (const { label, out } of failures) {
      console.error(`\n===== ${label} =====\n${out.slice(-4000)}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
