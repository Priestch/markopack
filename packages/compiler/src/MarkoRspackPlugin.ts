import { fileURLToPath } from 'node:url';

import { sources } from '@rspack/core';
import type {
  Compilation as CompilationType,
  Compiler as CompilerType,
  Configuration,
  Module,
} from '@rspack/core';
import moduleName from './helpers/module-name.js';

interface ResolvablePromise<T> extends Promise<T> {
  resolve(value: T): void;
}

declare module '@rspack/core' {
  interface Compiler {
    watching?: Compiler['watching'];
    markoAssetsPending?: ResolvablePromise<void>;
  }
}

export interface MarkoPluginOptions {
  isBrowser?: boolean;
  runtimeId?: string;
  compiler?: string;
  translator?: string;
  modules?: 'esm' | 'cjs';
  sourceMaps?: boolean;
  babelConfig?: Record<string, unknown>;
  /** Direct entry points — bypasses setup() API when provided. */
  entries?: { web?: Configuration['entry']; node?: Configuration['entry'] };
  /**
   * Modules prepended to every browser entry's import list (page entries
   * and host-provided entries, not lazy load entries — those load after a
   * page entry has already run them). Used to bootstrap globals that
   * hydrated code relies on, e.g. @marko/run's `window.Run`.
   */
  browserEntryImports?: string[];
}

export default class MarkoRspackPlugin {
  private options: MarkoPluginOptions;
  private serverCompiler: CompilerType | null = null;
  private browserCompilers: CompilerType[] = [];
  private clientEntries: Record<string, string> = {};
  private loadEntries: Record<string, { file: string; readyId: string }> = {};
  private clientAssets: Record<
    string,
    Record<string, Record<string, string[]>>
  > = {};
  private _api: any | null = null;
  private entriesReady: ResolvablePromise<void>;
  private previousClientAssetsJson = '';
  private needsManifestSync = false;

  constructor(options: MarkoPluginOptions = {}) {
    this.options = { ...options };

    if (this.options.runtimeId) {
      this.options.runtimeId = this.normalizeRuntimeId(this.options.runtimeId);
    }

    this.entriesReady = this.createDeferredPromise<void>();
  }

  browserApply(compiler: CompilerType) {
    this.browserCompilers.push(compiler);
    this.setupRules(compiler);
    // applyBrowser installs an async entry that merges the static entry with
    // the page entries discovered on the server compiler — it must run last
    // so nothing overwrites it.
    this.applyBrowser(compiler);
  }

  serverApply(compiler: CompilerType) {
    this.serverCompiler = compiler;
    this.setupRules(compiler);
    this.applyServer(compiler);
    compiler.options.entry = this.getEntryPoints(compiler) as NonNullable<
      CompilerType['options']['entry']
    >;
  }

  applyDependencies(multiCompiler: CompilerType, isWatch: boolean) {
    if (isWatch) {
      this.entriesReady = this.createDeferredPromise<void>();
      return;
    }

    // Sequencing matters even before any page entries are discovered: the
    // server compiler populates the browser's dynamic entries during its
    // build, so the browser compiler must not start until the server one
    // has finished.
    if (
      this.serverCompiler &&
      this.browserCompilers.length &&
      typeof (multiCompiler as any).setDependencies === 'function'
    ) {
      const serverName = this.serverCompiler.options.name;
      if (serverName) {
        for (const browserCompiler of this.browserCompilers) {
          (multiCompiler as any).setDependencies(browserCompiler, [serverName]);
        }
      }
    }
  }

  get entriesReadyPromise() {
    return this.entriesReady;
  }

  /** Page entry modules discovered on the server compiler (id → resource with ?browser-entry). */
  get discoveredClientEntries(): Record<string, string> {
    return this.clientEntries;
  }

  /** Lazy-component load entries discovered on the server compiler
   * (browser entry name → component file + its readyId). */
  get discoveredLoadEntries(): Record<string, { file: string; readyId: string }> {
    return this.loadEntries;
  }

  /** Browser compilation output files per entry (compiler name → entry id → files by extension). */
  get collectedClientAssets(): Record<
    string,
    Record<string, Record<string, string[]>>
  > {
    return this.clientAssets;
  }

  setup(api: any) {
    this._api = api;
  }

  private getEntryPoints(compiler: CompilerType): Configuration['entry'] {
    if (this.options.entries) {
      const targets = Array.isArray(compiler.options.target)
        ? compiler.options.target
        : [compiler.options.target];
      const isNode = targets.includes('node');
      return (isNode ? this.options.entries.node : this.options.entries.web) || { index: { import: [] } };
    }

    if (!this._api) {
      throw new Error('Plugin API not initialized — call setup() first or provide entries');
    }

    const config = this._api.getConfig();
    const environments = config.environments || {};
    const source = config.source || {};

    if (environments.node && environments.web) {
      if (compiler.options.target === 'node') {
        return environments.node.source?.entry || { index: { import: [] } };
      }

      return environments.web.source?.entry || { index: { import: [] } };
    }

    if (environments.node) {
      return environments.node.source?.entry || { index: { import: [] } };
    }

    if (environments.web) {
      return environments.web.source?.entry || { index: { import: [] } };
    }

    return source.entry || { index: { import: [] } };
  }

