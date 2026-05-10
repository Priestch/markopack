import * as clack from "@clack/prompts";
import type { Adapter } from "./templates.js";

export interface PromptResult {
  name: string;
  adapter: Adapter;
  typescript: boolean;
}

const ADAPTERS: { value: Adapter; label: string; hint: string }[] = [
  { value: "node", label: "Node.js", hint: "Express/Connect-style server" },
  { value: "static", label: "Static", hint: "Pre-rendered static site" },
  { value: "netlify", label: "Netlify", hint: "Netlify Functions" },
];

export async function runPrompts(
  defaults: Partial<PromptResult>,
): Promise<PromptResult | null> {
  const name =
    defaults.name ??
    (await clack.text({
      message: "Project name",
      placeholder: "my-markopack-app",
      validate: (v) => {
        if (!v) return "Please enter a project name";
        if (!/^[a-z0-9@/-]+$/.test(v))
          return "Use only lowercase letters, numbers, hyphens, and slashes";
      },
    }));

  if (clack.isCancel(name)) return null;

  const adapter =
    defaults.adapter ??
    (await clack.select({
      message: "Which adapter?",
      options: ADAPTERS,
      initialValue: "node",
    }));

  if (clack.isCancel(adapter)) return null;

  const typescript =
    defaults.typescript ??
    (await clack.confirm({
      message: "Use TypeScript?",
      initialValue: true,
    }));

  if (clack.isCancel(typescript)) return null;

  return { name, adapter, typescript };
}
