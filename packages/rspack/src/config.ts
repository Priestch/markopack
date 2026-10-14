import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import type { Configuration } from "@rspack/core";
import { rspack } from "@rspack/core";
import MarkoRspackPlugin from "@markopack/compiler";
import type { MarkoPluginOptions } from "@markopack/compiler";
import type { RouteBuildResult } from "./routes.js";

const projectRequire = createRequire(import.meta.url);

export interface CreateConfigsOptions {
  root: string;
  entry: string;
  outputDir: string;
  mode: "development" | "production";
  /** Route build output. Omit when routes are disabled to skip the @marko/run pipeline. */
  routeResult?: RouteBuildResult;
  /** Server entry used when routeResult is omitted (pure Marko mode). */
  serverEntry?: string;
}

let markoRunRuntimeInternalCache: string | undefined;

function markoRunRuntimeInternal(): string {
  if (!markoRunRuntimeInternalCache) {
    let runRoot: string;
    try {
      runRoot = projectRequire
        .resolve("@marko/run")
        .replace(/(src|dist)[\\/]runtime[\\/].*$/, "");
    } catch {
      throw new Error(
        'Cannot resolve "@marko/run" — it is required when routes are enabled. ' +
          "Pass { routes: false } to build a pure Marko app without @marko/run.",
      );
    }
    markoRunRuntimeInternalCache = fs.existsSync(
      path.join(runRoot, "dist/runtime/internal.js"),
    )
      ? path.join(runRoot, "dist/runtime/internal.js")
      : path.join(runRoot, "dist/runtime/internal.cjs");
  }
  return markoRunRuntimeInternalCache;
}

type VirtualModulesPluginInstance = InstanceType<
  typeof rspack.experiments.VirtualModulesPlugin
>;

export interface CreateConfigsResult {
  web: Configuration;
  node: Configuration;
  markoPlugin: MarkoRspackPlugin;
  /**
   * Per-side VirtualModulesPlugin instances (undefined when routes are
   * disabled). Dev uses their writeModule() to push route re-walk results
   * into both compilers — see watch-routes.ts.
   */
  virtualModulesPlugin: {
    web: VirtualModulesPluginInstance | undefined;
    node: VirtualModulesPluginInstance | undefined;
  };
}

