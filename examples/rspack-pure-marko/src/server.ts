import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import App from "./app.marko";

const PORT = Number(process.env.PORT || 3100);
const clientDist = path.resolve(process.cwd(), "dist/client");

const MIME: Record<string, string> = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".map": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function renderShell(): string {
  // index.html already references the right bundle (hashed in production,
  // plain index.js in development) via HtmlRspackPlugin.
  let html = fs.readFileSync(path.join(clientDist, "index.html"), "utf8");
  html = html.replace(
    '<div id="app"></div>',
    `<div id="app">${App.render({}).toString()}</div>`,
  );
  return html;
}

const server = http.createServer((req, res) => {
  const url = (req.url ?? "/").split("?")[0];
  const file = path.join(clientDist, url);

  if (url !== "/" && file.startsWith(clientDist) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.setHeader("content-type", MIME[path.extname(file)] ?? "application/octet-stream");
    fs.createReadStream(file).pipe(res);
    return;
  }

  res.setHeader("content-type", "text/html;charset=UTF-8");
  res.end(renderShell());
});

server.listen(PORT, () => {
  console.log(`  ➜  Pure Marko server: http://localhost:${PORT}/`);
});

// markopack's dev mode calls this before reloading the server bundle,
// so the old server releases the port.
export function close() {
  server.close();
  server.closeAllConnections?.();
}
