import { dev } from "@rs-marko-run/rspack";

const port = Number(process.env.PORT || 3900);

dev({
  root: import.meta.dirname,
  entry: "./src/index.ts",
  outputDir: "dist",
  mode: "development",
  port,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
