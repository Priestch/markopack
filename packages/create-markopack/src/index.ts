import { resolve } from "node:path";
import { execSync } from "node:child_process";
import pc from "picocolors";
import * as clack from "@clack/prompts";
import { runPrompts } from "./prompts.js";
import { scaffold } from "./scaffold.js";
import type { Adapter } from "./templates.js";

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--yes" || arg === "-y") {
      flags.yes = true;
    } else if (arg === "--adapter" || arg === "-a") {
      flags.adapter = argv[++i];
    } else if (arg === "--typescript" || arg === "--ts") {
      const val = argv[++i];
      flags.typescript = val !== "no" && val !== "false";
    } else if (arg.startsWith("--no-typescript") || arg === "--no-ts") {
      flags.typescript = false;
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
    }
  }

  return { positional, flags };
}

async function main() {
  const { positional, flags } = parseArgs(process.argv);

  const defaults: Record<string, unknown> = {};
  if (positional[0]) defaults.name = positional[0];
  if (typeof flags.adapter === "string") defaults.adapter = flags.adapter;
  if (flags.typescript !== undefined) defaults.typescript = flags.typescript;
  if (flags.yes) {
    defaults.name ??= "my-markopack-app";
    defaults.adapter ??= "node";
    defaults.typescript ??= true;
  }

  clack.intro(pc.bgCyan(pc.black(" markopack ")));

  const result = await runPrompts(defaults as any);
  if (!result) {
    clack.cancel("Cancelled");
    process.exit(0);
  }

  const targetDir = resolve(result.name);

  const s = clack.spinner();
  s.start("Scaffolding project");

  await scaffold(targetDir, result);

  s.message("Installing dependencies");
  try {
    execSync("npm install", { cwd: targetDir, stdio: "pipe" });
  } catch {
    s.stop("Dependencies installed with warnings");
    clack.note("Run `npm install` manually in the project directory.", "Note");
  }

  s.message("Initializing git");
  try {
    execSync("git init", { cwd: targetDir, stdio: "pipe" });
    execSync("git add -A", { cwd: targetDir, stdio: "pipe" });
    execSync('git commit -m "Initial commit from create-markopack"', {
      cwd: targetDir,
      stdio: "pipe",
    });
  } catch {}

  s.stop("Project created");

  clack.note(
    [
      `cd ${result.name}`,
      "npm run dev",
      "",
      `Adapter: ${result.adapter}`,
      `TypeScript: ${result.typescript ? "yes" : "no"}`,
    ].join("\n"),
    "Next steps",
  );

  clack.outro("Done! Happy coding.");
}

main().catch((err) => {
  clack.cancel(err.message);
  process.exit(1);
});
