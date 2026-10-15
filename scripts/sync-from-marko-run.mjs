import { mkdir, readFile, writeFile } from "node:fs/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

const workspaceRoot = path.resolve(new URL("..", import.meta.url).pathname);

function parseArgs(argv) {
  const args = {
    repo:
      process.env.MARKO_RUN_REPO || "https://github.com/marko-js/run.git",
    ref: process.env.MARKO_RUN_REF || "main",
    write: true,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--repo" && argv[i + 1]) {
      args.repo = argv[++i];
    } else if (arg === "--ref" && argv[i + 1]) {
      args.ref = argv[++i];
    } else if (arg === "--check" || arg === "--dry-run") {
      args.write = false;
    } else if (arg === "--write") {
      args.write = true;
    }
  }

  return args;
}

function runGit(args, cwd) {
  execFileSync("git", args, {
    cwd,
    stdio: "inherit",
  });
}

function runGitRead(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
  }).trim();
}

function ensureRepo(repoUrl) {
  const root = path.join(os.tmpdir(), "markopack-sync");
  const dir = path.join(root, "marko-run");
  const gitDir = path.join(dir, ".git");

  fs.mkdirSync(root, { recursive: true });

  if (!fs.existsSync(gitDir)) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    execFileSync("git", ["clone", repoUrl, dir], { stdio: "inherit" });
    return dir;
  }

  const currentRemote = runGitRead(["remote", "get-url", "origin"], dir);
  if (currentRemote !== repoUrl) {
    fs.rmSync(dir, { recursive: true, force: true });
    execFileSync("git", ["clone", repoUrl, dir], { stdio: "inherit" });
  }

  return dir;
}

function checkoutRef(repoDir, ref) {
  runGit(["fetch", "--force", "--tags", "origin"], repoDir);
  runGit(["checkout", "--force", ref], repoDir);
  runGit(["reset", "--hard", ref], repoDir);
}

const CORE_MAPPINGS = [
  ["packages/run/src/vite/constants.ts", "packages/core/src/constants.ts"],
  ["packages/run/src/vite/types.ts", "packages/core/src/types.ts"],
  ["packages/run/src/vite/routes/builder.ts", "packages/core/src/routes/builder.ts"],
  ["packages/run/src/vite/routes/parse.ts", "packages/core/src/routes/parse.ts"],
  ["packages/run/src/vite/routes/vdir.ts", "packages/core/src/routes/vdir.ts"],
  ["packages/run/src/vite/routes/walk.ts", "packages/core/src/routes/walk.ts"],
  ["packages/run/src/vite/codegen/index.ts", "packages/core/src/codegen/index.ts"],
  ["packages/run/src/vite/codegen/writer.ts", "packages/core/src/codegen/writer.ts"],
  ["packages/run/src/vite/utils/fs.ts", "packages/core/src/utils/fs.ts"],
  ["packages/run/src/vite/utils/route.ts", "packages/core/src/utils/route.ts"],
  ["packages/run/src/vite/utils/agent-fix-guide.ts", "packages/core/src/utils/agent-fix-guide.ts"],
  // utils/server.ts is no longer synced: trimmed to the subset markopack uses.
  // adapter/middleware.ts is no longer vendored: re-exported from
  // @marko/run/adapter/middleware (public export since 0.11).
];

const ADAPTER_MAPPINGS = [
  {
    candidates: [
      "packages/adapters/node/src/index.ts",
      "node_modules/@marko/run-adapter-node/src/index.ts",
    ],
    target: "packages/adapter-node/src/index.ts",
  },
  {
    candidates: [
      "packages/adapters/node/src/middleware.ts",
      "node_modules/@marko/run-adapter-node/src/middleware.ts",
    ],
    target: "packages/adapter-node/src/middleware.ts",
  },
  // adapter-node/src/ensure-runtime.ts is no longer synced: trimmed to the
  // production path (the upstream Vite dev-server bootstrap can't run under
  // markopack, which drives dev itself).
  {
    candidates: [
      "packages/adapters/static/src/index.ts",
      "node_modules/@marko/run-adapter-static/src/index.ts",
    ],
    target: "packages/adapter-static/src/index.ts",
  },
  {
    candidates: [
      "packages/adapters/static/src/crawler.ts",
      "node_modules/@marko/run-adapter-static/src/crawler.ts",
    ],
    target: "packages/adapter-static/src/crawler.ts",
  },
  {
    candidates: [
      "packages/adapters/static/src/default-entry.mjs",
      "node_modules/@marko/run-adapter-static/src/default-entry.mjs",
    ],
    target: "packages/adapter-static/src/default-entry.mjs",
  },
  {
    candidates: [
      "packages/adapters/netlify/src/index.ts",
      "node_modules/@marko/run-adapter-netlify/src/index.ts",
    ],
    target: "packages/adapter-netlify/src/index.ts",
  },
  {
    candidates: [
      "packages/adapters/netlify/src/types.ts",
      "node_modules/@marko/run-adapter-netlify/src/types.ts",
    ],
    target: "packages/adapter-netlify/src/types.ts",
  },
  {
    candidates: [
      "packages/adapters/netlify/src/default-functions-entry.ts",
      "node_modules/@marko/run-adapter-netlify/src/default-functions-entry.ts",
    ],
    target: "packages/adapter-netlify/src/default-functions-entry.ts",
  },
  {
    candidates: [
      "packages/adapters/netlify/src/default-edge-entry.ts",
      "node_modules/@marko/run-adapter-netlify/src/default-edge-entry.ts",
    ],
    target: "packages/adapter-netlify/src/default-edge-entry.ts",
  },
];

