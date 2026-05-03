import { execSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const fixtures = [
  path.join(root, "bench/marko-run-vite"),
  path.join(root, "bench/marko-run-rsbuild"),
];

for (const cwd of fixtures) {
  console.log(`Installing dependencies in ${cwd}`);
  execSync("npm install", { cwd, stdio: "inherit" });
}

console.log("Benchmark fixtures are ready.");
