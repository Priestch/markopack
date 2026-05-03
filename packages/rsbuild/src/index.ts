import type { RsbuildPlugin } from "@rsbuild/core";
import { logger } from "@rsbuild/core";
import fs from "fs";
import path from "path";

// Import from @marko/run source (bundled by esbuild at build time)
import {
  renderMiddleware,
  renderRouteEntry,
  renderRouter,
  renderRouteTemplate,
  renderRouteTypeInfo,
} from "@rs-marko-run/core/vite/codegen";
import {
  httpVerbs,
  markoRunFilePrefix,
  RoutableFileTypes,
  virtualFilePrefix,
} from "@rs-marko-run/core/vite/constants";
import { buildRoutes } from "@rs-marko-run/core/vite/routes/builder";
import { createFSWalker } from "@rs-marko-run/core/vite/routes/walk";
import type {
  Adapter,
  BuiltRoutes,
  HttpVerb,
  Route,
} from "@rs-marko-run/core/vite/types";
import { normalizePath } from "@rs-marko-run/core/vite/utils/fs";
import { getRouteVirtualFileName } from "@rs-marko-run/core/vite/utils/route";
import { createMiddleware } from "@rs-marko-run/core/adapter/middleware";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const markoRunRoot = require.resolve("@marko/run").replace(/(src|dist)[\\/]runtime[\\/].*$/, "");
const markoRunRuntimeInternal = fs.existsSync(
  path.join(markoRunRoot, "dist/runtime/internal.js"),
)
  ? path.join(markoRunRoot, "dist/runtime/internal.js")
  : path.join(markoRunRoot, "dist/runtime/internal.cjs");


const PLUGIN_NAME = "marko-run-rsbuild";
const VIRTUAL_DIR = ".marko-run";
const MIDDLEWARE_FILENAME = `${markoRunFilePrefix}middleware.js`;
const ROUTER_FILENAME = `${markoRunFilePrefix}router.js`;

export interface MarkoRunRsbuildOptions {
  routesDir?: string;
  adapter?: Adapter | null;
  trailingSlashes?:
    | "Ignore"
    | "RedirectWithout"
    | "RedirectWith"
    | "RewriteWithout"
    | "RewriteWith";
  emitRoutes?: (routes: Route[]) => void | Promise<void>;
  debug?: boolean;
}

