/**
 * Snapshot normalization + compare/write, the markopack counterpart of
 * upstream main.test.ts's getHTML()/snap() wiring (upstream normalizes away
 * vite-flavored noise; these rules target rspack output instead).
 *
 * Snapshot file format matches upstream's:
 *
 *   # Loading
 *   ```html …server html (pre-hydration)… ```
 *   # Step 0
 *   <step source>
 *   ```diff …only changed lines… ```
 *
 * Non-HTML responses snapshot the raw response body instead of DOM sections.
 */
import fs from "node:fs";
import path from "node:path";
import { diffLines } from "diff";

const HASH_RE = /([\/"'(?=:.\w/-]*?)-[0-9a-f]{8}((?:\.chunk)?\.(?:js|css)|\.\w{2,4})["'?]/g;
const PORT_RE = /:(\d{4,})/g;
const STACK_FRAME_RE = /^(\s*at)\s[^\n]+$/gm;

export function normalizeHTML(html, { fixtureRoot, workspaceRoot }) {
  return html
    .replaceAll(fixtureRoot, "[fixture]")
    .replaceAll(workspaceRoot, "[workspace]")
    .replace(HASH_RE, "$1-[hash]$2")
    .replace(PORT_RE, ":9999")
    .replace(STACK_FRAME_RE, "$1 [Normalized Error Stack]")
    .replace(/\\/g, "/");
}

export function htmlSnapshot(html, prevHtml) {
  if (prevHtml != null) {
    const diff = diffLines(prevHtml, html)
      .map((part) =>
        part.added ? `+${part.value}` : part.removed ? `-${part.value}` : "",
      )
      .filter(Boolean)
      .join("");
    return "```diff\n" + diff + "\n```\n\n";
  }
  return "```html\n" + html + "\n```\n\n";
}

export function getStepString(step) {
  return step
    .toString()
    .replace(/^.*?{\s*([\s\S]*?)\s*}.*?$/, "$1")
    .replace(/^ {4}/gm, "")
    .replace(/;$/, "");
}

/**
 * Reads `__snapshots__/<mode>.expected.md`; on mismatch returns a unified
 * diff report. UPDATE_SNAPSHOTS=1 (or `update: true`) writes instead.
 * A missing expected file counts as a mismatch (generate on first run).
 */
export function compareOrWriteSnapshot({ fixtureDir, mode, content, update }) {
  const dir = path.join(fixtureDir, "__snapshots__");
  const file = path.join(dir, `${mode}.expected.md`);
  const wantUpdate = update || process.env.UPDATE_SNAPSHOTS === "1";

  if (wantUpdate) {
    fs.mkdirSync(dir, { recursive: true });
    const existed = fs.existsSync(file);
    fs.writeFileSync(file, content);
    return { ok: true, updated: !existed, written: true };
  }

  if (!fs.existsSync(file)) {
    return {
      ok: false,
      report: `missing snapshot __snapshots__/${mode}.expected.md (run with UPDATE_SNAPSHOTS=1)`,
    };
  }

  const expected = fs.readFileSync(file, "utf8");
  if (expected === content) return { ok: true };

  const patch = diffLines(expected, content)
    .map((part) =>
      part.added
        ? `+${part.value}`
        : part.removed
          ? `-${part.value}`
          : ` ${part.value}`,
    )
    .join("");
  return {
    ok: false,
    report: `snapshot mismatch for ${mode}:\n${patch}`,
  };
}
