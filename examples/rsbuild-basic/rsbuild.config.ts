import { defineConfig } from '@rsbuild/core';
import markoRun from '@rs-marko-run/rsbuild';
import { pluginMarko } from 'rsbuild-plugin-marko';

const port = Number(process.env.PORT || 3900);

export default defineConfig({
  plugins: [
    pluginMarko(),
    markoRun.default ? markoRun.default({
      debug: false,
    }) : markoRun({ debug: false }),
  ],
  server: {
    port,
  },
  output: {
    distPath: {
      root: 'dist',
    },
  },
});