export default function markoRunRsbuild(
  opts: MarkoRunRsbuildOptions = {},
): RsbuildPlugin {
  let root: string;
  let routesDir: string;
  let resolvedRoutesDir: string;
  let entryFilesDir: string;
  let typesDir: string;
  let outputDir: string;
  let trailingSlashes: NonNullable<MarkoRunRsbuildOptions["trailingSlashes"]>;
  let adapter: Adapter | null = null;
  let routes: BuiltRoutes;
  let isBuild = false;
  let typesFile: string | undefined;
  let tsConfigExists: boolean | undefined;
  let lastRouteHash = "";

  return {
    name: PLUGIN_NAME,

    setup(api) {
      root = api.context.rootPath;
      routesDir = opts.routesDir || "src/routes";
      trailingSlashes = opts.trailingSlashes || "RedirectWithout";
      outputDir = path.join(root, "dist");
      entryFilesDir = path.join(root, VIRTUAL_DIR);
      typesDir = path.join(root, ".marko-run");

      // Resolve adapter
      if (opts.adapter !== undefined && opts.adapter !== null) {
        adapter = opts.adapter;
      } else {
        resolveAdapterFromDeps(root).then((a) => {
          adapter = a;
        });
      }

      
      // ── modifyRsbuildConfig ──────────────────────────────────────
      api.modifyRsbuildConfig((config) => {
        config.server ??= {};
        if (config.server.port == null && process.env.PORT != null) {
          const parsedPort = Number(process.env.PORT);
          if (Number.isFinite(parsedPort)) {
            config.server.port = parsedPort;
          }
        }

        config.environments ??= {};

        // Web environment (Client)
        config.environments.web = {
          ...config.environments.web,
          output: {
            ...config.environments.web?.output,
            target: 'web'
          }
        };

        // If no entry is specified for web, Rsbuild uses src/index by default
        config.environments.web.source ??= {};
        config.environments.web.source.entry ??= { index: './src/index.ts' };

        if (config.environments.web.source?.entry) {
          // Normalize for rsbuild-plugin-marko bug
          const webEntry = config.environments.web.source.entry;
          for (const key of Object.keys(webEntry)) {
            if (typeof webEntry[key] === 'string') {
              webEntry[key] = { import: [webEntry[key]] };
            } else if (Array.isArray(webEntry[key])) {
              webEntry[key] = { import: webEntry[key] };
            }
          }
        }

        const routerPath = path.posix.join(entryFilesDir, ROUTER_FILENAME);

        // Node environment (SSR Server)
        config.environments.node = {
          ...config.environments.node,
          source: {
            ...config.environments.node?.source,
            entry: {
              index: { import: [routerPath], filename: "index.cjs" }
            }
          },
          output: {
            ...config.environments.node?.output,
            target: 'node',
            filename: {
              ...(config.environments.node?.output as any)?.filename,
              js: '[name].cjs',
            },
          }
        };

        const existingServerSetup = config.server.setup;
        const serverSetups = Array.isArray(existingServerSetup)
          ? existingServerSetup
          : existingServerSetup
            ? [existingServerSetup]
            : [];

        config.server.setup = [
          ...serverSetups,
          ({ action, server }) => {
            if (action !== "dev") {
              return;
            }

            const routerMiddleware = createMiddleware((request, platform) =>
              globalThis.__marko_run__.fetch(request, platform),
            );

            server.middlewares.use(async (req, res, next) => {
              try {
                if (
                  req.url &&
                  /\.(js|css|ico|png|jpg|jpeg|svg|gif|webp|woff|woff2|ttf|otf|map)$/.test(
                    req.url,
                  )
                ) {
                  return next();
                }

                await server.environments.node.loadBundle("index");

                if (!globalThis.__marko_run__?.fetch) {
                  throw new Error(
                    "@marko/run router failed to initialize global fetch handler.",
                  );
                }

                return routerMiddleware(req, res, next);
              } catch (err) {
                next(err as Error);
              }
            });
          },
        ];

        return config;
      });

      // ── modifyRspackConfig (core) ────────────────────────────────
      api.modifyRspackConfig(async (config) => {
        resolvedRoutesDir = normalizePath(path.resolve(root, routesDir));
        config.output ??= {};

        const targets = Array.isArray(config.target)
          ? config.target
          : [config.target];
        const isNodeTarget = targets.includes("node");

        if (isNodeTarget) {
          config.experiments ??= {};
          config.experiments.outputModule = false;
          config.output.module = false;
          config.output.chunkFormat = "commonjs";
          config.output.chunkLoading = "require";
          config.output.library = { type: "commonjs2" };
        }

        // Build routes from filesystem
        await rebuildRoutes();

        // Configure resolve aliases:
        // - virtual:marko-run/<generated-file> → entryFilesDir/<file>
        // - virtual:marko-run/runtime/* → @marko/run package
        // - @marko/run/router → entryFilesDir/__marko_run__router.js
        config.resolve ??= {};
        config.resolve.alias ??= {};

        
        const routerPath = path.posix.join(entryFilesDir, ROUTER_FILENAME);
        const aliasEntries: Record<string, string> = {
          "@marko/run/router": routerPath,
          "virtual:marko-run/runtime/internal": markoRunRuntimeInternal,
          "virtual:marko-run": entryFilesDir,
        };

        config.plugins ??= [];
        config.plugins.push(
          api.context.bundlerType === 'rspack'
            ? new (require('@rspack/core').NormalModuleReplacementPlugin)(
                /^virtual:marko-run\//,
                (resource) => {
                  if (resource.request === 'virtual:marko-run/runtime/internal') {
                    resource.request = markoRunRuntimeInternal;
                  } else {
                    resource.request = resource.request.replace('virtual:marko-run', entryFilesDir);
                  }
                }
              )
            : {}
        );

        if (opts.debug) {
          logger.info(
            `[${PLUGIN_NAME}] ${routes.list.length} routes discovered`,
          );
          for (const route of routes.list) {
            logger.info(
              `[${PLUGIN_NAME}]   ${route.path.path} -> ${getRouteVirtualFileName(route)}`,
            );
          }
        }

        return config;
      });

      // ── onAfterCreateCompiler ────────────────────────────────────
      api.onAfterCreateCompiler(({ compiler }) => {
        // Watch routes directory for changes in dev
        const hooks = (compiler as any).hooks;
        if (hooks?.afterCompile) {
          hooks.afterCompile.tap(PLUGIN_NAME, (compilation: any) => {
            if (resolvedRoutesDir && fs.existsSync(resolvedRoutesDir)) {
              compilation.contextDependencies.add(resolvedRoutesDir);
            }
            if (typesDir && fs.existsSync(typesDir)) {
              compilation.fileDependencies.add(
                path.join(typesDir, "routes.d.ts"),
              );
            }
          });
        }
      });

      // ── onBeforeDevCompile ───────────────────────────────────────
      api.onBeforeDevCompile(async () => {
        // Rebuild routes before each dev compilation if files changed
        const newHash = hashRoutesDir();
        if (newHash !== lastRouteHash) {
          await rebuildRoutes();
        }
      });

      // ── onAfterBuild ─────────────────────────────────────────────
      api.onAfterBuild(async () => {
        isBuild = true;
        try {
          await writeTypesFile();

          if (adapter?.routesGenerated && routes) {
            await adapter.routesGenerated({
              routes,
              virtualFiles: new Map(),
              meta: { buildTime: 0, renderTime: 0 },
            });
          }

          if (opts.emitRoutes && routes) {
            await opts.emitRoutes(routes.list);
          }
        } catch (err) {
          logger.error(`[${PLUGIN_NAME}] Post-build error:`, err);
        }
      });

      // ── onAfterDevCompile ────────────────────────────────────────
      api.onAfterDevCompile(async ({ isFirstCompile }) => {
        if (isFirstCompile && routes) {
          await writeTypesFile();
          if (opts.debug) {
            logger.info(
              `[${PLUGIN_NAME}] Dev ready — ${routes.list.length} routes`,
            );
          }
        }
      });

      // ── Internal helpers ─────────────────────────────────────────

      async function rebuildRoutes() {
        try {
          // Ensure entry files directory exists
          fs.mkdirSync(entryFilesDir, { recursive: true });

          if (fs.existsSync(resolvedRoutesDir)) {
            routes = await buildRoutes(
              { walker: createFSWalker(resolvedRoutesDir) },
              entryFilesDir,
            );
          } else {
            routes = { list: [], special: {}, middleware: [] };
            if (!isBuild) {
              logger.warn(
                `[${PLUGIN_NAME}] Routes directory not found: ${resolvedRoutesDir}`,
              );
            }
          }

          // Detect handler verbs
          for (const route of routes.list) {
            if (route.handler) {
              route.handler.verbs = await detectHandlerVerbs(
                route.handler.filePath,
              );
            }
          }

          // Write template files (Marko template entries with layouts)
          writeTemplateFiles(routes);

          // Write virtual route entry files to disk
          for (const route of routes.list) {
            const fileName = getRouteVirtualFileName(route);
            const filePath = path.join(entryFilesDir, fileName);
            fs.writeFileSync(filePath, renderRouteEntry(route, entryFilesDir));
          }

          // Write middleware file
          if (routes.middleware.length) {
            const filePath = path.join(entryFilesDir, MIDDLEWARE_FILENAME);
            fs.writeFileSync(
              filePath,
              renderMiddleware(routes.middleware, entryFilesDir),
            );
          }

          // Write router file
          const runtimeInclude = await adapter?.runtimeInclude?.();
          const routerPath = path.join(entryFilesDir, ROUTER_FILENAME);
          fs.writeFileSync(
            routerPath,
            renderRouter(routes, entryFilesDir, runtimeInclude, { trailingSlashes }),
          );

          lastRouteHash = hashRoutesDir();

          if (opts.debug) {
            logger.info(
              `[${PLUGIN_NAME}] Routes built, ${routes.list.length} routes`,
            );
          }
        } catch (err) {
          logger.error(`[${PLUGIN_NAME}] Route build error:`, err);
          // Write error into router so it surfaces in browser
          const routerPath = path.join(entryFilesDir, ROUTER_FILENAME);
          fs.mkdirSync(entryFilesDir, { recursive: true });
          fs.writeFileSync(
            routerPath,
            `throw new Error(${JSON.stringify(String(err))});`,
          );
        }
      }

      function writeTemplateFiles(routes: BuiltRoutes) {
        const allRoutes = [
          ...routes.list,
          ...(Object.values(routes.special) as Route[]),
        ];
        for (const route of allRoutes) {
          if (route.templateFilePath) {
            const dir = path.dirname(route.templateFilePath);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(
              route.templateFilePath,
              renderRouteTemplate(route, undefined),
            );
          }
        }
      }

      async function writeTypesFile() {
        if (!routes || !routes.list.length) return;
        try {
          tsConfigExists ??= (
            await fs.promises.readdir(root)
          ).some((f) => /^\.?tsconfig/.test(f));

          if (tsConfigExists) {
            const filepath = path.join(typesDir, "routes.d.ts");
            const data = await renderRouteTypeInfo(routes, typesDir, adapter);
            if (data !== typesFile || !fs.existsSync(filepath)) {
              fs.mkdirSync(typesDir, { recursive: true });
              await fs.promises.writeFile(filepath, (typesFile = data));
            }
          }
        } catch (err) {
          logger.warn(`[${PLUGIN_NAME}] Type generation error:`, err);
        }
      }

      function hashRoutesDir(): string {
        // Quick hash of route file names to detect changes
        try {
          if (!fs.existsSync(resolvedRoutesDir)) return "";
          const files = fs.readdirSync(resolvedRoutesDir, {
            recursive: true,
          });
          return files.join(",");
        } catch {
          return "";
        }
      }
    },
  };
}

