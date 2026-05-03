import { execSync, spawn } from "node:child_process";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);

const fixtures = {
  vite: path.join(root, "bench/marko-run-vite"),
  rsbuild: path.join(root, "bench/marko-run-rsbuild"),
};

function runTimedBuild(name, cwd) {
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

async function measureFirstResponse(name, cwd, basePort) {
  const proc = spawn("npm", ["run", "dev"], {
    cwd,
    shell: true,
    stdio: "ignore",
    env: { ...process.env, PORT: String(basePort) },
  });

  const start = Date.now();

  try {
    let ok = false;
    for (let i = 0; i < 40; i++) {
      for (let p = basePort; p < basePort + 12; p++) {
        try {
          const res = await fetch(`http://localhost:${p}/`);
          if (res.status === 200) {
            ok = true;
            return {
              name,
              firstResponseMs: Date.now() - start,
              port: p,
            };
          }
        } catch {}
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    if (!ok) {
      throw new Error(`${name}: dev server did not respond in time`);
    }
  } finally {
    proc.kill();
  }
}

async function main() {
  const buildVite = runTimedBuild("marko-run-vite", fixtures.vite);
  const buildRsbuild = runTimedBuild("marko-run-rsbuild", fixtures.rsbuild);

  const devVite = await measureFirstResponse("marko-run-vite", fixtures.vite, 4100);
  const devRsbuild = await measureFirstResponse(
    "marko-run-rsbuild",
    fixtures.rsbuild,
    4200,
  );

  console.log("\nBenchmark results");
  console.log(`- ${buildVite.name}: build=${buildVite.buildSeconds}s, first-response=${devVite.firstResponseMs}ms`);
  console.log(`- ${buildRsbuild.name}: build=${buildRsbuild.buildSeconds}s, first-response=${devRsbuild.firstResponseMs}ms`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
