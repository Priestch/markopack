import path from "node:path";
import fs from "node:fs";
import { rspack } from "@rspack/core";
import type { MultiCompiler, Compiler, Configuration } from "@rspack/core";
import { renderRouteTypeInfo } from "@markopack/core/vite/codegen";
import type { Adapter, BuiltRoutes } from "@markopack/core/vite/types";
import { createConfigs } from "./config.js";
import { buildAndWriteRoutes, type MarkoRunRspackOptions, type RouteBuildResult } from "./routes.js";
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
}

export async function build(options: RspackOptions = {}): Promise<void> {
  const root = path.resolve(options.root || process.cwd());
  const outputDir = path.resolve(root, options.outputDir || "dist");
  const mode = options.mode || "production";
  const routesDir = options.routesDir || "src/routes";
  const entry = options.entry || "./src/index.ts";
  const trailingSlashes = options.trailingSlashes || "RedirectWithout";
  const adapter = options.adapter ?? null;

  adapter?.configure?.({ root, isBuild: true });
  adapter?.pluginOptions?.(options as any);

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

  await writeTypesFile(root, routeResult, adapter);

  const { web, node, markoPlugin } = createConfigs({
    root,
    entry,
    outputDir,
    mode,
    routeResult,
  });

  const webConfig = withMarkoPlugin(web, "browser", markoPlugin);
  const nodeConfig = withMarkoPlugin(node, "server", markoPlugin);

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

        if (adapter?.buildEnd && routeResult.routes) {
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
  const routesDir = options.routesDir || "src/routes";
  const entry = options.entry || "./src/index.ts";
  const trailingSlashes = options.trailingSlashes || "RedirectWithout";
  const port = options.port || Number(process.env.PORT) || 3000;
  const adapter = options.adapter ?? null;

  adapter?.configure?.({ root, isBuild: false });
  adapter?.pluginOptions?.(options as any);

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

  const { web, node, markoPlugin } = createConfigs({
    root,
    entry,
    outputDir,
    mode,
    routeResult,
  });

  const webConfig = withMarkoPlugin(web, "browser", markoPlugin);
  const nodeConfig = withMarkoPlugin(node, "server", markoPlugin);

  const compiler = rspack([webConfig, nodeConfig]) as MultiCompiler;
  markoPlugin.applyDependencies(compiler as Compiler, true);

  return startDevServer(compiler, {
    root,
    outputDir,
    port,
    routeResult,
    trailingSlashes,
  });
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
