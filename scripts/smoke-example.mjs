import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const cwd = path.join(root, "examples/rspack-basic");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopProcess(proc) {
  if (proc.exitCode != null) return;
  proc.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => proc.once("exit", resolve)), wait(1200)]);
  if (proc.exitCode == null) {
    proc.kill("SIGKILL");
    await Promise.race([new Promise((resolve) => proc.once("exit", resolve)), wait(1200)]);
  }
}

async function main() {
  const port = Number(process.env.PORT || "3900");

  // Clean dist so dev starts fresh
  const distPath = path.join(cwd, "dist");
  if (fs.existsSync(distPath)) fs.rmSync(distPath, { recursive: true, force: true });

  // Kill any stale process on the port
  try { execFileSync("bash", ["-c", `lsof -ti :${port} | xargs kill -9`], { stdio: "ignore" }); } catch {}

  const proc = spawn("npm", ["run", "dev"], {
    cwd,
    shell: true,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(port) },
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

  try {
    // Wait for server to be reachable with 200 on /
    let getRes;
    for (let i = 0; i < 30; i++) {
      // Check if process died
      if (proc.exitCode != null) {
        throw new Error(`Dev server exited unexpectedly with code ${proc.exitCode}`);
      }
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`);
        const text = await res.text();
        getRes = { status: res.status, text };
        if (getRes.status === 200) break;
      } catch {
        // server not listening yet
      }
      await wait(500);
    }

    if (!getRes) {
      throw new Error("GET / smoke check failed (server not reachable)");
    }

    if (getRes.status !== 200 || !getRes.text.includes("route atlas")) {
      throw new Error(`GET / smoke check failed: status=${getRes.status}`);
    }

    const postRes = await fetch(`http://127.0.0.1:${port}/`, { method: "POST" });
    const postText = await postRes.text();
    if (postRes.status !== 201 || !postText.includes("Created!")) {
      throw new Error(`POST / smoke check failed: status=${postRes.status}`);
    }

    console.log("Smoke test passed.");
  } finally {
    await stopProcess(proc);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
