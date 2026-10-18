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

const markoRunRuntimeFiles = new Map<string, string>();

function markoRunRuntimeFile(name: "internal" | "client" | "router"): string {
  let file = markoRunRuntimeFiles.get(name);
  if (file) return file;
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
  file = fs.existsSync(path.join(runRoot, `dist/runtime/${name}.js`))
    ? path.join(runRoot, `dist/runtime/${name}.js`)
    : path.join(runRoot, `dist/runtime/${name}.cjs`);
  markoRunRuntimeFiles.set(name, file);
  return file;
}

function markoRunRuntimeInternal(): string {
  return markoRunRuntimeFile("internal");
}

function markoRunRuntimeClient(): string {
  return markoRunRuntimeFile("client");
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

  // The two compilers diverge on `@marko/run/router`: the web build always
  // aliases it straight to the generated router, and so does the server
  // build. In DEV the server build serves it through the runtime's router
  // FACADE instead — importer-aware, see routerFacadePlugin below — so app
  // code reachable from middleware can't create an evaluation cycle with
  // the generated router (which imports that code back through its routes).
  const baseResolve = {
    extensions: [".ts", ".js", ".json"],
    extensionAlias: {
      ".js": [".ts", ".js"],
    },
    tsConfig: tsConfigPath(root),
  };
  const webResolveConfig: Configuration["resolve"] = {
    ...baseResolve,
    alias: routesEnabled
      ? {
          "@marko/run/router": routerPath,
          "virtual:marko-run/runtime/internal": markoRunRuntimeInternal(),
          "virtual:marko-run/runtime/client": markoRunRuntimeClient(),
          "virtual:marko-run": entryFilesDir,
        }
      : undefined,
  };
  const nodeResolveConfig: Configuration["resolve"] = {
    ...baseResolve,
    alias: routesEnabled
      ? {
          ...(mode === "production" ? { "@marko/run/router": routerPath } : {}),
          "virtual:marko-run/runtime/internal": markoRunRuntimeInternal(),
          "virtual:marko-run/runtime/client": markoRunRuntimeClient(),
          "virtual:marko-run": entryFilesDir,
        }
      : undefined,
  };

  // Dev-only importer-aware `@marko/run/router`: everything but the facade
  // itself gets the facade (which defers to globalThis.__marko_run__, set
  // when the generated router entry evaluates); the facade's own dynamic
  // import must land on the real router or it would chase its own tail.
  const routerFacadePlugin =
    routesEnabled && mode === "development"
      ? new rspack.NormalModuleReplacementPlugin(
          /^@marko\/run\/router$/,
          (resource: any) => {
            const facade = markoRunRuntimeFile("router");
            const issuer: string | undefined = resource.contextInfo?.issuer;
            resource.request =
              issuer && path.normalize(issuer) === facade
                ? routerPath
                : facade;
          },
        )
      : undefined;

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
              } else if (
                resource.request === "virtual:marko-run/runtime/client"
              ) {
                resource.request = markoRunRuntimeClient();
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
    // Bootstrap `window.Run` (Run.href) in every browser entry — upstream
    // @marko/run does this from its vite transform; without it client-side
    // Run.href calls hit an undefined global. The module is idempotent
    // (`window.Run ||= …`), so per-entry duplication is harmless.
    ...(routesEnabled
      ? { browserEntryImports: [markoRunRuntimeClient()] }
      : {}),
  });

  const webConfig: Configuration = {
    name: "web",
    // Anchor resolution (bare loader names, relative paths) to the app —
    // without this it defaults to process.cwd(), making builds depend on
    // where they're launched from.
    context: root,
    target: ["web", "es2020"],
    mode,
    entry: webEntry,
    // Native css pipeline: `type: "css/auto"` rules and CssExtractRspackPlugin
    // extraction only function with the css experiment on — without it the
    // css/auto type is inert and no stylesheet is ever emitted.
    experiments: { css: true },
    // One shared runtime chunk for every entry. Page entries and
    // lazy-component load entries must hydrate against the SAME runtime
    // module instances: the load-entry chunk signals readiness via the
    // dom runtime's ready(), whose readyIds set is module-level state.
    // With rspack's default per-entry inline runtime each entry gets its
    // own copy and the ready handshake never crosses entries.
    optimization: {
      runtimeChunk: "single",
    },
    output: {
      path: clientDist,
      // Production builds start from an empty dist (Vite parity): without
      // this, every rebuild leaves another wave of orphaned contenthash
      // chunks behind. Dev keeps its output — watch mode only ever cleans
      // at compiler start, but there's nothing stale to remove anyway
      // (dev filenames carry no hash).
      clean: mode === "production",
      filename:
        mode === "production" ? "static/js/[name].[contenthash:8].js" : "static/js/[name].js",
      chunkFilename:
        mode === "production"
          ? "static/js/[name].[contenthash:8].chunk.js"
          : "static/js/[name].chunk.js",
      // Native css chunks (type: "css/auto") follow output.*, not the
      // CssExtractRspackPlugin filename options — without these, css lands
      // next to the js chunks under static/js/.
      cssFilename:
        mode === "production" ? "static/css/[name].[contenthash:8].css" : "static/css/[name].css",
      cssChunkFilename:
        mode === "production"
          ? "static/css/[name].[contenthash:8].chunk.css"
          : "static/css/[name].chunk.css",
      publicPath: "/",
    },
    resolve: webResolveConfig,
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
          // Defaults handle plain css only — preprocessor rules (sass, less,
          // …) belong in the app's rspack.config.* where they merge with
          // these (see loadUserConfig in index.ts).
          test: /\.css$/,
          // No CssExtract loader in `use`: under experiments.css the plugin
          // extracts type:"css" modules natively — its loader is the legacy
          // (webpack mini-css) path and does nothing here.
          use: [
            {
              loader: "builtin:lightningcss-loader",
              options: { targets: "defaults" },
            },
          ],
          type: "css",
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
        // Only the bootstrap entry belongs in the fallback HTML. The page
        // entries MarkoRspackPlugin merges in (about_l24j, marko-run_Qime, …)
        // are loaded per-route at runtime through the link-assets manifest —
        // and injecting them here both eagerly loads every page's JS/CSS and
        // references empty browser chunks the plugin deletes after
        // afterProcessAssets (pages with nothing to hydrate compile to a
        // 0-byte script), leaving 404 script tags behind.
        chunks: ["index"],
      }),
      new rspack.CssExtractRspackPlugin(),
    ],
    devtool: mode === "development" ? "cheap-module-source-map" : "hidden-source-map",
    stats: "errors-warnings",
  };

  const nodeConfig: Configuration = {
    name: "node",
    context: root,
    target: "node",
    mode,
    entry: nodeEntry,
    output: {
      path: serverDist,
      clean: mode === "production",
      filename: "[name].cjs",
      chunkFilename: "[name].chunk.cjs",
      chunkFormat: "commonjs",
      chunkLoading: "require",
      library: { type: "commonjs2" },
      module: false,
    },
    resolve: nodeResolveConfig,
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
        { test: /\.s[ac]ss$/, type: "asset/source" },
      ],
    },
    plugins: [
      ...routePlugins(nodeVirtualModules),
      ...(routerFacadePlugin ? [routerFacadePlugin] : []),
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
