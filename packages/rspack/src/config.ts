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
  routeResult: RouteBuildResult;
}

const markoRunRoot = projectRequire
  .resolve("@marko/run")
  .replace(/(src|dist)[\\/]runtime[\\/].*$/, "");

const markoRunRuntimeInternal = fs.existsSync(
  path.join(markoRunRoot, "dist/runtime/internal.js"),
)
  ? path.join(markoRunRoot, "dist/runtime/internal.js")
  : path.join(markoRunRoot, "dist/runtime/internal.cjs");

const markoLoaderPath = (() => {
  // Resolve marko-loader from @markopack/compiler package
  const loaderEntry = projectRequire.resolve(
    "@markopack/compiler/marko-loader",
  );
  if (fs.existsSync(loaderEntry)) return loaderEntry;
  throw new Error("Cannot find marko-loader from @markopack/compiler");
})();

export function createConfigs(
  options: CreateConfigsOptions,
): { web: Configuration; node: Configuration; markoPlugin: MarkoRspackPlugin } {
  const { root, entry, outputDir, mode, routeResult } = options;
  const { entryFilesDir, routerPath, virtualModules } = routeResult;

  const clientDist = path.join(outputDir, "client");
  const serverDist = path.join(outputDir, "server");

  const resolveAlias: Record<string, string> = {
    "@marko/run/router": routerPath,
    "virtual:marko-run/runtime/internal": markoRunRuntimeInternal,
    "virtual:marko-run": entryFilesDir,
  };

  const resolveConfig: Configuration["resolve"] = {
    extensions: [".ts", ".js", ".json"],
    extensionAlias: {
      ".js": [".ts", ".js"],
    },
    alias: resolveAlias,
    tsConfig: tsConfigPath(root),
  };

  const virtualModulesPlugin = new rspack.experiments.VirtualModulesPlugin(
    Object.fromEntries(virtualModules),
  );

  const nmReplacementPlugin = new rspack.NormalModuleReplacementPlugin(
    /^virtual:marko-run\//,
    (resource: any) => {
      if (resource.request === "virtual:marko-run/runtime/internal") {
        resource.request = markoRunRuntimeInternal;
      } else {
        resource.request = resource.request.replace(
          "virtual:marko-run",
          entryFilesDir,
        );
      }
    },
  );

  const webEntry: Record<string, { import: string[] }> = {
    index: { import: [path.resolve(root, entry)] },
  };
  const nodeEntry: Record<string, { import: string[]; filename?: string }> = {
    index: { import: [routerPath], filename: "index.cjs" },
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
          test: /\.marko$/,
          type: "javascript/auto",
          use: [
            {
              loader: markoLoaderPath,
              options: { output: "dom", sourceMaps: mode === "development" },
            },
          ],
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
      virtualModulesPlugin,
      nmReplacementPlugin,
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
          test: /\.marko$/,
          type: "javascript/auto",
          use: [
            {
              loader: markoLoaderPath,
              options: { output: "html", sourceMaps: mode === "development" },
            },
          ],
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
          test: /\.css$/,
          use: [{ loader: markoLoaderPath, options: { output: "html" } }],
          type: "javascript/auto",
        },
      ],
    },
    plugins: [
      virtualModulesPlugin,
      nmReplacementPlugin,
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

  return { web: webConfig, node: nodeConfig, markoPlugin };
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
