import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import pc from "picocolors";
import { rspack } from "@rspack/core";
import type { Compiler, MultiCompiler, MultiStats, Stats } from "@rspack/core";
import type MarkoRspackPlugin from "@markopack/compiler";
import type { Adapter } from "@markopack/core/types";
import { buildLinkAssetsManifest } from "./link-assets.js";
import {
  watchRoutes,
  type RoutesWatcher,
  type VirtualModulesWriter,
} from "./watch-routes.js";
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
    routes: boolean;
    routeResult?: RouteBuildResult;
    /** Absolute routes directory (from the startup route build). */
    routesDir?: string;
    /** Same adapter the startup route build used. */
    adapter?: Adapter | null;
    /** Per-side VirtualModulesPlugin instances from createConfigs(). */
    virtualModulesPlugin?: {
      web?: VirtualModulesWriter;
      node?: VirtualModulesWriter;
    };
    trailingSlashes?: NonNullable<MarkoRunRspackOptions["trailingSlashes"]>;
    markoPlugin?: MarkoRspackPlugin;
  },
): Promise<DevServer> {
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
        if (opts.routes) {
          routerReady = Boolean((globalThis as any).__marko_run__?.fetch);
        }
      }
    });
  }

  let server: http.Server | null = null;

  if (opts.routes) {
    // Imported lazily (and directly from @marko/run, which esbuild keeps
    // external) so pure Marko mode — no @marko/run installed — can still
    // load this module.
    const { createMiddleware } = await import("@marko/run/adapter/middleware");
    const middleware = createMiddleware((request, platform) =>
      (globalThis as any).__marko_run__.fetch(request, platform),
    );

    let sirvFn: ((req: http.IncomingMessage, res: http.ServerResponse) => void) | null = null;

    server = http.createServer((req, res) => {
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
  } else {
    // Pure Marko mode: the user's server entry owns the HTTP server.
    // markopack only watches and reloads the server bundle. Exporting
    // close() from the entry releases its port before each reload.
    console.log();
    console.log(`  ${pc.green("➜")}  ${pc.bold("Marko")} dev — your server entry owns the port.`);
    console.log(`  ${pc.green("➜")}  Export ${pc.bold("close()")} from the server entry for clean reloads.`);
    console.log();
  }

  // The link-assets runtime bundled into the server bundle reads
  // `globalThis.__MARKO_MANIFEST__` first and only falls back to the build
  // placeholder (which is never replaced in dev). Define it up front and
  // refresh it in place as browser chunks are (re)emitted — the runtime
  // holds a reference to this exact object.
  const manifestTarget = ((globalThis as any).__MARKO_MANIFEST__ ??= {});
  if (webCompiler && opts.markoPlugin) {
    webCompiler.hooks.done.tap("marko-run:link-assets", () => {
      const next = buildLinkAssetsManifest(opts.markoPlugin!);
      for (const key of Object.keys(manifestTarget)) {
        delete manifestTarget[key];
      }
      Object.assign(manifestTarget, next);
    });
  }

  compiler.watch({ aggregateTimeout: 100 }, (err: Error | null, multiStats: MultiStats | undefined) => {
    if (err) {
      console.error(pc.red("Watch error:"), err);
      return;
    }

    if (multiStats) {
      if (multiStats.hasErrors()) {
        const info = multiStats.toJson({ all: false, errors: true });
        for (const e of (info.errors ?? [])) {
          console.error(pc.red(e.message));
        }
      } else {
        // MultiStats: sum child timings
        const children = multiStats.stats ?? [];
        const elapsed = children.reduce(
          (sum: number, c: any) => sum + (c.endTime ?? 0) - (c.startTime ?? 0),
          0,
        );
        console.log(pc.green(`  Rspack compiled successfully in ${elapsed} ms`));
      }
    }
  });

  // Route discovery watch: started only after compiler.watch() so the
  // compilers exist by the time writeModule() is called. Rspack's own
  // watcher can't see route files that nothing imports yet — this is what
  // makes new/deleted routes hot-discoverable in dev.
  let routesWatcher: RoutesWatcher | null = null;
  if (
    opts.routes &&
    opts.routesDir &&
    fs.existsSync(opts.routesDir) &&
    opts.routeResult
  ) {
    routesWatcher = watchRoutes({
      root: opts.root,
      routesDir: opts.routesDir,
      trailingSlashes: opts.trailingSlashes ?? "RedirectWithout",
      adapter: opts.adapter ?? null,
      virtualModules: opts.routeResult.virtualModules,
      plugins: opts.virtualModulesPlugin ?? {},
    });
  }

  return {
    async close() {
      routesWatcher?.close();
      await new Promise<void>((resolve) => {
        compiler.watching?.close(() => resolve());
      });
      server?.close();
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

let serverModule: any = null;

function reloadServerBundle(bundlePath: string) {
  if (process.env.MARKOPACK_DEBUG) {
    console.error("[markopack:dev] reloadServerBundle:", bundlePath);
  }
  (async () => {
    // Give the previous server module a chance to release its port.
    if (serverModule && typeof serverModule.close === "function") {
      try {
        await Promise.resolve(serverModule.close());
      } catch (err) {
        console.warn(pc.yellow("Server close() error during reload:"), err);
      }
    }
    for (const key of Object.keys(projectRequire.cache)) {
      if (key.startsWith(path.dirname(bundlePath))) {
        delete projectRequire.cache[key];
      }
    }
    try {
      serverModule = projectRequire(bundlePath);
      if (process.env.MARKOPACK_DEBUG) {
        console.error("[markopack:dev] server bundle reloaded, fetch:", typeof (globalThis as any).__marko_run__?.fetch);
      }
    } catch (err) {
      console.error(pc.red("Server bundle reload error:"), err);
    }
  })();
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
