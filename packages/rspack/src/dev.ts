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
/** http-proxy-middleware options (target, changeOrigin, ws, pathRewrite, …). */
import type { Options as HttpProxyMiddlewareOptions } from "http-proxy-middleware";
import { buildLinkAssetsManifest } from "./link-assets.js";
import {
  watchRoutes,
  type RoutesWatcher,
  type VirtualModulesWriter,
} from "./watch-routes.js";
import type { MarkoRunRspackOptions, RouteBuildResult } from "./routes.js";

const projectRequire = createRequire(import.meta.url);

export interface DevProxyOptions extends HttpProxyMiddlewareOptions {
  /**
   * Run before proxying a matched request. Return:
   * - `false` — skip this entry (the next matching entry, then normal
   *   dev-server handling, applies)
   * - a string — rewrite the request URL to it and handle it locally
   *   (static assets / router) instead of proxying
   * - `undefined` — proceed with the proxy
   */
  bypass?: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    options: DevProxyOptions,
  ) => string | false | void;
}

/**
 * Dev-server reverse proxy (`dev({ proxy })`), object form — same shape as
 * Vite's `server.proxy`. Keys are path prefixes.
 */
export type DevProxyConfig = Record<string, DevProxyOptions>;

/** Default headers set on every dev-server response (`dev({ headers })`). */
export type DevHeadersConfig = Record<string, string | string[]>;

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
    proxy?: DevProxyConfig;
    headers?: DevHeadersConfig;
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

  // ---- dev proxy (dev({ proxy })) ------------------------------------------
  // Registered BESIDE the reload handling: proxy dispatch happens before the
  // static/router chain, and only router-served HTML passes through
  // injectReloadScript — so proxied bodies are passed through untouched
  // (no reload-script injection into proxied responses).
  const proxyHandlers: {
    key: string;
    entry: DevProxyOptions;
    /** Entry carries its own pathFilter — eligibility is decided inside hpm. */
    hasOwnPathFilter: boolean;
    middleware: (
      req: http.IncomingMessage,
      res: http.ServerResponse,
      next: (err?: any) => void,
    ) => void;
  }[] = [];
  if (opts.proxy) {
    const { createProxyMiddleware } = await import("http-proxy-middleware");
    for (const [key, entry] of Object.entries(opts.proxy)) {
      if (!entry || typeof entry !== "object" || entry.target == null) {
        throw new Error(`dev({ proxy })["${key}"]: a target is required.`);
      }
      const { bypass, ...hpmOptions } = entry;
      proxyHandlers.push({
        key,
        entry,
        hasOwnPathFilter: hpmOptions.pathFilter != null,
        middleware: createProxyMiddleware({
          ...hpmOptions,
          // Same segment-prefix semantics as the dispatch below; as a filter
          // so the middleware (and its ws upgrades) decline consistently.
          pathFilter:
            hpmOptions.pathFilter ??
            ((p: string) => proxyKeyMatches(p.split("?")[0], key)),
        }),
      });
    }
  }

  /** Default dev headers, applied to every response before dispatch. */
  const headerEntries = opts.headers ? Object.entries(opts.headers) : null;

  /** Segment-boundary prefix match: "/api/v1" covers "/api/v1" and "/api/v1/*", not "/api/v10". */
  function proxyKeyMatches(pathname: string, key: string): boolean {
    if (key === "" || key === "/") return true;
    if (key.endsWith("/")) key = key.slice(0, -1);
    return pathname === key || pathname.startsWith(key + "/");
  }

  /**
   * Try each proxy entry in declaration order; the first whose key matches
   * (or that carries its own pathFilter) handles the request. fallThrough =
   * the static → router chain.
   */
  function tryProxy(
    pathname: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    fallThrough: () => void,
    index = 0,
  ): void {
    for (let i = index; i < proxyHandlers.length; i++) {
      const handler = proxyHandlers[i];
      if (!handler.hasOwnPathFilter && !proxyKeyMatches(pathname, handler.key)) {
        continue;
      }
      if (handler.entry.bypass) {
        const result = handler.entry.bypass(req, res, handler.entry);
        if (result === false) continue; // skip this entry, try the next
        if (typeof result === "string") {
          // Serve the returned path locally instead of proxying.
          req.url = result;
          fallThrough();
          return;
        }
      }
      handler.middleware(req, res, (err?: any) => {
        if (err) {
          res.statusCode = 500;
          res.end(`Proxy error (${handler.key}): ${err?.message ?? err}`);
          return;
        }
        // Declined by a user pathFilter — continue with the next entry.
        tryProxy(pathname, req, res, fallThrough, i + 1);
      });
      return;
    }
    fallThrough();
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

      // Default headers (dev({ headers })): set before dispatch so every
      // handler's response carries them; a handler may still override.
      if (headerEntries) {
        for (const [key, value] of headerEntries) res.setHeader(key, value);
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

      // Static assets → router chain: what a request falls back to when no
      // proxy entry claims it. Recompute the pathname from req.url — a
      // proxy bypass may have rewritten it to a local path.
      const dispatch = (): void => {
        const dispatchPath = req.url
          ? new URL(req.url, "http://localhost").pathname
          : "";
        // 带扩展名的 URL 先按静态资产服务；链路 = clientDist → public/ → router。
        // router 兜底不可省——dot-path 路由（如 /sitemap.xml）不能被静态查找吞成
        // 404。publicDir 会话中途出现也能被接住（每请求一次 existsSync，量级无碍）。
        // 匹配用解析出的 pathname，不是原始 req.url：带查询串的资产地址
        // （/static/js/index.js?v=…）以查询参数结尾，用原始 URL 会漏进
        // router 变 404。
        if (dispatchPath && /\.\w+$/.test(dispatchPath)) {
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
      };

      if (proxyHandlers.length) {
        tryProxy(pathname, req, res, dispatch);
        return;
      }
      dispatch();
    });

    // WebSocket upgrades: first ws:true entry whose key matches the
    // pathname handles the upgrade; unmatched upgrades are dropped.
    const wsHandlers = proxyHandlers.filter((h) => h.entry.ws === true);
    if (wsHandlers.length) {
      server.on("upgrade", (req, socket, head) => {
        const pathname = req.url
          ? new URL(req.url, "http://localhost").pathname
          : "";
        // Prefer an entry whose key matches; fall back to one with its own
        // pathFilter (hpm's upgrade() re-checks the filter itself).
        const handler =
          wsHandlers.find(
            (h) => !h.hasOwnPathFilter && proxyKeyMatches(pathname, h.key),
          ) ?? wsHandlers.find((h) => h.hasOwnPathFilter);
        if (handler) {
          (handler.middleware as any).upgrade?.(req, socket, head);
        } else {
          socket.destroy();
        }
      });
    }

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
    if (opts.proxy || opts.headers) {
      console.warn(
        pc.yellow(
          "[markopack] proxy/headers need markopack's dev server (routes mode) — ignored in pure-Marko mode, where your server entry owns HTTP.",
        ),
      );
    }
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
