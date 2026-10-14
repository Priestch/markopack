import fs from "node:fs";
import pc from "picocolors";
import type { Adapter } from "@markopack/core/types";
import { buildAndWriteRoutes } from "./routes.js";
import type { MarkoRunRspackOptions, RouteBuildResult } from "./routes.js";

/**
 * Structural stand-in for `rspack.experiments.VirtualModulesPlugin`
 * instances, so this module doesn't need a runtime import of @rspack/core.
 */
export interface VirtualModulesWriter {
  writeModule(filePath: string, contents: string): void;
}

/** Matches compiler.watch({ aggregateTimeout: 100 }) in dev.ts. */
const DEBOUNCE_MS = 100;
/** The Rust-side virtual file store may still be initializing during the
 * first compile; retry the writeModule diff instead of dropping it. */
const STORE_INIT_RETRY_MS = 500;
const STORE_INIT_MAX_RETRIES = 20;

export interface RoutesWatcher {
  close(): void;
}

/**
 * Dev-mode "re-generate × re-walk" orchestration (the @marko/run watch
 * model ported to Rspack):
 *
 * Rspack's watcher only observes files that are part of the compilation
 * graph, so a brand-new route file under routesDir is invisible to it.
 * We watch routesDir ourselves, re-run the route generator in-process,
 * and feed changed/added virtual modules through
 * VirtualModulesPlugin.writeModule() — the only update channel the
 * compilers actually observe. On-disk `.marko-run/` files are shadows of
 * the virtual store; writing to disk alone would compile nothing.
 *
 * Route *deletions* need no writeModule: the regenerated router simply
 * stops referencing the stale entry, and stale virtual files are
 * harmless (there is no delete API).
 *
 * Route *content* edits are deliberately left to Rspack's native watcher
 * (the page/layout files are already in the graph through the generated
 * templates) — a re-walk triggered by an edit produces a zero-content
 * diff and therefore no writeModule calls.
 */
export function watchRoutes(
  opts: {
    root: string;
    /** Absolute routes directory. Must exist. */
    routesDir: string;
    trailingSlashes: NonNullable<MarkoRunRspackOptions["trailingSlashes"]>;
    /** Same adapter the startup route build used, so router output matches. */
    adapter: Adapter | null;
    /** Virtual modules from the startup route build — the diff baseline. */
    virtualModules: Map<string, string>;
    plugins: {
      web?: VirtualModulesWriter;
      node?: VirtualModulesWriter;
    };
  },
): RoutesWatcher {
  const { root, routesDir, trailingSlashes, adapter, plugins } = opts;
  // Snapshot of the last applied virtual modules, keyed by absolute path.
  const lastModules = new Map(opts.virtualModules);

  let closed = false;
  let debounceTimer: NodeJS.Timeout | null = null;
  let running = false;
  let queued = false;

  let watcher: fs.FSWatcher;
  try {
    // recursive fs.watch needs Node >= 20.19, which our engines require.
    // Started only after compiler.watch() has been called, so the Rust
    // compiler is initializing/initialized by the time writeModule runs.
    watcher = fs.watch(routesDir, { recursive: true }, () => {
      if (closed) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void rewalk();
      }, DEBOUNCE_MS);
    });
  } catch (err) {
    console.error(
      pc.yellow("[markopack:dev] cannot watch routes directory:"),
      routesDir,
      err,
    );
    return { close() {} };
  }

  async function rewalk() {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      // In-process re-run with the exact startup arguments.
      const result = await buildAndWriteRoutes(
        root,
        routesDir,
        trailingSlashes,
        adapter,
      );
      await applyResult(result, STORE_INIT_MAX_RETRIES);
    } catch (err) {
      // Generator failures (e.g. a broken route file) must never take the
      // dev server down — log and keep serving the last good build.
      console.error(pc.red("[markopack:dev] routes re-walk failed:"), err);
    } finally {
      running = false;
      if (queued && !closed) {
        queued = false;
        void rewalk();
      }
    }
  }

  async function applyResult(
    result: RouteBuildResult,
    retries: number,
  ): Promise<void> {
    const changed: string[] = [];
    try {
      for (const [filePath, content] of result.virtualModules) {
        if (lastModules.get(filePath) === content) continue;
        // The invalidation channel: update the virtual store of BOTH
        // compilers. Keys are absolute paths; writeModule resolves them
        // against its compiler's context.
        if (plugins.web) plugins.web.writeModule(filePath, content);
        if (plugins.node) plugins.node.writeModule(filePath, content);
        changed.push(filePath);
        if (process.env.MARKOPACK_DEBUG) {
          console.error(`[markopack:dev] writeModule: ${filePath}`);
        }
      }
    } catch (err) {
      if (retries > 0 && isStoreNotInitialized(err)) {
        // Most likely the very first compile is still initializing the
        // virtual file store; retry the (idempotent) diff shortly.
        await delay(STORE_INIT_RETRY_MS);
        if (!closed) await applyResult(result, retries - 1);
        return;
      }
      throw err;
    }
    // Refresh the baseline: drop deleted keys so a later re-add diffs as
    // changed, and record current contents.
    for (const key of lastModules.keys()) {
      if (!result.virtualModules.has(key)) lastModules.delete(key);
    }
    for (const [key, content] of result.virtualModules) {
      lastModules.set(key, content);
    }
    if (changed.length) {
      console.log(
        pc.cyan(
          `  routes re-walked: ${changed.length} virtual module(s) updated`,
        ),
      );
    }
  }

  return {
    close() {
      closed = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      watcher.close();
    },
  };
}

function isStoreNotInitialized(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /has not been initialized/.test(message);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
