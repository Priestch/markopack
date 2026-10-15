import path from "node:path";
import fs from "node:fs";
import { rspack } from "@rspack/core";
import type { MultiCompiler, Compiler, Configuration } from "@rspack/core";
import { renderRouteTypeInfo } from "@markopack/core/codegen";
import type { Adapter, BuiltRoutes } from "@markopack/core/types";
import { createConfigs } from "./config.js";
import { buildAndWriteRoutes, type MarkoRunRspackOptions, type RouteBuildResult } from "./routes.js";
import { injectLinkAssetsManifest } from "./link-assets.js";
import { startDevServer, type DevServer } from "./dev.js";
import MarkoRspackPlugin from "@markopack/compiler";

export type { MarkoRunRspackOptions } from "./routes.js";

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
   */
  rspack?: (config: Configuration, side: "browser" | "server") => Configuration | void;
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

  if (isBuild) {
    await writeTypesFile(root, routeResult, adapter);
  }

  return routeResult;
}

export async function build(options: RspackOptions = {}): Promise<void> {
  const root = path.resolve(options.root || process.cwd());
  const outputDir = path.resolve(root, options.outputDir || "dist");
  const mode = options.mode || "production";
  const entry = options.entry || "./src/index.ts";
  const adapter = options.adapter ?? null;

  const routeResult = await buildRoutes(options, root, true);

  const { web, node, markoPlugin } = createConfigs({
    root,
    entry,
    outputDir,
    mode,
    routeResult,
    serverEntry: options.serverEntry,
  });

  const webConfig = customize(withMarkoPlugin(web, "browser", markoPlugin), "browser", options);
  const nodeConfig = customize(withMarkoPlugin(node, "server", markoPlugin), "server", options);

  const compiler = rspack([webConfig, nodeConfig]) as MultiCompiler;
  markoPlugin.applyDependencies(compiler as Compiler, false);

  return new Promise<void>((resolve, reject) => {
    compiler.run((err, stats) => {
      compiler.close(async (closeErr) => {
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

  const { web, node, markoPlugin } = createConfigs({
    root,
    entry,
    outputDir,
    mode,
    routeResult,
    serverEntry: options.serverEntry,
  });

  const webConfig = customize(withMarkoPlugin(web, "browser", markoPlugin), "browser", options);
  const nodeConfig = customize(withMarkoPlugin(node, "server", markoPlugin), "server", options);

  const compiler = rspack([webConfig, nodeConfig]) as MultiCompiler;
  markoPlugin.applyDependencies(compiler as Compiler, true);

  return startDevServer(compiler, {
    root,
    outputDir,
    port,
    routes: options.routes !== false,
    routeResult,
    trailingSlashes: options.trailingSlashes || "RedirectWithout",
    markoPlugin,
  });
}

function customize(
  config: Configuration,
  side: "browser" | "server",
  options: RspackOptions,
): Configuration {
  return options.rspack?.(config, side) ?? config;
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

async function writeTypesFile(
  root: string,
  routeResult: { routes: BuiltRoutes | null; typesDir: string },
  adapter: Adapter | null,
) {
  if (!routeResult.routes?.list?.length) return;

  const tsConfigExists = (await fs.promises.readdir(root)).some((f) =>
    /^\.?tsconfig/.test(f),
  );
  if (!tsConfigExists) return;

  try {
    const data = await renderRouteTypeInfo(
      routeResult.routes,
      routeResult.typesDir,
      adapter ?? undefined,
    );
    const filepath = path.join(routeResult.typesDir, "routes.d.ts");
    fs.mkdirSync(routeResult.typesDir, { recursive: true });
    await fs.promises.writeFile(filepath, data);
  } catch {
    // non-critical
  }
}
