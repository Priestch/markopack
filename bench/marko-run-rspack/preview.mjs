import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = import.meta.dirname;
const port = Number(process.env.PORT || 4200);
const clientDist = path.join(root, "dist/client");
const serverDist = path.join(root, "dist/server");

// Load server bundle
const projectRequire = createRequire(import.meta.url);

// Clear cache and load fresh
const serverEntry = path.join(serverDist, "index.cjs");
if (!fs.existsSync(serverEntry)) {
  console.error("No build found. Run `npm run build` first.");
  process.exit(1);
}

// Execute the server bundle to set up globalThis.__marko_run__
projectRequire(serverEntry);

const { createMiddleware } = await import("@markopack/core/adapter/middleware");
const middleware = createMiddleware((request, platform) =>
  globalThis.__marko_run__.fetch(request, platform),
);

// Static file serving
const sirv = projectRequire("sirv");
const serveStatic = sirv(clientDist, { dev: false });

const server = http.createServer((req, res) => {
  if (req.url && /\.\w+$/.test(req.url)) {
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
  console.log(`Preview at http://localhost:${port}`);
});
