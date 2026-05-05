import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import pc from "picocolors";
import { rspack } from "@rspack/core";
import type { Compiler, MultiCompiler, Stats } from "@rspack/core";
import { createMiddleware } from "@markopack/core/adapter/middleware";
import type { MarkoRunRspackOptions, RouteBuildResult } from "./routes.js";

const projectRequire = createRequire(import.meta.url);

export interface DevServer {
  close(): Promise<void>;
}

export async function startDevServer(
  compiler: MultiCompiler,
  opts: {
    root: string;
    outputDir: string;
    port: number;
    routeResult: RouteBuildResult;
    trailingSlashes: NonNullable<MarkoRunRspackOptions["trailingSlashes"]>;
  },
): DevServer {
  const { outputDir, port } = opts;
  const clientDist = path.join(outputDir, "client");
  const serverDist = path.join(outputDir, "server");

  let routerReady = false;
  let serverBundlePath: string | null = null;

  const nodeCompiler = compiler.compilers.find((c: Compiler) => {
    const t = c.options.target;
    return t === "node" || (Array.isArray(t) && t.includes("node"));
  });
  const webCompiler = compiler.compilers.find((c: Compiler) =>
    Array.isArray(c.options.target) && c.options.target.includes("web"),
  );

  // Add ProgressPlugin to both compilers
  for (const c of compiler.compilers as Compiler[]) {
    new rspack.ProgressPlugin({
      prefix: c.options.name ?? "rspack",
    }).apply(c);
  }

  if (nodeCompiler) {
    nodeCompiler.hooks.done.tap("marko-run:server-reload", (stats: Stats) => {
      if (stats.hasErrors()) return;
      serverBundlePath = getServerEntryPath(stats, serverDist);
      if (serverBundlePath) {
        reloadServerBundle(serverBundlePath);
        routerReady = Boolean((globalThis as any).__marko_run__?.fetch);
      }
    });
  }

  const middleware = createMiddleware((request, platform) =>
    (globalThis as any).__marko_run__.fetch(request, platform),
  );

  let sirvFn: ((req: http.IncomingMessage, res: http.ServerResponse) => void) | null = null;

  const server = http.createServer((req, res) => {
    if (sirvFn && req.url && /\.\w+$/.test(req.url)) {
      sirvFn(req, res);
      return;
    }

    if (routerReady && (globalThis as any).__marko_run__?.fetch) {
      middleware(req, res, (err?: any) => {
        if (err) {
          res.statusCode = 500;
          res.end(err.message || "Internal Server Error");
        } else {
          res.statusCode = 404;
          res.end("Not Found");
        }
      });
    } else {
      res.statusCode = 503;
      res.end("Server starting...");
    }
  });

  const initSirv = () => {
    if (!sirvFn && fs.existsSync(clientDist)) {
      sirvFn = projectRequire("sirv")(clientDist, { dev: true });
    }
  };

  if (webCompiler) {
    webCompiler.hooks.done.tap("marko-run:init-sirv", () => initSirv());
  }

  const networkAddr = getNetworkAddress();

  const actualPort = await findFreePort(port);
  server.listen(actualPort);

  console.log();
  console.log(`  ${pc.green("➜")}  ${pc.bold("Local")}:   http://localhost:${actualPort}/`);
  if (networkAddr) {
    console.log(`  ${pc.green("➜")}  ${pc.bold("Network")}: http://${networkAddr}:${actualPort}/`);
  }
  console.log();

  compiler.watch({ aggregateTimeout: 100 }, (err: Error | null, stats: Stats | undefined) => {
    if (err) {
      console.error(pc.red("Watch error:"), err);
      return;
    }

    if (stats) {
      if (stats.hasErrors()) {
        const info = stats.toJson({ all: false, errors: true });
        for (const e of (info.errors ?? [])) {
          console.error(pc.red(e.message));
        }
      } else {
        // MultiStats: sum child timings
        const children = stats.stats ?? [];
        const elapsed = children.reduce(
          (sum: number, c: any) => sum + (c.endTime ?? 0) - (c.startTime ?? 0),
          0,
        );
        console.log(pc.green(`  Rspack compiled successfully in ${elapsed} ms`));
      }
    }
  });

  return {
    async close() {
      await new Promise<void>((resolve) => {
        compiler.watching?.close(() => resolve());
      });
      server.close();
    },
  };
}

function getNetworkAddress(): string | undefined {
  const nets = os.networkInterfaces();
  for (const addrs of Object.values(nets)) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4" && !addr.internal) {
        return addr.address;
      }
    }
  }
  return undefined;
}

function reloadServerBundle(bundlePath: string) {
  for (const key of Object.keys(projectRequire.cache)) {
    if (key.startsWith(path.dirname(bundlePath))) {
      delete projectRequire.cache[key];
    }
  }
  try {
    projectRequire(bundlePath);
  } catch (err) {
    console.error(pc.red("Server bundle reload error:"), err);
  }
}

function findFreePort(startPort: number, maxTries = 10): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.on("error", (err: NodeJS.ErrnoException) => {
      probe.close();
      if (err.code === "EADDRINUSE" && maxTries > 0) {
        findFreePort(startPort + 1, maxTries - 1).then(resolve, reject);
      } else if (err.code === "EADDRINUSE") {
        reject(new Error(`Ports ${startPort - maxTries}–${startPort} are all in use. Specify a different port.`));
      } else {
        reject(err);
      }
    });
    probe.listen(startPort, () => {
      const addr = probe.address();
      probe.close(() => resolve(typeof addr === "object" && addr ? addr.port : startPort));
    });
  });
}

function getServerEntryPath(stats: Stats, serverDist: string): string | null {
  const fallback = path.join(serverDist, "index.cjs");
  if (fs.existsSync(fallback)) return fallback;

  const json = stats.toJson();
  const entry = json.entrypoints?.index;
  if (!entry) return null;

  for (const chunk of (entry.chunks ?? []) as any[]) {
    for (const file of (chunk.files ?? []) as string[]) {
      if (typeof file === "string" && file.endsWith(".cjs")) {
        return path.join(serverDist, file);
      }
    }
  }
  return null;
}
