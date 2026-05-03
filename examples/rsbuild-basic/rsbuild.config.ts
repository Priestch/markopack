import { defineConfig } from '@rsbuild/core';
import markoRun from '@rs-marko-run/rsbuild';
import { pluginMarko } from 'rsbuild-plugin-marko';

export default defineConfig({
  plugins: [
    pluginMarko(),
    markoRun.default ? markoRun.default({
      debug: true,
    }) : markoRun({ debug: true }),
  ],
  server: {
    port: 3000,
  },
  output: {
    distPath: {
      root: 'dist',
    },
  },
});
