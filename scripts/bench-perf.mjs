import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);

const fixtures = {
  vite: path.join(root, "bench/marko-run-vite"),
  rsbuild: path.join(root, "bench/marko-run-rsbuild"),
};

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

function runTimedBuild(name, cwd) {
  cleanFixture(cwd);
  const out = execSync('(/usr/bin/time -f "%e" npm run build) 2>&1', {
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

async function measureDevReady(name, cwd, basePort) {
  cleanFixture(cwd);
  const proc = spawn("npm", ["run", "dev"], {
    cwd,
    shell: true,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(basePort) },
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
    for (let i = 0; i < 100; i++) {
      const allPorts = [...logs.matchAll(/http:\/\/localhost:(\d+)/g)].map((m) => Number(m[1]));
      const detected = allPorts.length ? allPorts[allPorts.length - 1] : undefined;
      const ready =
        logs.includes("ready   built in") ||
        logs.includes("Server listening at") ||
        logs.includes("Local:");

      if (ready && detected) {
        return {
          name,
          devReadyMs: Date.now() - start,
          port: detected,
        };
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    const tail = logs.slice(-1200);
    throw new Error(`${name}: dev server did not become ready in time\n${tail}`);
  } finally {
    await stopDevProcess(proc);
  }
}

async function main() {
  const buildVite = runTimedBuild("marko-run-vite", fixtures.vite);
  const buildRsbuild = runTimedBuild("marko-run-rsbuild", fixtures.rsbuild);

  const devVite = await measureDevReady("marko-run-vite", fixtures.vite, 4100);
  const devRsbuild = await measureDevReady(
    "marko-run-rsbuild",
    fixtures.rsbuild,
    4200,
  );

  console.log("\nBenchmark results");
  console.log(`- ${buildVite.name}: build=${buildVite.buildSeconds}s, dev-ready=${devVite.devReadyMs}ms (port ${devVite.port})`);
  console.log(`- ${buildRsbuild.name}: build=${buildRsbuild.buildSeconds}s, dev-ready=${devRsbuild.devReadyMs}ms (port ${devRsbuild.port})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
