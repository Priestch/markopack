import { build } from "@rs-marko-run/rspack";

const root = "bench/marko-run-rsbuild";
const start = performance.now();

try {
  await build({
    root,
    entry: "./src/index.ts",
    outputDir: "dist",
    mode: "production",
    debug: true,
  });
  const elapsed = performance.now() - start;
  console.log(`\nBuild completed in ${(elapsed / 1000).toFixed(2)}s`);
} catch (err) {
  console.error("Build failed:", err);
  process.exit(1);
}
