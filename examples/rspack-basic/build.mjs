import { build } from "@markopack/rspack";

build({
  root: import.meta.dirname,
  entry: "./src/index.ts",
  outputDir: "dist",
  mode: "production",
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
