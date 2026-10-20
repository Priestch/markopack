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
  /** Actual listening port (0 in pure-Marko mode, where the entry owns it). */
  port: number;
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
  const { outputDir, port, root } = opts;
  const clientDist = path.join(outputDir, "client");
  const serverDist = path.join(outputDir, "server");
  // 项目 public/ 约定（与 Vite publicDir 对齐）：源站静态资产直接按 URL 服务。
  // 惰性初始化——资产可能在会话中途才出现（如 markopress 图片管线首渲染落盘）。
  const publicDir = path.join(root, "public");
  let publicSirv: ((req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void) | null =
    null;

  let routerReady = false;
  let serverBundlePath: string | null = null;

  // ---- dev full-reload (parity with @marko/run's vite dev) ------------------
  // Browsers can't see in-process recompiles: an SSE channel + a tiny client
  // script (injected into text/html responses served through the router)
  // reload the page whenever either compiler finishes a clean rebuild.
  const RELOAD_ENDPOINT = "/__markopack_reload";
  const RELOAD_CLIENT_URL = "/__markopack_reload.js";
  const RELOAD_SCRIPT =
    `new EventSource(${JSON.stringify(RELOAD_ENDPOINT)}).onmessage = (e) => {` +
    ' if (e.data === "reload") location.reload(); };';
  const reloadClients = new Set<http.ServerResponse>();
  let reloadDebounce: NodeJS.Timeout | undefined;

  function scheduleReloadBroadcast() {
    clearTimeout(reloadDebounce);
    reloadDebounce = setTimeout(() => {
      for (const res of reloadClients) res.write("data: reload\n\n");
    }, 300);
  }

  function serveReloadClient(res: http.ServerResponse): void {
    res.writeHead(200, {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(RELOAD_SCRIPT);
  }

  function openReloadStream(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    res.write("retry: 1000\n\n");
    reloadClients.add(res);
    req.on("close", () => reloadClients.delete(res));
  }

  /** Inject the reload client into the first HTML chunk written through the router. */
  function injectReloadScript(res: http.ServerResponse): void {
    const anyRes = res as any;
    const origWrite = anyRes.write.bind(res);
    const origEnd = anyRes.end.bind(res);
    let injected = false;
    const inject = (chunk: unknown) => {
      const contentType = String(res.getHeader("content-type") ?? "");
      if (injected || !chunk || !contentType.includes("text/html")) return chunk;
      injected = true;
      const text = typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf-8");
      // <head> 由 Marko 流式 SSR 首块产出；没匹配到就放弃（非 HTML 文档响应）
      return text.replace(/<head([^>]*)>/i, `<head$1><script src="${RELOAD_CLIENT_URL}"></script>`);
    };
    anyRes.write = (chunk?: any, ...rest: any[]) => origWrite(chunk === undefined ? undefined : inject(chunk), ...rest);
    anyRes.end = (chunk?: any, ...rest: any[]) => origEnd(chunk === undefined ? undefined : inject(chunk), ...rest);
  }
  // ---------------------------------------------------------------------------

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
    // Full-reload trigger: any clean recompile of either compiler (debounced,
    // so a change hitting both graphs reloads the page once).
    c.hooks.done.tap("markopack:full-reload", (stats: Stats) => {
      if (!stats.hasErrors()) scheduleReloadBroadcast();
    });
  }

  if (nodeCompiler) {
    nodeCompiler.hooks.done.tap("marko-run:server-reload", (stats: Stats) => {
      if (stats.hasErrors()) return;
      serverBundlePath = getServerEntryPath(stats, serverDist);
      if (serverBundlePath) {
        // 换血完成后再广播一次（闭包内函数经此传入——reloadServerBundle 是模块级，
        // 看不到 startDevServer 的作用域）
        reloadServerBundle(serverBundlePath, scheduleReloadBroadcast);
        if (opts.routes) {
          routerReady = Boolean((globalThis as any).__marko_run__?.fetch);
        }
      }
    });
  }

  let server: http.Server | null = null;
  // Actual listening port — findFreePort may bump the requested one, so the
  // caller (e.g. the fixture harness) reads it from the DevServer instead of
  // assuming. Stays 0 in pure-Marko mode, where the user entry owns the port.
  let actualPort = 0;

  if (opts.routes) {
    // Imported lazily (and directly from @marko/run, which esbuild keeps
    // external) so pure Marko mode — no @marko/run installed — can still
    // load this module.
    const { createMiddleware } = await import("@marko/run/adapter/middleware");
    const middleware = createMiddleware((request, platform) =>
      (globalThis as any).__marko_run__.fetch(request, platform),
    );

    let sirvFn:
      | ((req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void)
      | null = null;

    server = http.createServer((req, res) => {
      const pathname = req.url ? new URL(req.url, "http://localhost").pathname : "";
      if (pathname === RELOAD_ENDPOINT) {
        openReloadStream(req, res);
        return;
      }
      if (pathname === RELOAD_CLIENT_URL) {
        serveReloadClient(res);
        return;
      }

      const serveRouter = () => {
        if (routerReady && (globalThis as any).__marko_run__?.fetch) {
          injectReloadScript(res);
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
      };

      // 带扩展名的 URL 先按静态资产服务；链路 = clientDist → public/ → router。
      // router 兜底不可省——dot-path 路由（如 /sitemap.xml）不能被静态查找吞成
      // 404。publicDir 会话中途出现也能被接住（每请求一次 existsSync，量级无碍）。
      // 匹配用解析出的 pathname，不是原始 req.url：带查询串的资产地址
      // （/static/js/index.js?v=…）以查询参数结尾，用原始 URL 会漏进
      // router 变 404。
      if (pathname && /\.\w+$/.test(pathname)) {
        const serveStatic = (): void => {
          if (!publicSirv && fs.existsSync(publicDir)) {
            publicSirv = projectRequire("sirv")(publicDir, { dev: true });
          }
          if (publicSirv) {
            publicSirv(req, res, serveRouter);
            return;
          }
          serveRouter();
        };
        if (sirvFn) {
          sirvFn(req, res, serveStatic);
          return;
        }
        serveStatic();
        return;
      }

      serveRouter();
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

    actualPort = await findFreePort(port);
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
    port: actualPort,
    async close() {
      routesWatcher?.close();
      await new Promise<void>((resolve) => {
        compiler.watching?.close(() => resolve());
      });
      if (server) {
        // server.close()'s callback waits out keep-alive connections —
        // destroy them first or close() hangs for the keep-alive timeout.
        server.closeAllConnections();
        await new Promise<void>((resolve) => server!.close(() => resolve()));
      }
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

function reloadServerBundle(bundlePath: string, onReloaded?: () => void) {
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
      // bundle 换血完成的再广播：compiler done 的广播可能早于换血，
      // 确保浏览器 reload 拿到的是新 bundle
      onReloaded?.();
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
