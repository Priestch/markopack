#!/usr/bin/env node
// Headless-Chrome hydration probe driven over CDP (zero deps — uses the
// global WebSocket available in Node >= 22). Usage:
//   node headless-hydration-check.mjs <url> <selector> <expected-attr> [ms]
//   node headless-hydration-check.mjs <url> <selector> <attr> <expected-value> [ms]
// Exits 0 when the element matching <selector> ends up with <expected-attr>
// set (proof the hydration effect ran) — and, when <expected-value> is
// given, exactly equal to it. Exits 1 otherwise.
import { spawn } from "node:child_process";

const [url, selector, attr, maybeExpected, maybeWait] = process.argv.slice(2);
const hasExpected = maybeExpected !== undefined && !/^\d+$/.test(maybeExpected);
const expected = hasExpected ? maybeExpected : undefined;
const waitMs = hasExpected ? (maybeWait ?? "6000") : (maybeExpected ?? "6000");
if (!url || !selector || !attr) {
  console.error("usage: headless-hydration-check.mjs <url> <selector> <attr> [expected-value] [ms]");
  process.exit(2);
}

const port = 9333 + (process.pid % 500);
const chrome = spawn("/usr/bin/google-chrome", [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--remote-debugging-port=" + port,
  "--user-data-dir=/tmp/markopack-chrome-" + process.pid,
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wsUrl() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(100);
  }
  throw new Error("chrome devtools endpoint never came up");
}

let seq = 0;
const pending = new Map();
function send(ws, method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

try {
  const ws = new WebSocket(await wsUrl());
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id).resolve(msg.result);
      pending.delete(msg.id);
    }
  };

  await send(ws, "Runtime.enable");
  await send(ws, "Page.enable");
  await send(ws, "Page.navigate", { url });
  await sleep(Number(waitMs));

  const { result } = await send(ws, "Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      return el ? el.getAttribute(${JSON.stringify(attr)}) : null;
    })()`,
  });
  const value = result?.value;

  console.log(`${selector}[${attr}] = ${JSON.stringify(value)}`);
  const pass = expected !== undefined ? value === expected : value !== null;
  process.exitCode = pass ? 0 : 1;
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  chrome.kill();
}
