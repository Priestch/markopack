import { dev } from "@markopack/rspack";
import fs from "node:fs";
import path from "node:path";
import { Window } from "happy-dom";
import { installShims } from "./shims.mjs";

// stage basic-page scratch
const src = "/home/gaopeng/Enter/markopack/test/fixtures/basic-page/src";
const scratch = "/home/gaopeng/Enter/markopack/test/.work/smoke-dev";
fs.rmSync(scratch, { recursive: true, force: true });
fs.cpSync(src, scratch + "/src", { recursive: true });
fs.writeFileSync(scratch + "/src/index.ts", "");

const server = await dev({
  root: scratch,
  entry: "./src/index.ts",
  outputDir: "dist",
  port: 0,
  adapter: null,
});
console.log("dev server port:", server.port);

// wait past 503
for (let i = 0; i < 120; i++) {
  const res = await fetch(`http://127.0.0.1:${server.port}`).catch(() => null);
  if (res && res.status !== 503) break;
  await new Promise((r) => setTimeout(r, 250));
}

const res = await fetch(`http://127.0.0.1:${server.port}`);
const html = await res.text();
console.log("dev HTML:\n" + html);

const t0 = Date.now();
const window = new Window({
  url: res.url,
  settings: {
    enableJavaScriptEvaluation: true,
    disableJavaScriptFileLoading: false,
    enableCSSFileLoading: false,
    handleDisabledFileLoadingAsSuccess: true,
    disableComputedStyleRendering: true,
    suppressInsecureJavaScriptEnvironmentWarning: true,
    fetch: { disableSameOriginPolicy: true },
    timer: { maxTimeout: 15000 },
  },
});
installShims(window);
console.log("writing…");
const writeP = Promise.resolve().then(() => {
  window.document.write(html);
  window.document.close();
});
await Promise.race([
  writeP.then(() => console.log(`write returned in ${Date.now() - t0}ms`)),
  new Promise((r) => setTimeout(() => {
    console.log(`write DID NOT return within 10s; app html: ${window.document.body?.innerHTML?.slice(0, 200)}`);
    process.exit(0);
  }, 10000)),
]);
console.log("body:", window.document.body?.innerHTML?.slice(0, 200));
await window.happyDOM.waitUntilComplete().catch(() => {});
console.log("settled; body:", window.document.body?.innerHTML?.slice(0, 200));
process.exit(0);
