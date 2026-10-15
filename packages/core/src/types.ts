import type {
  HttpVerb,
  RoutableFileType,
  RoutableFileTypes,
} from "./constants";
import type { SpawnedServer } from "./utils/server";

export type { HttpVerb, RoutableFileType };

export type StartServer = (port?: number) => Promise<void>;

export interface AdapterConfig {
  root: string;
  isBuild: boolean;
  [name: PropertyKey]: any;
}

export interface StartOptions {
  cwd: string;
  args: string[];
  port?: number;
  envFile?: string;
}

export interface StartDevOptions extends StartOptions {}

export interface StartPreviewOptions extends StartOptions {
  dir: string;
  entry?: string;
}

export interface Adapter {
  readonly name: string;
  configure?(config: AdapterConfig): void;
  pluginOptions?(options: Options): Promise<Options> | Options | undefined;
  getEntryFile?(): Promise<string> | string;
  startDev?(event: {
    entry: string | undefined;
    // `config` was a Vite `InlineConfig` upstream. markopack never invokes this
    // hook (its dev server is driven by @markopack/rspack), and adapters only
    // pass the event through, so it stays loosely typed.
    config: any;
    options: StartDevOptions;
  }): Promise<SpawnedServer> | SpawnedServer;
  startPreview?(event: {
    entry: string | undefined;
    options: StartPreviewOptions;
  }): Promise<SpawnedServer> | SpawnedServer;
  buildEnd?(event: {
    // Was a Vite `ResolvedConfig` upstream; markopack passes a stub.
    config: unknown;
    routes: BuiltRoutes;
    builtEntries: string[];
    sourceEntries: string[];
  }): Promise<void> | void;
  typeInfo?(writer: (data: string) => void): Promise<string> | string;
  runtimeInclude?(): Promise<string | undefined> | string | undefined;
  routesGenerated?(event: {
    routes: BuiltRoutes;
    virtualFiles: Map<string, string>;
    meta: RouteGenerationData;
  }): Promise<void> | void;
  isEntryTemplate?(event: { template: string; importer: string }): boolean;
}

export interface RouterOptions {
  trailingSlashes:
    | "Ignore"
    | "RedirectWithout"
    | "RedirectWith"
    | "RewriteWithout"
    | "RewriteWith";
}

export interface MarkoRunOptions extends Partial<RouterOptions> {
  routesDir?: string;
  emitRoutes?(routes: Route[]): void | Promise<void>;
  adapter?: Adapter | null;
}

export type Options = MarkoRunOptions;

export interface Route {
  key: string;
  index: number;
  path: PathInfo;
  layouts: RoutableFile[];
  middleware: RoutableFile[];
  meta?: RoutableFile;
  handler?: RoutableFile;
  page?: RoutableFile;
  templateFilePath?: string;
}

export interface PathInfo {
  id: string;
  path: string;
  segments: string[];
  params?: Record<string, number | null>;
  isEnd?: boolean;
}

export interface SpecialRoutes {
  [RoutableFileTypes.NotFound]?: Route;
  [RoutableFileTypes.Error]?: Route;
}

export interface RoutableFile {
  id: string;
  name: string;
  type: RoutableFileType;
  filePath: string;
  verbs?: HttpVerb[];
}

export type BuiltRoutes = {
  list: Route[];
  special: SpecialRoutes;
  middleware: RoutableFile[];
};

export interface PackageData {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface RouteGenerationData {
  buildTime: number;
  renderTime: number;
}

export interface ExplorerData {
  meta: RouteGenerationData;
  routes: Record<string, Route>;
  files: Record<string, string>;
}

export interface ExternalRoutes {
  name: string;
  routes: {
    path: string;
    entryFile: string;
    verbs: HttpVerb[];
  }[];
}
