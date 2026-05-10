import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TemplateOptions } from "./templates.js";
import * as t from "./templates.js";

export async function scaffold(targetDir: string, opts: TemplateOptions) {
  const srcRoutes = join(targetDir, "src", "routes", "about");

  await mkdir(srcRoutes, { recursive: true });

  const ext = opts.typescript ? ".ts" : ".js";

  const files: [string, string][] = [
    ["package.json", t.packageJson(opts)],
    ["dev.mjs", t.devMjs(opts)],
    ["build.mjs", t.buildMjs(opts)],
    ["preview.mjs", t.previewMjs(opts)],
    [".gitignore", t.gitignore()],
    [`src/index${ext}`, t.entryFile(opts)],
    ["src/routes/+layout.marko", t.layoutMarko()],
    ["src/routes/+page.marko", t.pageMarko()],
    ["src/routes/+handler" + ext, t.handlerFile(opts)],
    ["src/routes/about/+page.marko", t.aboutPageMarko()],
  ];

  if (opts.typescript) {
    files.push(["tsconfig.json", t.tsconfig()]);
  }

  await Promise.all(
    files.map(([filePath, content]) =>
      writeFile(join(targetDir, filePath), content),
    ),
  );
}
