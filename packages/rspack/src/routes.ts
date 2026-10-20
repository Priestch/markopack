import fs from "fs";
import path from "path";
import { parse } from "@babel/parser";

import {
  renderMiddleware,
  renderRouteEntry,
  renderRouter,
  renderRouteTemplate,
  renderRouteTypeInfo,
} from "@markopack/core/codegen";
import {
  httpVerbs,
  markoRunFilePrefix,
  RoutableFileTypes,
  virtualFilePrefix,
} from "@markopack/core/constants";
import { buildRoutes } from "@markopack/core/routes/builder";
import { createFSWalker } from "@markopack/core/routes/walk";
import type {
  Adapter,
  BuiltRoutes,
  HttpVerb,
  Route,
} from "@markopack/core/types";
import { normalizePath } from "@markopack/core/utils/fs";
import { getRouteVirtualFileName } from "@markopack/core/utils/route";

const MIDDLEWARE_FILENAME = `${markoRunFilePrefix}middleware.js`;
const ROUTER_FILENAME = `${markoRunFilePrefix}router.js`;
const VIRTUAL_DIR = ".marko-run";

export { MIDDLEWARE_FILENAME, ROUTER_FILENAME, VIRTUAL_DIR };

export interface RouteBuildResult {
  routes: BuiltRoutes;
  virtualModules: Map<string, string>;
  entryFilesDir: string;
  routerPath: string;
  typesDir: string;
}

export async function buildAndWriteRoutes(
  root: string,
  routesDir: string,
  trailingSlashes: NonNullable<MarkoRunRspackOptions["trailingSlashes"]>,
  adapter: Adapter | null,
  debug?: boolean,
): Promise<RouteBuildResult> {
  const resolvedRoutesDir = normalizePath(path.resolve(root, routesDir));
  const entryFilesDir = path.join(root, VIRTUAL_DIR);
  const typesDir = path.join(root, VIRTUAL_DIR);
  const virtualModules = new Map<string, string>();
  let routes: BuiltRoutes;

  fs.mkdirSync(entryFilesDir, { recursive: true });

  if (fs.existsSync(resolvedRoutesDir)) {
    routes = await buildRoutes(
      { walker: createFSWalker(resolvedRoutesDir) },
      entryFilesDir,
    );
  } else {
    routes = { list: [], special: {}, middleware: [] };
  }

  for (const route of routes.list) {
    if (route.handler) {
      route.handler.verbs = await detectHandlerVerbs(route.handler.filePath);
    }
  }

  writeTemplateFiles(routes, entryFilesDir, virtualModules);

  for (const route of routes.list) {
    const fileName = getRouteVirtualFileName(route);
    const filePath = path.join(entryFilesDir, fileName);
    writeVirtualModule(filePath, renderRouteEntry(route, entryFilesDir), virtualModules);
  }

  if (routes.middleware.length) {
    const filePath = path.join(entryFilesDir, MIDDLEWARE_FILENAME);
    writeVirtualModule(filePath, renderMiddleware(routes.middleware, entryFilesDir), virtualModules);
  }

  const runtimeInclude = await adapter?.runtimeInclude?.();
  const routerPath = path.join(entryFilesDir, ROUTER_FILENAME);
  writeVirtualModule(
    routerPath,
    renderRouter(routes, entryFilesDir, runtimeInclude, { trailingSlashes }),
    virtualModules,
  );

  // Generated files from earlier builds whose routes no longer exist would
  // otherwise accumulate here forever — unreferenced by the current router,
  // but misleading when debugging. Delete anything matching our generated
  // filename patterns that this run didn't write.
  cleanupStaleFiles(entryFilesDir, virtualModules);

  if (debug) {
    console.log(`[rspack] ${routes.list.length} routes discovered`);
    for (const route of routes.list) {
      console.log(`[rspack]   ${route.path.path} -> ${getRouteVirtualFileName(route)}`);
    }
  }

  return { routes, virtualModules, entryFilesDir, routerPath, typesDir };
}

/**
 * Writes `.marko-run/routes.d.ts` for the current route set — in build AND
 * dev (upstream parity: editors get route types as soon as routes are
 * generated, not only after a production build). Skipped silently when
 * there are no routes or no tsconfig at the root (type generation is
 * meaningless there). The watch-routes re-walker calls this again after
 * every clean re-walk.
 */