  private setupRules(compiler: CompilerType) {
    const target = compiler.options.target;
    const isBrowser =
      target === 'web' || (Array.isArray(target) && target.includes('web'));
    const loaderPath = fileURLToPath(
      new URL('../dist/marko-loader.js', import.meta.url),
    );
    const loaderOptions = {
      ...(this.options.compiler ? { compiler: this.options.compiler } : {}),
      ...(this.options.translator
        ? { translator: this.options.translator }
        : {}),
      ...(this.options.modules ? { modules: this.options.modules } : {}),
      output: isBrowser ? 'dom' : 'html',
      sourceMaps: this.options.sourceMaps ?? false,
      ...(this.options.babelConfig
        ? { babelConfig: this.options.babelConfig }
        : {}),
    };

    compiler.options.module = compiler.options.module || { rules: [] };
    compiler.options.module.rules = compiler.options.module.rules || [];

    // The `.marko` rule lives only here: loaders/compiler options (and the
    // ?server-entry / ?browser-entry query semantics) are owned by the
    // plugin, so host configs must not mount a second rule — every matching
    // rule runs, which would compile each file twice and let dead options
    // shadow these.
    compiler.options.module.rules.push({
      test: /\.marko$/,
      type: 'javascript/auto',
      use: [
        {
          loader: loaderPath,
          options: loaderOptions,
        },
      ],
    });
  }

  private applyServer(compiler: CompilerType) {
    compiler.hooks.thisCompilation.tap(
      'MarkoRspackServer',
      (compilation: CompilationType) => {
        this.entriesReady = this.createDeferredPromise<void>();

        if (!this.options.runtimeId && compilation.outputOptions.uniqueName) {
          this.options.runtimeId = this.normalizeRuntimeId(
            compilation.outputOptions.uniqueName,
          );
        }

        compilation.hooks.finishModules.tap(
          'MarkoRspackServer:finishModules',
          (modules: Iterable<Module>) => {
            let hasChangedEntries = false;
            const removedEntryIds = new Set(Object.keys(this.clientEntries));
            // Every .marko file in this compilation — used to filter the
            // process-global load registry down to this app's lazy
            // components (the registry only grows and accumulates across
            // multiple in-process builds).
            const moduleFiles = new Set<string>();

            for (const mod of modules) {
              const resource = (mod as Module & { resource?: string }).resource;
              if (!resource) {
                continue;
              }

              if (resource.endsWith('.marko?server-entry')) {
                this.needsManifestSync = true;
                const filename = resource.replace(/\?server-entry$/, '');
                moduleFiles.add(filename);
                // Entry names become output filenames — strip leading dots
                // (e.g. ".marko-run" parent dir) that static hosts treat as
                // hidden files.
                const entryTemplateId = moduleName(filename).replace(/^\.+/, '');

                if (!removedEntryIds.delete(entryTemplateId)) {
                  hasChangedEntries = true;
                  this.clientEntries[entryTemplateId] =
                    `${filename}?browser-entry`;
                }
              } else if (/\.marko(\?.*)?$/.test(resource)) {
                moduleFiles.add(resource.replace(/\?.*$/, ''));
              }
            }

            // Lazy-component load entries: the loader recorded readyIds for
            // every `with { load: ... }` import during compilation. Each
            // becomes a browser entry compiled with `entry: "load"` whose
            // chunk, when loaded, imports the component and signals
            // ready(readyId) to unblock hydration of its subtree.
            const loadRegistry: Map<string, string> | undefined = (
              globalThis as any
            ).__markopack_load_assets__;
            const removedLoadIds = new Set(Object.keys(this.loadEntries));
            if (loadRegistry) {
              for (const [file, readyId] of loadRegistry) {
                if (!moduleFiles.has(file)) {
                  continue; // stale or from another app in this process
                }

                const entryName =
                  moduleName(file).replace(/^\.+/, '') + '_load';
                if (!removedLoadIds.delete(entryName)) {
                  hasChangedEntries = true;
                }
                this.loadEntries[entryName] = { file, readyId };
              }
            }
            for (const removedLoadId of removedLoadIds) {
              hasChangedEntries = true;
              delete this.loadEntries[removedLoadId];
              for (const compilerName in this.clientAssets) {
                delete this.clientAssets[compilerName][removedLoadId];
              }
            }

            for (const removedEntryId of removedEntryIds) {
              hasChangedEntries = true;
              delete this.clientEntries[removedEntryId];
              for (const compilerName in this.clientAssets) {
                delete this.clientAssets[compilerName][removedEntryId];
              }
            }

            if (hasChangedEntries) {
              for (const browserCompiler of this.browserCompilers) {
                browserCompiler.watching?.invalidate();
              }
            }

            this.entriesReady.resolve();
          },
        );
      },
    );
  }

