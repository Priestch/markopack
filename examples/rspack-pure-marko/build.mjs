import { build } from "@markopack/rspack";

build({
  root: import.meta.dirname,
  routes: false,
  entry: "./src/index.ts",
  serverEntry: "./src/server.ts",
  outputDir: "dist",
  mode: "production",
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
