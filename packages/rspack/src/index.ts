import path from "node:path";
import fs from "node:fs";
import { rspack } from "@rspack/core";
import type { MultiCompiler, Compiler, Configuration } from "@rspack/core";
import type { Adapter } from "@markopack/core/types";
import { createConfigs, MARKO_RUNTIME_CACHE_GROUP, MARKO_RUNTIME_CACHE_GROUP_NAME } from "./config.js";
import {
  buildAndWriteRoutes,
  writeTypesFile,
  type MarkoRunRspackOptions,
  type RouteBuildResult,
} from "./routes.js";
import { injectLinkAssetsManifest } from "./link-assets.js";
import { startDevServer, type DevServer, type DevProxyConfig, type DevHeadersConfig } from "./dev.js";
import { loadUserConfig, mergeConfig, normalizeUserConfigForServer, SERVER_MERGE_KEYS, type UserRspackConfig } from "./user-config.js";
import MarkoRspackPlugin from "@markopack/compiler";

export type { MarkoRunRspackOptions } from "./routes.js";
export type { DevServer, DevProxyOptions, DevProxyConfig, DevHeadersConfig } from "./dev.js";

export interface RspackOptions extends MarkoRunRspackOptions {
  root?: string;
  entry?: string;
  outputDir?: string;
  mode?: "development" | "production";
  port?: number;
  adapter?: Adapter | null;
  /**
   * Enable the @marko/run file-routing pipeline. Set to false for a pure
   * Marko app (no @marko/run dependency); a server entry is then required
   * (see serverEntry). Default: true.
   */
  routes?: boolean;
  /**
   * Server entry used with { routes: false }. Default: "./src/server.ts"
   * (falls back to "./src/server.js").
   */
  serverEntry?: string;
  /**
   * Customize the generated rspack configurations before compilation —
   * e.g. to add loaders (PostCSS/Tailwind), aliases, or plugins. Mutate the
   * passed config in place, or return a configuration to replace it.
   *
   * An rspack.config.{ts,js,mjs,...} file in the app root is loaded
   * automatically and applied the same way first: an object export merges
   * into the browser config (arrays like module.rules/plugins concatenate)
   * and its safe subset (`module`, `resolve`, `devtool`, `stats`) into the
   * server config too; a function export receives every generated config
   * `(config, side)`.
   */
  rspack?: (config: Configuration, side: "browser" | "server") => Configuration | void;
  /**
   * Dev-server reverse proxy (dev only; needs the markopack dev server,
   * i.e. routes enabled). Object form, same shape as Vite's `server.proxy`;
   * values are http-proxy-middleware options plus an optional `bypass`.
   *
   * Keys are path prefixes matched on segment boundaries ("/api/v1" covers
   * "/api/v1" and "/api/v1/*", not "/api/v10"); the first matching key in
   * declaration order wins.
   *
   * @example
   * dev({
   *   proxy: {
   *     "/api/v1": { target: "https://staging.example.com", changeOrigin: true },
   *   },
   * })
   */
  proxy?: DevProxyConfig;
  /**
   * Default headers set on every dev-server response before dispatch —
   * handlers (static, router, proxy) may still override a header they set
   * themselves.
   */
  headers?: DevHeadersConfig;
}

async function buildRoutes(
  options: RspackOptions,
  root: string,
  isBuild: boolean,
): Promise<RouteBuildResult | undefined> {
  if (options.routes === false) {
    return undefined;
  }

  const adapter = options.adapter ?? null;

  adapter?.configure?.({ root, isBuild });
  // The adapter may return amended options — merge them back before any
  // option is read, matching @marko/run's pluginOptions contract.
  const adapterOptions = await adapter?.pluginOptions?.(options as any);
  if (adapterOptions) {
    Object.assign(options, adapterOptions);
  }

  const routesDir = options.routesDir || "src/routes";
  const trailingSlashes = options.trailingSlashes || "RedirectWithout";

  const routeResult = await buildAndWriteRoutes(
    root,
    routesDir,
    trailingSlashes,
    adapter,
    options.debug,
  );

  if (adapter?.routesGenerated && routeResult.routes) {
    await adapter.routesGenerated({
      routes: routeResult.routes,
      virtualFiles: routeResult.virtualModules,
      meta: { buildTime: 0, renderTime: 0 },
    });
  }

  // Types are written for dev too (upstream parity) — editors get route
  // types from `dev()` alone; watch-routes rewrites them after re-walks.
  await writeTypesFile(root, routeResult, adapter);

  return routeResult;
}