  private applyBrowser(compiler: CompilerType) {
    const compilerName = compiler.options.name || 'default';
    const entryOption = compiler.options.entry;

    compiler.options.entry = async () => {
      if (this.needsManifestSync && this.serverCompiler?.watching) {
        await this.entriesReady;
      }

      const entryImports = this.options.browserEntryImports ?? [];
      const normalizedEntries: Record<string, { import: string[] }> = {};
      for (const key in this.clientEntries) {
        normalizedEntries[key] = {
          import: [...entryImports, this.clientEntries[key]],
        };
      }
      for (const [name, { file }] of Object.entries(this.loadEntries)) {
        normalizedEntries[name] = { import: [`${file}?load-entry`] };
      }

      if (typeof entryOption === 'function') {
        const currentEntry = await entryOption();
        return { ...this.prependEntryImports(currentEntry), ...normalizedEntries };
      }

      if (typeof entryOption === 'object' && !Array.isArray(entryOption)) {
        return { ...this.prependEntryImports(entryOption), ...normalizedEntries };
      }

      return normalizedEntries;
    };

    compiler.hooks.make.tap(
      'MarkoRspackBrowser',
      (compilation: CompilationType) => {
        const pendingAssets = this.createDeferredPromise<void>();
        compiler.markoAssetsPending = pendingAssets;

        compilation.hooks.afterProcessAssets.tap(
          'MarkoRspackBrowser:afterProcessAssets',
          () => {
            for (const [entryName, entrypoint] of compilation.entrypoints) {
              const assetsByType: Record<string, string[]> = {};

              for (const chunk of entrypoint.chunks) {
                for (const file of chunk.files) {
                  const asset = compilation.getAsset(file);
                  if (!asset) {
                    continue;
                  }

                  const source = asset.source;
                  if (
                    source instanceof sources.RawSource &&
                    source.buffer().length === 0
                  ) {
                    compilation.deleteAsset(file);
                    continue;
                  }

                  const ext = file.split('.').pop() || '';
                  const type = assetsByType[ext] || [];
                  assetsByType[ext] = type;
                  type.push(file);
                }

                // CSS reachable only through async chunks — e.g. a lazy
                // component's styles, which its load entry pulls via
                // import(). Kept in a separate bucket: page manifests read
                // only the initial `css` list so lazy-component CSS is
                // never eagerly linked from a page's <head>.
                const asyncCss =
                  assetsByType.asyncCss ?? (assetsByType.asyncCss = []);
                for (const asyncChunk of chunk.getAllAsyncChunks()) {
                  for (const file of asyncChunk.files) {
                    if (file.endsWith('.css') && !asyncCss.includes(file)) {
                      asyncCss.push(file);
                    }
                  }
                }
              }

              const buildAssets = this.clientAssets[compilerName] || {};
              this.clientAssets[compilerName] = buildAssets;
              buildAssets[entryName] = assetsByType;
            }

            if (this.needsManifestSync && this.serverCompiler) {
              const assetsJson = JSON.stringify(this.clientAssets);
              if (assetsJson !== this.previousClientAssetsJson) {
                this.previousClientAssetsJson = assetsJson;
                this.serverCompiler.watching?.invalidate();
              }
            }

            pendingAssets.resolve();
          },
        );
      },
    );
  }

  /**
   * Prepends `browserEntryImports` to every host-provided browser entry,
   * normalizing shorthand forms (string, string[]) along the way. Returns
   * the input untouched when the option is not set.
   */
  private prependEntryImports<T extends object>(entries: T): T {
    const prefix = this.options.browserEntryImports;
    if (!prefix?.length) return entries;

    const result = { ...entries } as Record<string, unknown>;
    for (const name of Object.keys(result)) {
      const desc = result[name];
      if (typeof desc === 'string') {
        result[name] = { import: [...prefix, desc] };
      } else if (Array.isArray(desc)) {
        result[name] = { import: [...prefix, ...desc] };
      } else if (desc && typeof desc === 'object') {
        const { import: imports, ...rest } = desc as {
          import?: unknown;
          [key: string]: unknown;
        };
        result[name] = {
          ...rest,
          import: [...prefix, ...(Array.isArray(imports) ? imports : [])],
        };
      }
    }
    return result as T;
  }

  private normalizeRuntimeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  private createDeferredPromise<T>(): Promise<T> & {
    resolve: (value: T) => void;
  } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    }) as Promise<T> & { resolve: (value: T) => void };
    promise.resolve = resolve;
    return promise;
  }

  private sortKeys<T>(obj: T): T {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.sortKeys(item)) as T;
    }

    const entries = obj as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(entries).sort()) {
      result[key] = this.sortKeys(entries[key]);
    }

    return result as T;
  }
}
