/**
 * Production preview server, lifted from examples/rspack-basic/preview.mjs:
 * require the built server bundle, wrap its fetch handler in the shared
 * @marko/run middleware, serve dist/client with sirv. close() destroys
 * keep-alive connections first so it never hangs (same lesson as dev.ts).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const testRequire = createRequire(import.meta.url);

export async function startPreviewServer({ root, outputDir = "dist" }) {
  const clientDist = path.join(root, outputDir, "client");
  const serverEntry = path.join(root, outputDir, "server", "index.cjs");
  if (!fs.existsSync(serverEntry)) {
    throw new Error(`No server bundle at ${serverEntry} — build first.`);
  }

  testRequire(serverEntry);

  const { createMiddleware } = await import("@markopack/core/adapter/middleware");
  const middleware = createMiddleware((request, platform) =>
    globalThis.__marko_run__.fetch(request, platform),
  );

  const sirv = testRequire("sirv");
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

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: server.address().port,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

export { testRequire };
