import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as bundledMarkoCompiler from '@marko/compiler';
import bundledTranslator from '@marko/runtime-tags/translator';
import type { LoaderContext } from '@rspack/core';

interface MarkoLoaderOptions {
  compiler?: string;
  translator?: string;
  modules?: 'esm' | 'cjs';
  output?: 'html' | 'dom' | 'hydrate';
  babelConfig?: Record<string, unknown>;
  virtualFiles?: boolean;
  sourceMaps?: boolean;
}

export default function markoLoader(
  this: LoaderContext<MarkoLoaderOptions>,
  _source: string,
): void {
  const callback = this.async();
  const options = this.getOptions() || {};

  const filename = this.resourcePath;
  const outputFormat = options.output || 'dom';
  const compilerPath = options.compiler;
  const translator = options.translator || bundledTranslator;

  Promise.resolve()
    .then(async () => {
      if (!compilerPath) {
        return bundledMarkoCompiler;
      }

      const compilerDir = path.dirname(compilerPath);
      const traversePatchPath = path.join(compilerDir, 'babel-types/traverse/patch.js');
      await import(pathToFileURL(traversePatchPath).href);
      return import(pathToFileURL(compilerPath).href);
    })
    .then((markoCompiler) =>
      markoCompiler.compileFile(filename, {
        translator,
        modules: options.modules || 'esm',
        output: outputFormat,
        ...(options.babelConfig ? { babelConfig: options.babelConfig } : {}),
        sourceMaps: options.sourceMaps ?? false,
        writeVersionComment: false,
        fileSystem: fs,
      }),
    )
    .then((result) => {
      const map = result.map as Parameters<typeof callback>[2];
      callback(null, result.code, map);
    })
    .catch((err) => {
      callback(err as Error);
    });
}