// ── Utility: detect HTTP verb exports from a handler file ──────────────

async function detectHandlerVerbs(filePath: string): Promise<HttpVerb[]> {
  try {
    const source = await fs.promises.readFile(filePath, "utf-8");
    const verbs: HttpVerb[] = [];

    for (const verb of httpVerbs) {
      const upper = verb.toUpperCase();
      const patterns = [
        new RegExp(`\\bexport\\s+function\\s+${upper}\\s*\\(`),
        new RegExp(`\\bexport\\s+const\\s+${upper}\\s*=`),
        new RegExp(`\\bexport\\s+async\\s+function\\s+${upper}\\s*\\(`),
      ];
      if (patterns.some((p) => p.test(source))) {
        verbs.push(verb);
      }
    }
    return verbs;
  } catch {
    return [];
  }
}

// ── Utility: resolve adapter from package.json dependencies ───────────

async function resolveAdapterFromDeps(root: string): Promise<Adapter | null> {
  const pkgPath = path.join(root, "package.json");
  if (!fs.existsSync(pkgPath)) return null;

  try {
    const pkg = JSON.parse(await fs.promises.readFile(pkgPath, "utf-8"));
    const deps = [
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.devDependencies || {}),
    ];

    for (const name of deps) {
      if (
        name.startsWith("@marko/run-adapter") ||
        name.includes("marko-run-adapter") ||
        name.startsWith("@rs-marko-run/adapter-")
      ) {
        try {
          const mod = await import(name);
          logger.info(`[${PLUGIN_NAME}] Using adapter: ${name}`);
          return mod.default();
        } catch {
          // skip
        }
      }
    }
  } catch {
    // skip
  }

  try {
    const mod = await import("@marko/run/adapter");
    return mod.default();
  } catch {
    return null;
  }
}
