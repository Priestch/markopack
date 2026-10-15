import { build } from "esbuild";
import { rm, mkdir } from "fs/promises";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

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
  "@babel/parser",
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

// Generate declaration files from source — the real exported surface
// (RspackOptions gains the `rspack` config callback, `serverEntry`,
// `routes` options; emitRoutes is typed with Route[]). esbuild strips types
// without checking, so this also guards the sources against type errors.
execFileSync(
  process.execPath,
  [
    // tsc lives in the workspace root's node_modules
    resolve(rootDir, "../../node_modules/typescript/bin/tsc"),
    "-p",
    resolve(rootDir, "tsconfig.json"),
    "--emitDeclarationOnly",
    "--declaration",
  ],
  { stdio: "inherit" },
);
console.log("Build completed successfully");
