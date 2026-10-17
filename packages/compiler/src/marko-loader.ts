import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
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

// The linkAssets runtime module sits next to the compiled loader.
const linkAssetsRuntimePath = fileURLToPath(
  new URL('./link-assets-runtime.js', import.meta.url),
);

// Page asset ids (filename → templateId) recorded by the compiler's
// onAsset callback. Loaders and the build orchestrator share this via
// globalThis so the manifest can map browser chunks back to pages even
// across ESM/CJS module instances.
const ASSET_ID_REGISTRY = (globalThis as any).__markopack_page_assets__ ??=
  new Map<string, string>();

// Ready ids (filename → readyId) of lazily imported components
// (`with { load: ... }`), recorded by onAsset("load", ...). Separate from
// the page registry so a file that is both a route page and a lazy target
// can't have its templateId clobbered by its readyId.
const LOAD_ASSET_REGISTRY = (globalThis as any).__markopack_load_assets__ ??=
  new Map<string, string>();

function onAsset(kind: string, filename: string, assetId: string): void {
  if (kind === 'load') {
    LOAD_ASSET_REGISTRY.set(filename, assetId);
  } else {
    ASSET_ID_REGISTRY.set(filename, assetId);
  }
}

/**
 * The translator splits hydrate output into per-boundary virtual modules
 * (dep.code + dep.virtualPath). Vite serves these from an in-memory
 * registry; rspack has no per-module virtual resolution from a loader, so
 * materialize them as real files under node_modules/.cache and hand rspack
 * the absolute path. Files are rewritten on every compile, so watch rebuilds
 * pick up new content.
 */
function makeResolveVirtualDependency(root: string) {
  const virtualDir = path.join(
    root,
    'node_modules',
    '.cache',
    'markopack',
    'virtual',
  );

  return (from: string, dep: { virtualPath: string; code: string }) => {
    const fromId = path
      .relative(root, from)
      .replace(/[^a-z0-9_.-]+/gi, '_')
      .replace(/^_+|_+$/g, '');
    const name = `${fromId}__${dep.virtualPath.replace(
      /[^a-z0-9_.-]+/gi,
      '_',
    )}${path.extname(dep.virtualPath) ? '' : '.js'}`;
    const file = path.join(virtualDir, name);
    fs.mkdirSync(virtualDir, { recursive: true });
    // The translator emits relative imports resolved against the virtual
    // path's directory (e.g. a load-signal module importing its component
    // as "./x.marko" next to where virtualPath points). The flattened
    // cache file lives elsewhere, so rewrite relative specifiers to
    // absolute paths before writing.
    const virtualModuleDir = path.dirname(
      path.resolve(path.dirname(from), dep.virtualPath),
    );
    const code = dep.code.replace(
      /(from\s*|import\s*\(\s*|import\s+)("|')((?:\.\.?\/)[^"']+)\2/g,
      (_m, prefix: string, quote: string, specifier: string) =>
        `${prefix}${quote}${path.join(virtualModuleDir, specifier)}${quote}`,
    );
    fs.writeFileSync(file, code);
    return file;
  };
}

export default function markoLoader(
  this: LoaderContext<MarkoLoaderOptions>,
  _source: string,
): void {
  const callback = this.async();
  const options = this.getOptions() || {};

  const filename = this.resourcePath;
  const query = this.resourceQuery || '';
  const isServerEntry = /^\?server-entry/.test(query);
  const isBrowserEntry = /^\?browser-entry/.test(query);
  const isLoadEntry = /^\?load-entry/.test(query);

  // Route page entries compile with `entry: "page"` so the translator wraps
  // them with asset-flushing code (server) or builds the page's DOM output
  // (browser). `?load-entry` compiles a lazily imported component with
  // `entry: "load"`: a tiny module that dynamic-imports the component and
  // signals the hydration runtime via ready(readyId). `linkAssets` is passed
  // for all compiles so that templates containing <head> emit the flush
  // marker and load-triggered components stay instrumented.
  const isServer = !isBrowserEntry;
  const outputFormat = isBrowserEntry
    ? 'hydrate'
    : isServerEntry
      ? 'html'
      : isLoadEntry
        ? 'dom'
        : options.output || 'dom';

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
        ...(isServer || isBrowserEntry
          ? { linkAssets: { runtime: linkAssetsRuntimePath, onAsset } }
          : {}),
        ...((isServerEntry || isBrowserEntry) ? { entry: 'page' as const } : {}),
        ...(isLoadEntry ? { entry: 'load' as const } : {}),
        // All outputs: the translator reports virtual dependencies through
        // this callback — hydrate boundaries (browser), and extracted
        // <style> blocks as `<file>.marko.css` deps (any output). Without
        // it styles are silently dropped (no import is emitted). `root`
        // exists at runtime but is missing from rspack's LoaderContext
        // typings.
        resolveVirtualDependency: makeResolveVirtualDependency(
          (this as { root?: string }).root || process.cwd(),
        ),
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