export async function build(options: RspackOptions = {}): Promise<void> {
  const root = path.resolve(options.root || process.cwd());
  const outputDir = path.resolve(root, options.outputDir || "dist");
  const mode = options.mode || "production";
  const entry = options.entry || "./src/index.ts";
  const adapter = options.adapter ?? null;

  const routeResult = await buildRoutes(options, root, true);
  const userConfig = await loadUserConfig(root);

  const { web, node, markoPlugin } = createConfigs({
    root,
    entry,
    outputDir,
    mode,
    routeResult,
    serverEntry: options.serverEntry,
  });

  const webConfig = customize(withMarkoPlugin(web, "browser", markoPlugin), "browser", options, userConfig);
  const nodeConfig = customize(withMarkoPlugin(node, "server", markoPlugin), "server", options, userConfig);

  const compiler = rspack([webConfig, nodeConfig]) as MultiCompiler;
  markoPlugin.applyDependencies(compiler as unknown as Compiler, false);

  return new Promise<void>((resolve, reject) => {
    compiler.run((err, stats) => {
      compiler.close(async (closeErr) => {
        try {
          if (err || closeErr) {
            reject(err || closeErr);
            return;
          }
          if (stats?.hasErrors()) {
            const info = stats.toJson({ all: false, errors: true });
            reject(new Error(info.errors?.map((e) => e.message).join("\n")));
            return;
          }

          // Must precede adapter.buildEnd: the crawl renders pages through the
          // server bundle, whose link-assets runtime needs the manifest.
          injectLinkAssetsManifest(
            markoPlugin,
            path.join(outputDir, "server", "index.cjs"),
          );

          if (adapter?.buildEnd && routeResult?.routes) {
            const serverDist = path.join(outputDir, "server");
            const serverEntry = path.join(serverDist, "index.cjs");
            const builtEntries = fs.existsSync(serverEntry) ? [serverEntry] : [];

            const adapterEntry = await adapter.getEntryFile?.();
            const sourceEntries = adapterEntry ? [adapterEntry] : [routeResult.routerPath];

            await adapter.buildEnd({
              config: {} as any,
              routes: routeResult.routes,
              builtEntries,
              sourceEntries,
            });
          }
          resolve();
        } catch (e) {
          // The callback is async — a throw below this point (manifest
          // injection, adapter.buildEnd) would otherwise reject unhandled and
          // leave the promise returned by build() forever unsettled.
          reject(e as Error);
        }
      });
    });
  });
}

export async function dev(options: RspackOptions = {}): Promise<DevServer> {
  const root = path.resolve(options.root || process.cwd());
  const outputDir = path.resolve(root, options.outputDir || "dist");
  const mode = "development";
  const entry = options.entry || "./src/index.ts";
  const port = options.port || Number(process.env.PORT) || 3000;

  const routeResult = await buildRoutes(options, root, false);
  const userConfig = await loadUserConfig(root);

  const { web, node, markoPlugin, virtualModulesPlugin } = createConfigs({
    root,
    entry,
    outputDir,
    mode,
    routeResult,
    serverEntry: options.serverEntry,
  });

  const webConfig = customize(withMarkoPlugin(web, "browser", markoPlugin), "browser", options, userConfig);
  const nodeConfig = customize(withMarkoPlugin(node, "server", markoPlugin), "server", options, userConfig);

  const compiler = rspack([webConfig, nodeConfig]) as MultiCompiler;
  markoPlugin.applyDependencies(compiler as unknown as Compiler, true);

  return startDevServer(compiler, {
    root,
    outputDir,
    port,
    routes: options.routes !== false,
    routeResult,
    routesDir: routeResult
      ? path.resolve(root, options.routesDir || "src/routes")
      : undefined,
    adapter: options.adapter ?? null,
    virtualModulesPlugin,
    trailingSlashes: options.trailingSlashes || "RedirectWithout",
    markoPlugin,
    proxy: options.proxy,
    headers: options.headers,
  });
}

function customize(
  config: Configuration,
  side: "browser" | "server",
  options: RspackOptions,
  userConfig: UserRspackConfig | null,
): Configuration {
  let customized = config;
  if (userConfig && typeof userConfig !== "function") {
    // Object export: fully merged into the browser config; the server
    // config takes the safe subset (SERVER_MERGE_KEYS) so the common
    // customizations — module.rules, aliases, devtool/stats — serve
    // both sides (e.g. less-loader for SSR). Everything else stays
    // browser-side; per-side control is the function form's job.
    if (side === "browser") {
      customized = mergeConfig(customized, userConfig);
    } else {
      const picked: Record<string, unknown> = {};
      const ignored: string[] = [];
      for (const [key, value] of Object.entries(userConfig)) {
        if ((SERVER_MERGE_KEYS as readonly string[]).includes(key)) {
          picked[key] = value;
        } else {
          ignored.push(key);
        }
      }
      if (Object.keys(picked).length) {
        customized = mergeConfig(
          customized,
          normalizeUserConfigForServer(picked) as Partial<Configuration>,
        );
      }
      if (ignored.length) {
        console.warn(
          `[markopack] rspack.config object keys { ${ignored.join(", ")} } apply to the browser config only — use the function form ((config, side) => …) for server-side control.`,
        );
      }
    }
  } else if (userConfig) {
    const result = userConfig(customized, side);
    if (result) customized = result;
  }
  const final = options.rspack?.(customized, side) ?? customized;
  assertManagedInvariants(final, side);
  return final;
}

