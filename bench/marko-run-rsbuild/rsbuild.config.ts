import { defineConfig } from "@rsbuild/core";
import { pluginMarko } from "rsbuild-plugin-marko";
import markoRun from "@rs-marko-run/rsbuild";

const port = Number(process.env.PORT || 4200);

export default defineConfig({
  plugins: [pluginMarko(), markoRun({ debug: false })],
  server: {
    port,
  },
  output: {
    distPath: {
      root: "dist",
    },
  },
});
