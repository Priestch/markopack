import "@marko/run/router";

import type { NodeMiddleware } from "./middleware";

declare global {
  var __marko_run_middleware__:
    | (<T extends any[]>(
        factory: (...args: T) => NodeMiddleware,
      ) => (...args: T) => NodeMiddleware)
    | undefined;
}

// Upstream's version boots a Vite dev server here when NODE_ENV=development.
// markopack drives dev mode itself (rebuilding and reloading the server
// bundle), so that path can never run — only the production passthrough
// remains. No longer kept in sync with upstream.
export default (globalThis.__marko_run_middleware__ ??= (factory) => factory);
