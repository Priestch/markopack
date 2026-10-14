/**
 * Runtime module referenced by `linkAssets`-compiled Marko templates.
 *
 * When markopack compiles a page entry with the `linkAssets` compiler option,
 * the generated code imports `flush` from this module and the html runtime's
 * `withPageAssets` wrapper calls it while rendering:
 *
 *   - `type === "block"` → html written at the start of `<head>` (stylesheets)
 *   - `type === "defer"` → html written before the hydration bootstrap (scripts)
 *
 * The asset → html mapping lives in a manifest that is injected after the
 * build completes (packages/rspack) by replacing the placeholder string
 * below — the JSON.parse call keeps the literal from being constant-folded
 * away by minification. Dev mode instead populates
 * `globalThis.__MARKO_MANIFEST__` before rendering.
 */

interface AssetEntry {
  block?: string;
  defer?: string;
}

type Manifest = Record<string, AssetEntry>;

const manifest: Manifest = ((globalThis as any).__MARKO_MANIFEST__ ??=
  JSON.parse("MARKO_MANIFEST_PLACEHOLDER"));

export function flush(
  _global: unknown,
  type: "block" | "defer",
  assetId: string,
): string {
  const entry = manifest[assetId];
  if (!entry) return "";
  return type === "block" ? entry.block ?? "" : entry.defer ?? "";
}
