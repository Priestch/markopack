import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import type { Compiler, MultiCompiler, Stats } from "@rspack/core";
import { createMiddleware } from "@rs-marko-run/core/adapter/middleware";
import type { MarkoRunRspackOptions, RouteBuildResult } from "./routes.js";

const projectRequire = createRequire(import.meta.url);

export interface DevServer {
  close(): Promise<void>;
}

export function startDevServer(
  compiler: MultiCompiler,
  opts: {
    root: string;
    outputDir: string;
    port: number;
    routeResult: RouteBuildResult;
    trailingSlashes: NonNullable<MarkoRunRspackOptions["trailingSlashes"]>;
  },
): DevServer {
  const { root, outputDir, port, routeResult } = opts;
  const clientDist = path.join(outputDir, "client");
  const serverDist = path.join(outputDir, "server");

  let routerReady = false;
  let serverBundlePath: string | null = null;

  // Find the node compiler for server-side reload
  const nodeCompiler = compiler.compilers.find(
    (c) => {
      const t = c.options.target;
      return t === "node" || (Array.isArray(t) && t.includes("node"));
    },
  );
  const webCompiler = compiler.compilers.find(
    (c) => Array.isArray(c.options.target) && c.options.target.includes("web"),
  );

  // Server hot reload: on node compiler done, clear cache and reload
  if (nodeCompiler) {
    nodeCompiler.hooks.done.tap("marko-run:server-reload", (stats) => {
      if (stats.hasErrors()) return;
      serverBundlePath = getServerEntryPath(stats, serverDist);
      if (serverBundlePath) {
        reloadServerBundle(serverBundlePath);
        routerReady = Boolean((globalThis as any).__marko_run__?.fetch);
      }
    });
  }

  // Route middleware
  const middleware = createMiddleware((request, platform) =>
    (globalThis as any).__marko_run__.fetch(request, platform),
  );

  // Static file serving for client assets
  let sirvFn: ((req: http.IncomingMessage, res: http.ServerResponse) => void) | null = null;

  const server = http.createServer((req, res) => {
    // Serve static client assets
    if (sirvFn && req.url && /\.\w+$/.test(req.url)) {
      sirvFn(req, res);
      return;
    }

    // SSR middleware
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

  // Lazy-init sirv once client dist exists
  const initSirv = () => {
    if (!sirvFn && fs.existsSync(clientDist)) {
      sirvFn = projectRequire("sirv")(clientDist, { dev: true });
    }
  };

  if (webCompiler) {
    webCompiler.hooks.done.tap("marko-run:init-sirv", () => initSirv());
  }

  server.listen(port, () => {
    console.log(`[rspack] Dev server at http://localhost:${port}`);
  });

  let firstCompile = true;

  // Start watching
  compiler.watch({ aggregateTimeout: 100 }, (err, stats) => {
    if (err) {
      console.error("[rspack] Watch error:", err);
      return;
    }
    if (firstCompile && stats && !stats.hasErrors()) {
      firstCompile = false;
      console.log(`[rspack] Dev server ready at http://localhost:${port}`);
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
  // Clear all server output files from require cache
  for (const key of Object.keys(projectRequire.cache)) {
    if (key.startsWith(path.dirname(bundlePath))) {
      delete projectRequire.cache[key];
    }
  }
  try {
    projectRequire(bundlePath);
  } catch (err) {
    console.error("[rspack] Server bundle reload error:", err);
  }
}

function getServerEntryPath(stats: Stats, serverDist: string): string | null {
  // Fallback: the server entry is always index.cjs
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
