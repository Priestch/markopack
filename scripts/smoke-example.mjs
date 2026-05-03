import { spawn } from "node:child_process";

const cwd = new URL("../examples/rsbuild-basic/", import.meta.url);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  return { status: res.status, text };
}

async function main() {
  const proc = spawn("npm", ["run", "dev"], {
    cwd,
    stdio: "ignore",
    shell: true,
  });

  try {
    await wait(4500);

    const getRes = await request("http://localhost:3000/");
    if (getRes.status !== 200 || !getRes.text.includes("Welcome to @marko/run + Rsbuild")) {
      throw new Error("GET / smoke check failed");
    }

    const postRes = await request("http://localhost:3000/", { method: "POST" });
    if (postRes.status !== 201 || !postRes.text.includes("Created!")) {
      throw new Error("POST / smoke check failed");
    }

    console.log("Smoke test passed.");
  } finally {
    proc.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
