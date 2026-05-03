import { spawn } from "node:child_process";

const cwd = new URL("../examples/rsbuild-basic/", import.meta.url);

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

function request(url, init) {
  return fetch(url, init);
}

async function requestWithBody(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  return { status: res.status, text };
}

async function main() {
  const basePort = Number(process.env.PORT || "3900");
  const proc = spawn("npm", ["run", "dev"], {
    cwd,
    stdio: "ignore",
    shell: true,
    env: { ...process.env, PORT: String(basePort) },
  });

  try {
    let port = basePort;
    let getRes;

    for (let i = 0; i < 24; i++) {
      port = basePort + i;
      try {
        const res = await request(`http://127.0.0.1:${port}/`);
        const text = await res.text();
        getRes = { status: res.status, text };
        if (getRes.status === 200) {
          break;
        }
      } catch {
        await wait(600);
      }
    }

    if (!getRes) {
      throw new Error("GET / smoke check failed (server not reachable)");
    }

    if (getRes.status !== 200 || !getRes.text.includes("route atlas")) {
      throw new Error("GET / smoke check failed");
    }

    const postRes = await requestWithBody(`http://127.0.0.1:${port}/`, {
      method: "POST",
    });
    if (postRes.status !== 201 || !postRes.text.includes("Created!")) {
      throw new Error("POST / smoke check failed");
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
