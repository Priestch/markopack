// Since @marko/run 0.11 the adapter middleware ships as a public export
// (`@marko/run/adapter/middleware`) with an identical API, so this is
// re-exported instead of vendored. Keep this file out of the sync list.
export {
  copyResponseHeaders,
  createMiddleware,
  getBodyReader,
  getOrigin,
} from "@marko/run/adapter/middleware";

export type {
  NodeMiddleware,
  NodeMiddlewareOptions,
  NodePlatformInfo,
} from "@marko/run/adapter/middleware";
