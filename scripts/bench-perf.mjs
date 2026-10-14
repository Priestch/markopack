import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);

const fixtures = {
  vite: path.join(root, "bench/marko-run-vite"),
  rspack: path.join(root, "bench/marko-run-rspack"),
};

const resultsFile = path.join(root, "bench/results.jsonl");

function cleanFixture(cwd) {
  const cleanupPaths = [
    "dist",
    ".marko-run",
    "__marko-run__index.js",
    "__marko-run__router.js",
    "__marko-run__middleware.js",
  ];
  for (const rel of cleanupPaths) {
    const abs = path.join(cwd, rel);
    if (fs.existsSync(abs)) {
      fs.rmSync(abs, { recursive: true, force: true });
    }
  }
}

function runTimedBuild(name, cwd, buildCmd) {
  cleanFixture(cwd);
  const cmd = buildCmd || '(/usr/bin/time -f "%e" npm run build) 2>&1';
  const out = execSync(cmd, {
    cwd,
    shell: true,
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
  });

  const lines = out.trim().split(/\r?\n/).reverse();
  const timeLine = lines.find((line) => /^\d+(\.\d+)?$/.test(line.trim()));
  if (!timeLine) {
    throw new Error(`${name}: unable to parse build time`);
  }
  const seconds = Number(timeLine.trim());
  return { name, buildSeconds: seconds };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopDevProcess(proc) {
  if (proc.exitCode != null) return;

  // Kill the whole process group first (npm -> shell -> dev server).
  try {
    process.kill(-proc.pid, "SIGTERM");
  } catch {
    proc.kill("SIGTERM");
  }

  await Promise.race([new Promise((resolve) => proc.once("exit", resolve)), wait(1200)]);

  if (proc.exitCode == null) {
    try {
      process.kill(-proc.pid, "SIGKILL");
    } catch {
      proc.kill("SIGKILL");
    }
    await Promise.race([new Promise((resolve) => proc.once("exit", resolve)), wait(1200)]);
  }
}

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

// `devReadyMs` is wall-clock from process spawn (includes npm/node startup);
// `compileMs` is the time the bundler itself reports, which is the number
// comparable across fixtures.
async function measureDevReady(name, cwd, { command, args, port, readyTest, compileRegex }) {
  cleanFixture(cwd);
  const proc = spawn(command, args, {
    cwd,
    shell: true,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(port) },
  });

  let logs = "";
  proc.stdout.on("data", (chunk) => {
    logs += String(chunk);
  });
  proc.stderr.on("data", (chunk) => {
    logs += String(chunk);
  });

  const start = Date.now();

  try {
    for (let i = 0; i < 400; i++) {
      const plain = stripAnsi(logs);
      const allPorts = [...plain.matchAll(/http:\/\/localhost:(\d+)/g)].map((m) => Number(m[1]));
      const detected = allPorts.length ? allPorts[allPorts.length - 1] : undefined;

      if (readyTest(plain) && detected) {
        const compileMatch = plain.match(compileRegex);
        return {
          name,
          devReadyMs: Date.now() - start,
          compileMs: compileMatch ? Number(compileMatch[1]) : undefined,
          port: detected,
        };
      }
      await wait(50);
    }
    const tail = logs.slice(-1200);
    throw new Error(`${name}: dev server did not become ready in time\n${tail}`);
  } finally {
    await stopDevProcess(proc);
  }
}

function gitInfo() {
  try {
    const sha = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim();
    const dirty = execSync("git status --porcelain", { cwd: root, encoding: "utf8" }).trim().length > 0;
    return { sha, dirty };
  } catch {
    return { sha: null, dirty: null };
  }
}

async function main() {
  // Build benchmarks
  const buildVite = runTimedBuild("marko-run-vite", fixtures.vite);
  const buildRspack = runTimedBuild("marko-run-rspack", fixtures.rspack);

  // Dev benchmarks
  const devVite = await measureDevReady("marko-run-vite", fixtures.vite, {
    command: "npm",
    args: ["run", "dev"],
    port: 4100,
    readyTest: (plain) =>
      plain.includes("ready   built in") ||
      plain.includes("Server listening at") ||
      plain.includes("Local:"),
    compileRegex: /ready in (\d+) ms/,
  });
  const devRspack = await measureDevReady("marko-run-rspack", fixtures.rspack, {
    command: "node",
    args: [path.join(root, "scripts/bench-rspack-dev.mjs"), fixtures.rspack, "4200"],
    port: 4200,
    readyTest: (plain) => plain.includes("Rspack compiled successfully"),
    compileRegex: /Rspack compiled successfully in (\d+) ms/,
  });

  console.log("\nBenchmark results");
  for (const [build, dev] of [
    [buildVite, devVite],
    [buildRspack, devRspack],
  ]) {
    const compile = dev.compileMs != null ? `, dev-compile=${dev.compileMs}ms` : "";
    console.log(
      `  ${build.name}:  build=${build.buildSeconds}s, dev-ready=${dev.devReadyMs}ms (incl. startup)${compile} (port ${dev.port})`,
    );
  }

  const record = {
    timestamp: new Date().toISOString(),
    git: gitInfo(),
    node: process.version,
    results: {
      "marko-run-vite": { ...buildVite, devReadyMs: devVite.devReadyMs, devCompileMs: devVite.compileMs },
      "marko-run-rspack": { ...buildRspack, devReadyMs: devRspack.devReadyMs, devCompileMs: devRspack.compileMs },
    },
  };
  fs.appendFileSync(resultsFile, JSON.stringify(record) + "\n");
  console.log(`\nResults appended to ${path.relative(root, resultsFile)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