export function createConfigs(
  options: CreateConfigsOptions,
): CreateConfigsResult {
  const { root, entry, outputDir, mode } = options;
  const routeResult = options.routeResult;
  const routesEnabled = !!routeResult;
  const { entryFilesDir, routerPath, virtualModules } = routeResult ?? {
    entryFilesDir: "",
    routerPath: "",
    virtualModules: [] as [string, string][],
  };

  const clientDist = path.join(outputDir, "client");
  const serverDist = path.join(outputDir, "server");

  const resolveConfig: Configuration["resolve"] = {
    extensions: [".ts", ".js", ".json"],
    extensionAlias: {
      ".js": [".ts", ".js"],
    },
    alias: routesEnabled
      ? {
          "@marko/run/router": routerPath,
          "virtual:marko-run/runtime/internal": markoRunRuntimeInternal(),
          "virtual:marko-run": entryFilesDir,
        }
      : undefined,
    tsConfig: tsConfigPath(root),
  };

  // Each compiler gets its OWN VirtualModulesPlugin instance: apply()
  // stores a single compiler reference on the plugin, so spreading one
  // shared instance into both configs would leave writeModule() only ever
  // invalidating whichever compiler applied last (the node one).
  const webVirtualModules = routesEnabled
    ? new rspack.experiments.VirtualModulesPlugin(
        Object.fromEntries(virtualModules),
      )
    : undefined;
  const nodeVirtualModules = routesEnabled
    ? new rspack.experiments.VirtualModulesPlugin(
        Object.fromEntries(virtualModules),
      )
    : undefined;

  const routePlugins = (
    virtualModulesPlugin: VirtualModulesPluginInstance | undefined,
  ) =>
    virtualModulesPlugin
      ? [
          virtualModulesPlugin,
          new rspack.NormalModuleReplacementPlugin(
            /^virtual:marko-run\//,
            (resource: any) => {
              if (resource.request === "virtual:marko-run/runtime/internal") {
                resource.request = markoRunRuntimeInternal();
              } else {
                resource.request = resource.request.replace(
                  "virtual:marko-run",
                  entryFilesDir,
                );
              }
            },
          ),
        ]
      : [];

  const webEntry: Record<string, { import: string[] }> = {
    index: { import: [path.resolve(root, entry)] },
  };
  const nodeEntry: Record<string, { import: string[]; filename?: string }> = {
    index: {
      import: [
        routesEnabled
          ? routerPath
          : path.resolve(root, requireServerEntry(root, options.serverEntry)),
      ],
      filename: "index.cjs",
    },
  };

  const markoPlugin = new MarkoRspackPlugin({
    entries: { web: webEntry, node: nodeEntry },
    sourceMaps: mode === "development",
  });

  const webConfig: Configuration = {
    name: "web",
    target: ["web", "es2020"],
    mode,
    entry: webEntry,
    output: {
      path: clientDist,
      filename:
        mode === "production" ? "static/js/[name].[contenthash:8].js" : "static/js/[name].js",
      chunkFilename:
        mode === "production"
          ? "static/js/[name].[contenthash:8].chunk.js"
          : "static/js/[name].chunk.js",
      publicPath: "/",
    },
    resolve: resolveConfig,
    module: {
      rules: [
        {
          test: /\.[cm]?[jt]sx?$/,
          exclude: /node_modules/,
          type: "javascript/auto",
          use: [
            {
              loader: "builtin:swc-loader",
              options: {
                jsc: {
                  parser: {
                    syntax: "typescript",
                    decorators: true,
                  },
                  transform: {
                    decoratorVersion: "2022-03",
                  },
                  externalHelpers: false,
                },
                env: { targets: "defaults" },
              },
            },
          ],
        },
        {
          test: /\.css$/,
          use: [
            rspack.CssExtractRspackPlugin.loader,
            {
              loader: "builtin:lightningcss-loader",
              options: { targets: "defaults" },
            },
          ],
          type: "javascript/auto",
        },
        {
          test: /\.(png|jpe?g|gif|svg|webp)$/i,
          type: "asset",
          generator: { filename: "static/media/[name].[hash:8][ext]" },
        },
        {
          test: /\.(woff|woff2|eot|ttf|otf)$/i,
          type: "asset/resource",
        },
      ],
    },
    plugins: [
      ...routePlugins(webVirtualModules),
      new rspack.DefinePlugin({
        "process.env.NODE_ENV": JSON.stringify(mode),
      }),
      new rspack.HtmlRspackPlugin({
        template: htmlTemplate(root),
        inject: "head",
        scriptLoading: "module",
      }),
      new rspack.CssExtractRspackPlugin({
        filename: mode === "production"
          ? "static/css/[name].[contenthash:8].css"
          : "static/css/[name].css",
        chunkFilename: mode === "production"
          ? "static/css/[name].[contenthash:8].chunk.css"
          : "static/css/[name].chunk.css",
      }),
    ],
    devtool: mode === "development" ? "cheap-module-source-map" : "hidden-source-map",
    stats: "errors-warnings",
  };

  const nodeConfig: Configuration = {
    name: "node",
    target: "node",
    mode,
    entry: nodeEntry,
    output: {
      path: serverDist,
      filename: "[name].cjs",
      chunkFilename: "[name].chunk.cjs",
      chunkFormat: "commonjs",
      chunkLoading: "require",
      library: { type: "commonjs2" },
      module: false,
    },
    resolve: resolveConfig,
    module: {
      rules: [
        {
          test: /\.(png|jpe?g|gif|svg|webp)$/i,
          type: "asset",
          generator: { filename: "static/media/[name].[hash:8][ext]" },
        },
        {
          test: /\.[cm]?[jt]sx?$/,
          exclude: /node_modules/,
          type: "javascript/auto",
          use: [
            {
              loader: "builtin:swc-loader",
              options: {
                jsc: {
                  parser: {
                    syntax: "typescript",
                    decorators: true,
                  },
                  transform: {
                    decoratorVersion: "2022-03",
                  },
                  externalHelpers: false,
                },
              },
            },
          ],
        },
        {
          // Server-side CSS imports resolve to the file's contents as a
          // string — nothing to bundle or extract for SSR.
          test: /\.css$/,
          type: "asset/source",
        },
      ],
    },
    plugins: [
      ...routePlugins(nodeVirtualModules),
      new rspack.DefinePlugin({
        "process.env.NODE_ENV": JSON.stringify(mode),
      }),
    ],
    externals: {
      // Don't bundle node built-ins
    },
    devtool: mode === "development" ? "cheap-module-source-map" : false,
    stats: "errors-warnings",
  };

  return {
    web: webConfig,
    node: nodeConfig,
    markoPlugin,
    virtualModulesPlugin: { web: webVirtualModules, node: nodeVirtualModules },
  };
}

function requireServerEntry(root: string, specified?: string): string {
  const candidates = specified
    ? [specified]
    : ["./src/server.ts", "./src/server.js"];
  for (const candidate of candidates) {
    if (fs.existsSync(path.resolve(root, candidate))) {
      return candidate;
    }
  }
  throw new Error(
    `Server entry not found (tried: ${candidates.join(", ")}). ` +
      "With { routes: false }, pass serverEntry pointing at your server entry.",
  );
}

function tsConfigPath(root: string): string | undefined {
  for (const name of ["tsconfig.json", "tsconfig.app.json"]) {
    if (fs.existsSync(path.join(root, name))) {
      return path.join(root, name);
    }
  }
  return undefined;
}

function htmlTemplate(root: string): string {
  const custom = path.join(root, "index.html");
  if (fs.existsSync(custom)) return custom;
  // Generate a minimal fallback template
  const fallback = path.join(root, ".marko-run", "__fallback_index.html");
  fs.mkdirSync(path.dirname(fallback), { recursive: true });
  fs.writeFileSync(fallback, '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div id="app"></div></body></html>');
  return fallback;
}
