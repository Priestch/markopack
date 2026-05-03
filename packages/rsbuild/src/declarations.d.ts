// Type declarations for @marko/run internal modules
// These are imported via relative paths from the monorepo

declare module "@rs-marko-run/core/vite/codegen" {
  export function renderRouteTemplate(route: any, markoApi?: string): string;
  export function renderRouteEntry(route: any, rootDir: string): string;
  export function renderRouter(
    routes: any,
    rootDir: string,
    runtimeInclude?: string,
    options?: { trailingSlashes: string },
  ): string;
  export function renderMiddleware(middleware: any[], rootDir: string): string;
  export function renderRouteTypeInfo(
    routes: any,
    outDir: string,
    adapter?: any,
  ): Promise<string>;
}

declare module "@rs-marko-run/core/vite/constants" {
  export const markoRunFilePrefix: string;
  export const virtualFilePrefix: string;
  export const httpVerbs: readonly string[];
  export const RoutableFileTypes: Record<string, string>;
  export type RoutableFileType = string;
  export type HttpVerb = string;
}

declare module "@rs-marko-run/core/vite/routes/builder" {
  export function buildRoutes(
    sources: any | any[],
    outDir: string,
  ): Promise<any>;
  export function matchRoutableFile(filename: string): string | null;
}

declare module "@rs-marko-run/core/vite/routes/walk" {
  export function createFSWalker(dir: string): any;
}

declare module "@rs-marko-run/core/vite/types" {
  export interface Adapter {
    readonly name: string;
    configure?(config: any): void;
    pluginOptions?(options: any): any;
    getEntryFile?(): Promise<string> | string;
    buildEnd?(event: any): Promise<void> | void;
    typeInfo?(writer: (data: string) => void): Promise<string> | string;
    runtimeInclude?(): Promise<string | undefined> | string | undefined;
    routesGenerated?(event: any): Promise<void> | void;
  }

  export interface BuiltRoutes {
    list: Route[];
    special: Record<string, Route>;
    middleware: RoutableFile[];
  }

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
  }

  export interface RoutableFile {
    id: string;
    name: string;
    type: string;
    filePath: string;
    verbs?: string[];
  }
}

declare module "@rs-marko-run/core/vite/utils/fs" {
  export function normalizePath(p: string): string;
}

declare module "@rs-marko-run/core/vite/utils/route" {
  export function getRouteVirtualFileName(route: any): string;
}
