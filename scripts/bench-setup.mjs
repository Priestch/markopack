import { execSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const fixtures = [
  path.join(root, "bench/marko-run-vite"),
  path.join(root, "bench/marko-run-rspack"),
];

console.log("Building local @rs-marko-run/marko-rspack package");
execSync("npm run build", {
  cwd: path.join(root, "packages/marko-rspack"),
  stdio: "inherit",
  shell: true,
});

console.log("Building local @rs-marko-run/rspack package");
execSync("npm run build", {
  cwd: path.join(root, "packages/rspack"),
  stdio: "inherit",
  shell: true,
});

for (const cwd of fixtures) {
  console.log(`Installing dependencies in ${cwd}`);
  execSync("npm install", { cwd, stdio: "inherit" });
}

console.log("Benchmark fixtures are ready.");
