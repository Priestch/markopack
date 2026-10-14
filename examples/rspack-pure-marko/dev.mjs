import { dev } from "@markopack/rspack";

dev({
  root: import.meta.dirname,
  routes: false,
  entry: "./src/index.ts",
  serverEntry: "./src/server.ts",
  port: Number(process.env.PORT || 3100),
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