/**
 * Fail fast (with a pointer to the README's "Managed invariants" section)
 * when a config layer broke something markopack depends on — instead of a
 * mysterious hydration desync at runtime.
 */
function assertManagedInvariants(config: Configuration, side: "browser" | "server"): void {
  const entry = config.entry as unknown;
  if (
    !entry ||
    typeof entry !== "object" ||
    Array.isArray(entry) ||
    !Object.prototype.hasOwnProperty.call(entry, "index")
  ) {
    throw new Error(
      `[markopack] The ${side} rspack config replaced the managed \`entry\` — routes are virtual modules and both bundles are driven by the generated \`index\` entries. ` +
        'To add build behavior, use module.rules / resolve / plugins (append, never replace) instead. See "Managed invariants" in the markopack README.',
    );
  }
  const plugins = (config.plugins ?? []) as unknown[];
  const hasMarkoPlugin = plugins.some(
    (p) =>
      !!p &&
      typeof p === "object" &&
      typeof (p as { name?: unknown }).name === "string" &&
      /^MarkoRspack(Browser|Server)Plugin$/.test((p as { name: string }).name),
  );
  if (!hasMarkoPlugin) {
    throw new Error(
      `[markopack] The ${side} rspack config dropped the MarkoRspackPlugin — it syncs entries and the asset manifest between the browser and server bundles; without it hydration desyncs. ` +
        'Append plugins, never rebuild the array without it. See "Managed invariants" in the markopack README.',
    );
  }
  // The chunking invariants only exist on the browser side — the server
  // config has no runtimeChunk/splitChunks defaults to protect.
  if (side === "browser") {
    assertChunkingInvariants(config);
  }
}

/**
 * Browser-side chunking invariants (see docs/cross-entry-shared-chunks.md):
 * `runtimeChunk: "single"` plus the managed `marko-runtime` cacheGroup pin
 * @marko/runtime-tags to ONE module instance per page load — the dom
 * runtime's ready()/readyIds handshake is module-level state, and a second
 * copy (e.g. one in an initial shared chunk, one in a lazy load-entry
 * chunk) breaks lazy hydration silently. Tuning thresholds or adding cache
 * groups is fine (the object form deep-merges cacheGroups for exactly
 * that); the only sanctioned removal is the explicit opt-out
 * `optimization.splitChunks = false`, which returns to self-contained
 * entries where the invariant trivially holds (one initial entry per page).
 */
function assertChunkingInvariants(config: Configuration): void {
  const optimization = config.optimization as
    | { runtimeChunk?: unknown; splitChunks?: unknown }
    | undefined;
  if (!optimization || optimization.runtimeChunk !== "single") {
    throw new Error(
      `[markopack] The browser rspack config changed the managed \`optimization.runtimeChunk: "single"\` — page entries and lazy load-entries must hydrate against the same runtime module instances (the dom runtime's ready()/readyIds handshake is module-level state). ` +
        'See "Managed invariants" in the markopack README.',
    );
  }
  const splitChunks = optimization.splitChunks;
  if (splitChunks === false) return; // explicit opt-out
  const group = (splitChunks as { cacheGroups?: Record<string, unknown> } | undefined)
    ?.cacheGroups?.[MARKO_RUNTIME_CACHE_GROUP_NAME] as Record<string, unknown> | undefined;
  const expected = MARKO_RUNTIME_CACHE_GROUP;
  if (
    !group ||
    typeof group !== "object" ||
    group.name !== expected.name ||
    group.chunks !== expected.chunks ||
    group.enforce !== expected.enforce ||
    group.priority !== expected.priority ||
    !(group.test instanceof RegExp) ||
    group.test.source !== expected.test.source
  ) {
    throw new Error(
      `[markopack] The browser rspack config modified or dropped the managed \`optimization.splitChunks.cacheGroups.${MARKO_RUNTIME_CACHE_GROUP_NAME}\` — it pins @marko/runtime-tags into one shared initial chunk so page entries and lazy load-entries hydrate against a single runtime instance. ` +
        "Tune thresholds (minSize/maxInitialRequests/…) or add your own cache groups by spreading the existing ones (object-form configs merge cacheGroups per key automatically); " +
        'to disable cross-entry splitting entirely, set `optimization.splitChunks = false`. See "Managed invariants" in the markopack README.',
    );
  }
}

function withMarkoPlugin(
  config: Configuration,
  side: "browser" | "server",
  markoPlugin: MarkoRspackPlugin,
): Configuration {
  return {
    ...config,
    plugins: [
      ...(config.plugins || []),
      {
        name: `MarkoRspack${side === "server" ? "Server" : "Browser"}Plugin`,
        apply(compiler: Compiler) {
          if (side === "server") {
            markoPlugin.serverApply(compiler);
          } else {
            markoPlugin.browserApply(compiler);
          }
        },
      },
    ],
  };
}