export async function writeTypesFile(
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

function writeTemplateFiles(
  routes: BuiltRoutes,
  entryFilesDir: string,
  virtualModules: Map<string, string>,
) {
  const allRoutes = [
    ...routes.list,
    ...(Object.values(routes.special) as Route[]),
  ];
  for (const route of allRoutes) {
    if (route.templateFilePath) {
      const dir = path.dirname(route.templateFilePath);
      fs.mkdirSync(dir, { recursive: true });
      writeVirtualModule(
        route.templateFilePath,
        renderRouteTemplate(route, undefined),
        virtualModules,
      );
    }
  }
}

function writeVirtualModule(
  filepath: string,
  content: string,
  virtualModules: Map<string, string>,
) {
  virtualModules.set(filepath, content);
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  // NOTE: the on-disk file is only a *shadow* of VirtualModulesPlugin's
  // in-memory virtual store (the compiler never reads it back); real
  // invalidation must go through writeModule() — see watch-routes.ts.
  // Write only when the content actually changed so dev re-walks don't
  // churn mtimes for every generated file.
  try {
    if (fs.readFileSync(filepath, "utf-8") === content) return;
  } catch {
    // file doesn't exist yet — fall through and create it
  }
  fs.writeFileSync(filepath, content);
}

// Files this package generates into .marko-run: per-route/middleware/router
// entries (markoRunFilePrefix) and rendered page templates. Anything else in
// the dir (e.g. routes.d.ts from a build, __fallback_index.html written once
// at config time as the HtmlRspackPlugin template) is left alone — the
// fallback is not a route artifact and is never in `keep`, so cleaning it
// deleted the html template mid-dev (re-walk → HtmlRspackPlugin read error).
const GENERATED_FILE_PATTERN = new RegExp(`^${markoRunFilePrefix}|\\.marko$`);

function cleanupStaleFiles(dir: string, keep: Map<string, string>) {
  for (const name of fs.readdirSync(dir)) {
    const filePath = path.join(dir, name);
    if (!GENERATED_FILE_PATTERN.test(name) || keep.has(filePath)) continue;
    if (fs.statSync(filePath).isFile()) {
      fs.rmSync(filePath);
    }
  }
}

async function detectHandlerVerbs(filePath: string): Promise<HttpVerb[]> {
  try {
    const source = await fs.promises.readFile(filePath, "utf-8");
    let exportedNames: string[];
    try {
      exportedNames = getExportIdentifiers(source);
    } catch {
      // Exotic syntax the parser rejects — fall back to the historical
      // regex scan so such files keep the old (partial) detection.
      exportedNames = scanExportIdentifiers(source);
    }
    const verbs: HttpVerb[] = [];
    for (const verb of httpVerbs) {
      if (exportedNames.includes(verb.toUpperCase())) {
        verbs.push(verb);
      }
    }
    return verbs;
  } catch (err) {
    // Read failure (ENOENT race, permissions) silently produced an empty
    // verb list before — the route then matched no method and 404ed with
    // no trace of why. Warn and fall back to "handler with no verbs".
    console.warn(
      `[markopack] failed to read handler exports from ${filePath}:`,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

// Mirrors upstream's getExportIdentifiers (@marko/run vite/utils/ast.ts):
// collects named exports from function/variable declarations and from
// export specifiers (`export { list as GET }`, `export { GET } from "..."`),
// which a source-text scan can neither match reliably (TS annotations on
// `export const GET: T = ...`) nor safely (verb names inside comments or
// strings register routes whose imports then fail the build).
function getExportIdentifiers(source: string): string[] {
  const { program } = parse(source, {
    sourceType: "module",
    plugins: ["typescript", "topLevelAwait"],
  });
  const result: string[] = [];
  for (const node of program.body as any[]) {
    if (node.type !== "ExportNamedDeclaration") continue;
    const { declaration, specifiers } = node;
    if (declaration) {
      if (declaration.type === "FunctionDeclaration" && declaration.id) {
        result.push(declaration.id.name);
      } else if (declaration.type === "VariableDeclaration") {
        for (const declarator of declaration.declarations) {
          if (declarator.id.type === "Identifier") {
            result.push(declarator.id.name);
          }
        }
      }
    } else if (specifiers) {
      for (const specifier of specifiers) {
        if (
          specifier.type === "ExportSpecifier" &&
          specifier.exported.type === "Identifier"
        ) {
          result.push(specifier.exported.name);
        }
      }
    }
  }
  return result;
}

function scanExportIdentifiers(source: string): string[] {
  const names: string[] = [];
  for (const verb of httpVerbs) {
    const upper = verb.toUpperCase();
    const patterns = [
      new RegExp(`\\bexport\\s+function\\s+${upper}\\s*\\(`),
      new RegExp(`\\bexport\\s+const\\s+${upper}\\s*=`),
      new RegExp(`\\bexport\\s+async\\s+function\\s+${upper}\\s*\\(`),
    ];
    if (patterns.some((p) => p.test(source))) {
      names.push(upper);
    }
  }
  return names;
}

export interface MarkoRunRspackOptions {
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
