// Trimmed from the vendored @marko/run source to just what markopack's
// adapters use (loadEnv, spawnServer, getAvailablePort). The cluster-mode
// machinery (spawnServerWorker, waitForWorker) and inspect-args parsing
// were dropped. No longer kept in sync with upstream.
import cp, { type ChildProcess, type StdioOptions } from "child_process";
import { config, parse } from "dotenv";
import fs from "fs";
import net, { type Socket } from "net";

export interface SpawnedServer {
  port: number;
  close(): Promise<void> | void;
}

async function parseEnv(envFile: string) {
  if (fs.existsSync(envFile)) {
    const content = await fs.promises.readFile(envFile, "utf8");
    return parse(content);
  }
}

export function loadEnv(envFile: string) {
  config({ path: envFile });
}

export async function spawnServer(
  cmd: string,
  args: string[] = [],
  port: number = 0,
  env?: string | Record<string, string>,
  cwd: string = process.cwd(),
  wait: number = 30_000,
  stdio: StdioOptions = ["ignore", "inherit", "inherit"],
): Promise<SpawnedServer> {
  if (port <= 0) {
    port = await getAvailablePort();
  }

  if (typeof env === "string") {
    env = await parseEnv(env);
  }

  const proc = cp.spawn(cmd, args, {
    cwd,
    shell: true,
    stdio,
    windowsHide: true,
    env: { ...env, NODE_ENV: "development", ...process.env, PORT: `${port}` },
  });

  const close = async () => {
    proc.unref();
    proc.kill();
    if (!(await waitForExit(proc, 500))) {
      proc.kill("SIGKILL");
    }
  };

  try {
    await Promise.race([waitForError(proc, port), waitForServer(port, wait)]);
  } catch (err) {
    close();
    throw err;
  }

  return {
    port,
    close,
  };
}

async function waitForExit(proc: ChildProcess, wait: number = 0) {
  if (proc.exitCode !== null) return;

  return await new Promise<number | null>((resolve) => {
    (proc.once("exit", resolve), proc.once("close", resolve));
    if (wait) {
      setTimeout(resolve, wait, null);
    }
  });
}

async function waitForError(
  proc: ChildProcess,
  port: number,
): Promise<void> {
  return new Promise((_, reject) => {
    proc.once("error", reject);
    proc.once("exit", (code) => {
      reject(
        new Error(
          `Process exited with code ${code} while waiting for server to start on port "${port}".`,
        ),
      );
    });
  });
}

async function waitForServer(
  port: number,
  wait: number = 0,
): Promise<Socket> {
  let remaining = wait > 0 ? wait : Infinity;
  let connection: Socket | null;
  while (!(connection = await getConnection(port))) {
    if (remaining >= 100) {
      remaining -= 100;
      await sleep(100);
    } else {
      throw new Error(
        `Timeout while waiting for server to start on port "${port}".`,
      );
    }
  }
  return connection;
}

async function getConnection(port: number): Promise<Socket | null> {
  return new Promise((resolve) => {
    const connection = net
      .connect(port)
      .setNoDelay(true)
      .setKeepAlive(false)
      .on("error", () => {
        connection.end();
        resolve(null);
      })
      .on("connect", () => {
        resolve(connection);
      });
  });
}

export async function getAvailablePort(port?: number): Promise<number> {
  if (port && !(await getConnection(port))) {
    return port;
  }

  return new Promise((resolve) => {
    const server = net.createServer().listen(0, () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
