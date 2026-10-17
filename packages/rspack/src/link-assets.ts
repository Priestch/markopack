import fs from "node:fs";
import type MarkoRspackPlugin from "@markopack/compiler";

interface AssetEntry {
  block?: string;
  defer?: string;
}

/**
 * Builds the asset manifest — page entries (page template id → html tags
 * for their browser chunks) and lazy-component entries (readyId → tags for
 * the load-entry chunk + the component's css) — and injects it into the
 * emitted server bundle, replacing the placeholder inside the bundled
 * link-assets runtime.
 *
 * Runs after the MultiCompiler finishes: the server compiler discovers page
 * and load entries during its build, the browser compiler then emits their
 * chunks — only at that point are the final file names (with content
 * hashes) known.
 *
 * The web build's publicPath is "/" (see config.ts), so asset urls are
 * root-absolute.
 */
export function buildLinkAssetsManifest(
  markoPlugin: MarkoRspackPlugin,
): Record<string, AssetEntry> {
  const registry: Map<string, string> | undefined = (
    globalThis as any
  ).__markopack_page_assets__;

  const entries = markoPlugin.discoveredClientEntries;
  const loadEntries = markoPlugin.discoveredLoadEntries;
  const assetsByCompiler = markoPlugin.collectedClientAssets;

  const manifest: Record<string, AssetEntry> = {};

  for (const [entryId, resource] of Object.entries(entries)) {
    const pageFile = resource.replace(/\?browser-entry$/, "");
    const assetId = registry?.get(pageFile);
    if (!assetId) continue;

    const js: string[] = [];
    const css: string[] = [];
    for (const compilerAssets of Object.values(assetsByCompiler)) {
      const byExt = compilerAssets[entryId];
      if (!byExt) continue;
      js.push(...(byExt.js ?? []));
      css.push(...(byExt.css ?? []));
    }

    manifest[assetId] = {
      block: css.map((f) => `<link rel="stylesheet" href="/${f}">`).join(""),
      defer: js
        .map((f) => `<script type="module" src="/${f}"></script>`)
        .join(""),
    };
  }

  // Lazy components (`with { load: ... }`): keyed by readyId — what the
  // SSR runtime flushes when it wraps the tag with withLoadAssets. The
  // block links the component's css (from the async chunk the load entry
  // imports); the defer loads the load-entry chunk, which imports the
  // component and calls ready(readyId) to unblock hydration. `async`
  // matters: the trigger script (idle/visible/…) may inject this long
  // after parse.
  for (const [entryName, { readyId }] of Object.entries(loadEntries)) {
    const js: string[] = [];
    const css: string[] = [];
    for (const compilerAssets of Object.values(assetsByCompiler)) {
      const byExt = compilerAssets[entryName];
      if (!byExt) continue;
      js.push(...(byExt.js ?? []));
      css.push(...(byExt.css ?? []));
      css.push(...(byExt.asyncCss ?? []));
    }

    manifest[readyId] = {
      block: css.map((f) => `<link rel="stylesheet" href="/${f}">`).join(""),
      defer: js
        .map((f) => `<script async type="module" src="/${f}"></script>`)
        .join(""),
    };
  }

  return manifest;
}

export function injectLinkAssetsManifest(
  markoPlugin: MarkoRspackPlugin,
  serverBundlePath: string,
): void {
  const manifest = buildLinkAssetsManifest(markoPlugin);

  const placeholder = "MARKO_MANIFEST_PLACEHOLDER";
  if (process.env.MARKOPACK_DEBUG) {
    console.error("[markopack:link-assets] manifest:", JSON.stringify(manifest, null, 1));
  }
  let content: string;
  try {
    content = fs.readFileSync(serverBundlePath, "utf8");
  } catch {
    return; // no server bundle emitted — nothing to inject into
  }

  if (!content.includes(placeholder)) {
    if (Object.keys(manifest).length > 0) {
      throw new Error(
        "markopack: page assets were built but the server bundle has no " +
          `${placeholder} — was @markopack/compiler rebuilt after the ` +
          "link-assets change?",
      );
    }
    return; // no linkAssets-compiled pages — nothing to do
  }

  // The placeholder sits inside a double-quoted JS string
  // (JSON.parse("…")), so escape the JSON for that context. Replacement uses
  // a callback: the JSON contains "$" sequences (entry names derive from
  // route files like $volId) that are special in replacement strings.
  const embedded = JSON.stringify(JSON.stringify(manifest)).slice(1, -1);
  fs.writeFileSync(
    serverBundlePath,
    content.replaceAll(placeholder, () => embedded),
  );
}
