import { dev } from "@markopack/rspack";

dev({
  root: import.meta.dirname,
  entry: "./src/index.ts",
  outputDir: "dist",
  mode: "development",
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
