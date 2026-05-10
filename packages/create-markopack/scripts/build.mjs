import { build } from "esbuild";
import { rm, mkdir } from "fs/promises";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const distDir = resolve(rootDir, "dist");
const srcDir = resolve(rootDir, "src");

try { await rm(distDir, { recursive: true }); } catch {}
await mkdir(distDir, { recursive: true });

await build({
  entryPoints: [resolve(srcDir, "index.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: resolve(distDir, "index.js"),
  sourcemap: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
});

import { chmod } from "fs/promises";

await chmod(resolve(distDir, "index.js"), 0o755);

console.log("Build completed successfully");
