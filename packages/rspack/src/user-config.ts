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
 * Load the app's optional rspack.config.* from its root.
 *
 * The file may default-export either a partial configuration (merged into
 * the generated browser config) or a function receiving each generated
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
 */
export function mergeConfig(base: Configuration, user: Partial<Configuration>): Configuration {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(user)) {
    const prev = out[key];
    if (Array.isArray(prev) && Array.isArray(value)) {
      out[key] = [...prev, ...value];
    } else if (isPlainObject(prev) && isPlainObject(value)) {
      const merged: Record<string, unknown> = { ...prev };
      // module: keep the generated rules, append the user's.
      if (key === "module" && Array.isArray((value as any).rules)) {
        merged.rules = [
          ...((prev as any).rules ?? []),
          ...((value as any).rules as unknown[]),
        ];
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
