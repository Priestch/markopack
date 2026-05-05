import { build } from "esbuild";
import { rm, mkdir, writeFile } from "fs/promises";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const distDir = resolve(rootDir, "dist");
const srcDir = resolve(rootDir, "src");

// Clean dist
try { await rm(distDir, { recursive: true }); } catch {}
await mkdir(distDir, { recursive: true });

const external = [
  "@rspack/core",
  "@rspack/core/*",
  "@marko/run",
  "@marko/run/*",
  "@marko/vite",
  "@marko/vite/*",
  "@marko/compiler",
  "@markopack/compiler",
  "@markopack/compiler/*",
  "sirv",
  "picocolors",
];

await build({
  entryPoints: [resolve(srcDir, "index.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outdir: distDir,
  sourcemap: true,
  external,
  resolveExtensions: [".ts", ".js", ".mjs"],
});

// Generate declaration file
const dts = `import type { Adapter, BuiltRoutes } from "@markopack/core/vite/types";

export interface RspackOptions {
  root?: string;
  entry?: string;
  outputDir?: string;
  routesDir?: string;
  adapter?: Adapter | null;
  trailingSlashes?: 'Ignore' | 'RedirectWithout' | 'RedirectWith' | 'RewriteWithout' | 'RewriteWith';
  emitRoutes?: (routes: any[]) => void | Promise<void>;
  debug?: boolean;
  mode?: 'development' | 'production';
  port?: number;
}

export function build(options?: RspackOptions): Promise<void>;
export function dev(options?: RspackOptions): Promise<{ close(): Promise<void> }>;
`;

await writeFile(resolve(distDir, "index.d.ts"), dts);
console.log("Build completed successfully");
