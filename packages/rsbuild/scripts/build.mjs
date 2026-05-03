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

// External packages that should not be bundled
const external = [
  "@rs-marko-run/core",
  "@rs-marko-run/core/*",
  "@rspack/core",
  "@marko/run",
  "@marko/run/*",
  "@marko/compiler"
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
  plugins: []
});

// Generate declaration file
const dts = `export interface MarkoRunRsbuildOptions {
  routesDir?: string;
  adapter?: any;
  trailingSlashes?: 'Ignore' | 'RedirectWithout' | 'RedirectWith' | 'RewriteWithout' | 'RewriteWith';
  emitRoutes?: (routes: any[]) => void | Promise<void>;
  debug?: boolean;
}

export default function markoRunRsbuild(opts?: MarkoRunRsbuildOptions): import('@rsbuild/core').RsbuildPlugin;
`;

await writeFile(resolve(distDir, "index.d.ts"), dts);
console.log("Build completed successfully");
