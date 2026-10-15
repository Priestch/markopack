import { fetch } from "@marko/run/router";
import type { Config, Context } from "@netlify/edge-functions";

import type { NetlifyEdgePlatformInfo } from "./types";

export default async function (request: Request, context: Context) {
  return (
    (await fetch<NetlifyEdgePlatformInfo>(request, context)) || context.next()
  );
}

export const config: Config = {
  path: "/*",
  // markopack: browser assets live under /static (Rspack output), so those
  // skip the edge function; anything else falls through to context.next().
  excludedPath: ["/static/*"],
};
