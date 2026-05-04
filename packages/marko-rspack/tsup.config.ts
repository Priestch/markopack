import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: './src/MarkoRspackPlugin.ts',
    'marko-loader': './src/marko-loader.ts',
  },
  format: ['esm', 'cjs'],
  target: 'node18',
  dts: true,
  clean: true,
  shims: true,
  external: ['@rspack/core'],
});