function resolveFirstExisting(sourceRoot, candidates) {
  for (const rel of candidates) {
    const abs = path.join(sourceRoot, rel);
    if (fs.existsSync(abs)) {
      return abs;
    }
  }
  return null;
}

async function copyIfChanged(fromAbs, toAbs, write) {
  const relTarget = path.relative(workspaceRoot, toAbs).replaceAll("\\", "/");
  let fromData = await readFile(fromAbs, "utf8");

  fromData = applyLocalTransforms(relTarget, fromData);

  let toData = null;
  if (fs.existsSync(toAbs)) {
    toData = await readFile(toAbs, "utf8");
  }

  if (toData === fromData) {
    return "unchanged";
  }

  if (write) {
    await mkdir(path.dirname(toAbs), { recursive: true });
    await writeFile(toAbs, fromData, "utf8");
  }
  return "updated";
}

function applyLocalTransforms(target, data) {
  switch (target) {
    // markopack: page imports carry a ?server-entry query so marko-loader
    // compiles entries with entry:"page" + linkAssets instrumentation.
    case "packages/core/src/codegen/index.ts": {
      return data
        .replace(
          '`import page from "${normalizedRelativePath(rootDir, route.templateFilePath!)}";`,',
          '`import page from "${normalizedRelativePath(rootDir, route.templateFilePath!)}?server-entry";`,',
        )
        .replace(
          '`import page${route.key} from "${normalizedRelativePath(rootDir, route.templateFilePath!)}";`,',
          '`import page${route.key} from "${normalizedRelativePath(rootDir, route.templateFilePath!)}?server-entry";`,',
        );
    }
    // Note: core/src/types.ts carries local modifications (Vite-shaped hooks
    // removed from the Adapter interface) that must be re-applied after a sync.
    case "packages/adapter-node/src/index.ts": {
      return data
        .replace(
          'export type { NodePlatformInfo } from "@marko/run/adapter";',
          'export type { NodePlatformInfo } from "@markopack/core/adapter/middleware";',
        )
        .replace(/@marko\\\/run-adapter-node/g, "@markopack\\/adapter-node")
        .replace(/'@marko\/run-adapter-node'/g, "'@markopack/adapter-node'");
    }
    case "packages/adapter-node/src/middleware.ts": {
      return data.replace(
        'from "@marko/run/adapter/middleware";',
        'from "@markopack/core/adapter/middleware";',
      );
    }
    case "packages/adapter-static/src/index.ts": {
      return data
        .replace(
          'import type {\n  Adapter,\n  AdapterConfig,\n  Options as MarkoRunOptions,\n  Route,\n} from "@marko/run/vite";\nimport { getAvailablePort, loadEnv, spawnServer } from "@marko/run/vite";',
          'import type {\n  Adapter,\n  AdapterConfig,\n  Options as MarkoRunOptions,\n  Route,\n} from "@markopack/core/types";\nimport {\n  getAvailablePort,\n  loadEnv,\n  spawnServer,\n} from "@markopack/core/utils/server";',
        );
    }
    case "packages/adapter-netlify/src/index.ts": {
      return data
        .replace(/'@marko\/run-adapter-netlify'/g, "'@markopack/adapter-netlify'")
        .replace(/@marko\\\/run-adapter-netlify/g, "@markopack\\/adapter-netlify");
    }
    default:
      return data;
  }
}

async function main() {
  const { repo, ref, write } = parseArgs(process.argv.slice(2));
  const sourceRoot = ensureRepo(repo);
  checkoutRef(sourceRoot, ref);

  let updated = 0;
  let unchanged = 0;

  const checkedOut = runGitRead(["rev-parse", "HEAD"], sourceRoot);
  console.log(`Sync repo: ${repo}`);
  console.log(`Sync ref: ${ref}`);
  console.log(`Resolved commit: ${checkedOut}`);
  console.log(`Sync source: ${sourceRoot}`);
  console.log(write ? "Mode: write" : "Mode: check");

  for (const [fromRel, toRel] of CORE_MAPPINGS) {
    const fromAbs = path.join(sourceRoot, fromRel);
    const toAbs = path.join(workspaceRoot, toRel);
    if (!fs.existsSync(fromAbs)) {
      throw new Error(`Missing core source file: ${fromAbs}`);
    }
    const result = await copyIfChanged(fromAbs, toAbs, write);
    if (result === "updated") {
      updated++;
      console.log(`updated ${toRel}`);
    } else {
      unchanged++;
    }
  }

  for (const mapping of ADAPTER_MAPPINGS) {
    const fromAbs = resolveFirstExisting(sourceRoot, mapping.candidates);
    if (!fromAbs) {
      throw new Error(
        `Missing adapter source file (checked: ${mapping.candidates.join(", ")})`,
      );
    }
    const toAbs = path.join(workspaceRoot, mapping.target);
    const result = await copyIfChanged(fromAbs, toAbs, write);
    if (result === "updated") {
      updated++;
      console.log(`updated ${mapping.target}`);
    } else {
      unchanged++;
    }
  }

  console.log(`Done. updated=${updated}, unchanged=${unchanged}`);

  if (!write && updated > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
