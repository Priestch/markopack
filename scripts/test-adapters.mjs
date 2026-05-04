/**
 * Test each adapter with the rspack build.
 * Usage: node scripts/test-adapters.mjs
 */

import { build } from "@rs-marko-run/rspack";
import path from "node:path";
import fs from "node:fs";

const root = path.resolve("examples/rspack-basic");
const results = [];

async function testAdapter(name, adapterFn) {
  const outputDir = path.join(root, "dist", `test-${name}`);
  const label = `adapter-${name}`;

  try {
    const adapter = adapterFn();

    // Test configure hook
    adapter?.configure?.({ root, isBuild: true });

    // Test runtimeInclude hook
    const runtimeInclude = await adapter?.runtimeInclude?.();
    console.log(`  ${label}: runtimeInclude=${runtimeInclude ?? "none"}`);
    // Test typeInfo hook
    if (adapter?.typeInfo) {
      const type = await adapter.typeInfo((s) => {});
      console.log(`  ${label}: typeInfo=${type}`);
    }

    // Test buildEnd hook existence
    console.log(`  ${label}: buildEnd=${!!adapter?.buildEnd}`);

    // Now do a real build
    const start = performance.now();
    await build({
      root,
      entry: "./src/index.ts",
      outputDir,
      mode: "production",
      adapter,
    });

    // Verify output exists
    const serverExists = fs.existsSync(path.join(outputDir, "server/index.cjs"));
    const clientExists = fs.existsSync(path.join(outputDir, "client/index.html"));
    const elapsed = ((performance.now() - start) / 1000).toFixed(2);

    // For static adapter, server bundle gets deleted after crawling — check for public/ instead
    if (name === "static") {
      const publicDir = path.join(outputDir, "server/public");
      if (!fs.existsSync(publicDir)) {
        throw new Error("static adapter did not generate public/ directory");
      }
      const files = [];
      function walk(dir) {
        for (const f of fs.readdirSync(dir)) {
          const full = path.join(dir, f);
          if (fs.statSync(full).isDirectory()) walk(full);
          else files.push(path.relative(publicDir, full));
        }
      }
      walk(publicDir);
      console.log(`  ${label}: static files generated: ${files.length} (${files.slice(0, 5).join(", ")}${files.length > 5 ? "..." : ""})`);
    } else if (!serverExists || !clientExists) {
      throw new Error(`Missing output: server=${serverExists}, client=${clientExists}`);
    }

    console.log(`  ${label}: PASS (${elapsed}s)\n`);
    results.push({ name, pass: true });
  } catch (err) {
    console.log(`  ${label}: FAIL - ${err.message}\n`);
    results.push({ name, pass: false, error: err.message });
  }
}

console.log("Testing adapters with rspack build\n");

// Test 1: No adapter
await testAdapter("none", () => null);

// Test 2: adapter-node
try {
  const { default: nodeAdapter } = await import("@rs-marko-run/adapter-node");
  await testAdapter("node", nodeAdapter);
} catch (err) {
  console.log(`  adapter-node: SKIP - ${err.message}\n`);
  results.push({ name: "node", pass: false, error: err.message });
}

// Test 3: adapter-static
try {
  const { default: staticAdapter } = await import("@rs-marko-run/adapter-static");
  await testAdapter("static", () => staticAdapter());
} catch (err) {
  console.log(`  adapter-static: SKIP - ${err.message}\n`);
  results.push({ name: "static", pass: false, error: err.message });
}

// Test 4: adapter-netlify
try {
  const { default: netlifyAdapter } = await import("@rs-marko-run/adapter-netlify");
  await testAdapter("netlify-functions", () => netlifyAdapter());
  await testAdapter("netlify-edge", () => netlifyAdapter({ edge: true }));
} catch (err) {
  console.log(`  adapter-netlify: SKIP - ${err.message}\n`);
  results.push({ name: "netlify", pass: false, error: err.message });
}

// Summary
console.log("=".repeat(40));
for (const r of results) {
  const icon = r.pass ? "ok" : "FAIL";
  console.log(`  [${icon}] adapter-${r.name}${r.error ? `: ${r.error.slice(0, 80)}` : ""}`);
}
const passed = results.filter((r) => r.pass).length;
console.log(`\n  ${passed}/${results.length} adapters passed`);

if (passed < results.length) process.exit(1);
