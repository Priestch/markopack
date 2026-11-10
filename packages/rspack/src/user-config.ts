import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Configuration } from "@rspack/core";

// Searched in order — first match wins, same names rspack CLI accepts.
const CONFIG_FILES = [
  "rspack.config.ts",
  "rspack.config.mts",
  "rspack.config.cts",
  "rspack.config.js",
  "rspack.config.mjs",
  "rspack.config.cjs",
] as const;

export type UserRspackConfig =
  | Partial<Configuration>
  | ((config: Configuration, side: "browser" | "server") => Configuration | void);

/**
 * Object-form keys that also merge into the SERVER config. Kept small on
 * purpose: everything else on the server side (plugins, output, entry,
 * experiments, …) is dual-compiler coordinated and must go through the
 * function form, which makes the per-side choice explicit.
 */
export const SERVER_MERGE_KEYS = ["module", "resolve", "devtool", "stats"] as const;

/**
 * Normalize an object-form config for the server side: css-module rules
 * (`type: "css"` / `"css/auto"`) are rewritten to `type: "asset/source"`,
 * so the SAME preprocessor rule (e.g. `less-loader`) serves both sides —
 * the browser extracts a stylesheet, the server bundle imports the
 * compiled CSS as a string (the server config has no css experiment).
 */
export function normalizeUserConfigForServer<T extends Record<string, unknown>>(user: T): T {
  const module = user.module as { rules?: unknown[] } | undefined;
  if (!module || !Array.isArray(module.rules)) return user;
  return {
    ...user,
    module: { ...module, rules: module.rules.map(rewriteRuleForServer) },
  };
}

function rewriteRuleForServer(rule: any): any {
  if (!rule || typeof rule !== "object") return rule;
  let out = rule;
  if (out.type === "css" || out.type === "css/auto") {
    out = { ...out, type: "asset/source" };
  }
  if (Array.isArray(out.oneOf)) out = { ...out, oneOf: out.oneOf.map(rewriteRuleForServer) };
  if (Array.isArray(out.rules)) out = { ...out, rules: out.rules.map(rewriteRuleForServer) };
  return out;
}

/**
 * Load the app's optional rspack.config.* from its root.
 *
 * The file may default-export either a partial configuration (merged into
 * the generated browser config, with a safe subset merged into the server
 * config — see SERVER_MERGE_KEYS) or a function receiving each generated
 * config ((config, side) => config | void) for per-side control.
 */
export async function loadUserConfig(root: string): Promise<UserRspackConfig | null> {
  let file: string | null = null;
  for (const name of CONFIG_FILES) {
    const candidate = path.join(root, name);
    if (fs.existsSync(candidate)) {
      file = candidate;
      break;
    }
  }
  if (!file) return null;

  let mod: any;
  try {
    mod = await import(pathToFileURL(file).href);
  } catch (err) {
    if (
      /\.([cm]?ts)$/.test(file) &&
      (err as NodeJS.ErrnoException).code === "ERR_UNKNOWN_FILE_EXTENSION"
    ) {
      // Type stripping needs Node >= 22.18 — older runtimes in our engine
      // range can't import .ts config files at all.
      throw new Error(
        `${path.basename(file)}: this Node version cannot import TypeScript config files. Rename it to rspack.config.mjs or upgrade Node (>= 22.18).`,
      );
    }
    throw err;
  }

  const user: unknown = mod.default ?? mod;
  if (typeof user === "function" || isPlainObject(user)) {
    return user as UserRspackConfig;
  }
  throw new Error(
    `${path.basename(file)} must default-export a configuration object or a (config, side) => config function.`,
  );
}

/**
 * Merge a user config object over a generated one:
 * arrays (plugins, module.rules) concatenate, plain objects (output,
 * resolve, …) shallow-merge, everything else replaces.
 *
 * Three keys get deeper treatment — they are the ones users most often
 * add to, and a shallow replace would silently drop markopack's own
 * values (e.g. the `@marko/run/router` aliases):
 * - `resolve.alias` object-merges (a user alias with the same key wins)
 * - `resolve.extensions` concatenates, deduplicated
 * - `optimization.splitChunks.cacheGroups` merges per cache-group key, so
 *   a user setting any splitChunks option (thresholds, their own vendor
 *   groups) keeps the managed `marko-runtime` group — the ready()
 *   single-instance pin. A user group with the same key wins;
 *   `splitChunks: false` (opt-out) still replaces wholesale.
 */
export function mergeConfig(base: Configuration, user: Partial<Configuration>): Configuration {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(user)) {
    const prev = out[key];
    if (Array.isArray(prev) && Array.isArray(value)) {
      out[key] = [...prev, ...value];
    } else if (isPlainObject(prev) && isPlainObject(value)) {
      const merged: Record<string, unknown> = { ...prev, ...value };
      // module: keep the generated rules, append the user's.
      if (key === "module" && Array.isArray((value as any).rules)) {
        merged.rules = [
          ...((prev as any).rules ?? []),
          ...((value as any).rules as unknown[]),
        ];
      }
      // optimization: without this, any user splitChunks key would replace
      // the generated one wholesale and drop the managed `marko-runtime`
      // cacheGroup (ready() single-instance pin) — the assertManagedInvariants
      // guard would then fail the build for a customization that should have
      // been safe. Merge splitChunks field-by-field and cacheGroups per key.
      if (key === "optimization") {
        const prevSplit = (prev as Record<string, any>).splitChunks;
        const userSplit = (value as Record<string, any>).splitChunks;
        if (
          isPlainObject(prevSplit) &&
          isPlainObject(userSplit) &&
          isPlainObject(prevSplit.cacheGroups) &&
          isPlainObject(userSplit.cacheGroups)
        ) {
          (merged as Record<string, any>).splitChunks = {
            ...prevSplit,
            ...userSplit,
            cacheGroups: { ...prevSplit.cacheGroups, ...userSplit.cacheGroups },
          };
        }
      }
      // resolve: aliases merge instead of replacing — replacing would drop
      // the generated @marko/run/router aliases and break routing.
      if (key === "resolve") {
        const prevResolve = prev as Record<string, any>;
        const userResolve = value as Record<string, any>;
        if (isPlainObject(prevResolve.alias) && isPlainObject(userResolve.alias)) {
          // Assign onto the generated alias object to preserve the key
          // enumeration order exactly — rebuilding the object reordered it
          // in a way that changed rspack's module traversal order (and thus
          // the manifest key order) for a no-op customization.
          merged.alias = { ...prevResolve.alias };
          Object.assign(merged.alias as object, userResolve.alias);
        }
        if (Array.isArray(prevResolve.extensions) && Array.isArray(userResolve.extensions)) {
          const seen = new Set(prevResolve.extensions as unknown[]);
          merged.extensions = [
            ...prevResolve.extensions,
            ...(userResolve.extensions as unknown[]).filter((e) => !seen.has(e)),
          ];
        }
      }
      out[key] = merged;
    } else {
      out[key] = value;
    }
  }
  return out as Configuration;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
