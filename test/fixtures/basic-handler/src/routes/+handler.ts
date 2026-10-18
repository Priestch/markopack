// Exercises the `@marko/run/router` import from route code: in dev this
// resolves through the runtime's router facade (deferring to
// globalThis.__marko_run__), in production straight to the generated
// router — match() must work identically in both.
import { match } from "@marko/run/router";

export const GET: MarkoRun.Handler = (context, next) => {
  const matched = match("GET", "/") ? "matched" : "no-match";
  return next({
    value: `Data from handler (router ${matched})`
  })
}
