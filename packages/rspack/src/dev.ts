import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import pc from "picocolors";
import type { Stats } from "@rspack/core";
import { createMiddleware } from "@rs-marko-run/core/adapter/middleware";
import type { MarkoRunRspackOptions, RouteBuildResult } from "./routes.js";

const projectRequire = createRequire(import.meta.url);

export interface DevServer {
  close(): Promise<void>;
}

export function startDevServer(
  compiler: any,
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
  let compileStart = 0;

  const nodeCompiler = compiler.compilers.find((c: any) => {
    const t = c.options.target;
    return t === "node" || (Array.isArray(t) && t.includes("node"));
  });
  const webCompiler = compiler.compilers.find((c: any) =>
    Array.isArray(c.options.target) && c.options.target.includes("web"),
  );

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

  server.listen(port, () => {
    console.log();
    console.log(`  ${pc.green("➜")}  ${pc.bold("Local")}:   http://localhost:${port}/`);
    console.log();
  });

  let firstCompile = true;

  compiler.watch({ aggregateTimeout: 100 }, (err: any, stats: any) => {
    if (err) {
      console.error(`  ${pc.red("✖")} ${pc.red("Watch error:")}`, err);
      return;
    }

    if (stats) {
      const elapsed = ((stats.endTime! - stats.startTime!) / 1000).toFixed(2);

      if (stats.hasErrors()) {
        const info = stats.toJson({ all: false, errors: true });
        for (const e of (info.errors ?? [])) {
          console.error(`  ${pc.red("✖")} ${e.message}`);
        }
      } else {
        for (const c of stats.stats ?? []) {
          const name = c.compilation?.name ?? "unknown";
          const cTime = ((c.endTime! - c.startTime!) / 1000).toFixed(2);
          console.log(`  ${pc.green("✔")} ${pc.cyan(name)} compiled ${pc.gray(`in ${cTime}s`)}`);
        }
      }

      if (firstCompile && !stats.hasErrors()) {
        firstCompile = false;
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

function reloadServerBundle(bundlePath: string) {
  for (const key of Object.keys(projectRequire.cache)) {
    if (key.startsWith(path.dirname(bundlePath))) {
      delete projectRequire.cache[key];
    }
  }
  try {
    projectRequire(bundlePath);
  } catch (err) {
    console.error(`  ${pc.red("✖")} Server bundle reload error:`, err);
  }
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
