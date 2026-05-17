export type Adapter = "node" | "static" | "netlify";

export interface TemplateOptions {
  name: string;
  adapter: Adapter;
  typescript: boolean;
}

const ext = (opts: TemplateOptions) => (opts.typescript ? ".ts" : ".js");

export function packageJson(opts: TemplateOptions): string {
  const deps: Record<string, string> = {
    marko: "^6.0.0",
  };
  const devDeps: Record<string, string> = {
    "@markopack/rspack": "^0.1.0",
  };

  if (opts.adapter === "node") {
    deps.sirv = "^3.0.1";
  } else if (opts.adapter === "static") {
    devDeps["@markopack/adapter-static"] = "^0.1.0";
  } else if (opts.adapter === "netlify") {
    devDeps["@markopack/adapter-netlify"] = "^0.1.0";
  }

  return JSON.stringify(
    {
      name: opts.name,
      version: "0.0.1",
      private: true,
      type: "module",
      scripts: {
        dev: "node dev.mjs",
        build: "node build.mjs",
        preview: "node preview.mjs",
      },
      dependencies: deps,
      devDependencies: devDeps,
    },
    null,
    2,
  );
}

export function devMjs(opts: TemplateOptions): string {
  const entry = opts.typescript ? "./src/index.ts" : "./src/index.js";
  return `import { dev } from "@markopack/rspack";
${adapterImport(opts)}\
dev({
  root: import.meta.dirname,
  entry: "${entry}",
  outputDir: "dist",
  mode: "development",${adapterOption(opts)}
});
`;
}

export function buildMjs(opts: TemplateOptions): string {
  const entry = opts.typescript ? "./src/index.ts" : "./src/index.js";
  return `import { build } from "@markopack/rspack";
${adapterImport(opts)}\
build({
  root: import.meta.dirname,
  entry: "${entry}",
  outputDir: "dist",
  mode: "production",${adapterOption(opts)}
});
`;
}

export function previewMjs(opts: TemplateOptions): string {
  if (opts.adapter === "node") {
    return `import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = import.meta.dirname;
const port = Number(process.env.PORT || 3000);
const clientDist = path.join(root, "dist/client");
const serverDist = path.join(root, "dist/server");

const projectRequire = createRequire(import.meta.url);

const serverEntry = path.join(serverDist, "index.cjs");
if (!fs.existsSync(serverEntry)) {
  console.error("No build found. Run \`npm run build\` first.");
  process.exit(1);
}

projectRequire(serverEntry);

const { createMiddleware } = await import("@markopack/core/adapter/middleware");
const middleware = createMiddleware((request, platform) =>
  globalThis.__marko_run__.fetch(request, platform),
);

const sirv = projectRequire("sirv");
const serveStatic = sirv(clientDist, { dev: false });

const server = http.createServer((req, res) => {
  if (req.url && /\\.\\w+$/.test(req.url)) {
    serveStatic(req, res);
  } else {
    middleware(req, res, (err) => {
      if (err) {
        res.statusCode = 500;
        res.end(err.message);
      } else {
        res.statusCode = 404;
        res.end("Not Found");
      }
    });
  }
});

server.listen(port, () => {
  console.log(\`Preview at http://localhost:\${port}\`);
});
`;
  }

  if (opts.adapter === "static") {
    return `import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = import.meta.dirname;
const port = Number(process.env.PORT || 3000);
const publicDir = path.join(root, "dist/client");

if (!fs.existsSync(publicDir)) {
  console.error("No build found. Run \`npm run build\` first.");
  process.exit(1);
}

const mimeTypes: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  let filePath = path.join(publicDir, req.url === "/" ? "index.html" : req.url!);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(publicDir, "index.html");
  }
  const ext = path.extname(filePath);
  res.setHeader("Content-Type", mimeTypes[ext] || "application/octet-stream");
  fs.createReadStream(filePath).pipe(res);
});

server.listen(port, () => {
  console.log(\`Preview at http://localhost:\${port}\`);
});
`;
  }

  // netlify
  return [
    'console.log("Use `netlify dev` to preview your Netlify site locally.");',
    'console.log("Install Netlify CLI: npm install -g netlify-cli");',
  ].join("\n") + "\n";
}

export function entryFile(opts: TemplateOptions): string {
  return `import App from './routes/+page.marko';

App.renderSync({}).appendTo(document.body);
`;
}

export function layoutMarko(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>markopack</title>
  <style>
    :root {
      --color-bg: #ffffff;
      --color-text: #1a1a2e;
      --color-primary: #4361ee;
      --color-border: #e2e8f0;
      --font-sans: system-ui, -apple-system, sans-serif;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--font-sans);
      color: var(--color-text);
      background: var(--color-bg);
      line-height: 1.6;
    }
    a { color: var(--color-primary); }
  </style>
</head>
<body>
  <main>
    <\${input.content}/>
  </main>
</body>
</html>
`;
}

export function pageMarko(): string {
  return `<style>
  .hero {
    max-width: 640px;
    margin: 8rem auto;
    padding: 0 1.5rem;
    text-align: center;
  }
  h1 { font-size: 2.5rem; margin-bottom: 1rem; }
  p { color: #64748b; margin-bottom: 2rem; }
  .links { display: flex; gap: 1rem; justify-content: center; }
  .links a {
    padding: 0.5rem 1rem;
    border-radius: 6px;
    text-decoration: none;
  }
  .links a.primary {
    background: var(--color-primary);
    color: white;
  }
  .links a.secondary {
    border: 1px solid var(--color-border);
    color: var(--color-text);
  }
</style>

<div class="hero">
  <h1>Welcome to markopack</h1>
  <p>Build Marko SSR applications with Rspack.</p>
  <div class="links">
    <a href="/about" class="secondary">About page</a>
    <a href="https://github.com/Priestch/markopack" class="primary" target="_blank">GitHub</a>
  </div>
</div>
`;
}

export function aboutPageMarko(): string {
  return `<style>
  .page {
    max-width: 640px;
    margin: 4rem auto;
    padding: 0 1.5rem;
  }
  h1 { margin-bottom: 1rem; }
  p { color: #64748b; }
  a { display: inline-block; margin-top: 2rem; }
</style>

<div class="page">
  <h1>About</h1>
  <p>This is a markopack project using Rspack and Marko.</p>
  <a href="/">Back to home</a>
</div>
`;
}

export function handlerFile(opts: TemplateOptions): string {
  if (opts.typescript) {
    return `import type { RequestContext } from "@markopack/core/vite/types";

export async function GET(context: RequestContext) {
  return new Response("Hello from markopack!");
}
`;
  }
  return `export async function GET(context) {
  return new Response("Hello from markopack!");
}
`;
}

export function gitignore(): string {
  return `node_modules
dist
.marko-run
.env
`;
}

export function tsconfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "bundler",
      },
    },
    null,
    2,
  );
}

function adapterImport(opts: TemplateOptions): string {
  if (opts.adapter === "static") {
    return `import staticAdapter from "@markopack/adapter-static";\n`;
  }
  if (opts.adapter === "netlify") {
    return `import netlifyAdapter from "@markopack/adapter-netlify";\n`;
  }
  return "";
}

function adapterOption(opts: TemplateOptions): string {
  if (opts.adapter === "static") {
    return "\n  adapter: staticAdapter(),";
  }
  if (opts.adapter === "netlify") {
    return "\n  adapter: netlifyAdapter(),";
  }
  return "";
}
