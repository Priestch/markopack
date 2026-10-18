/**
 * Runtime stand-ins for the types fixture `test.config.ts` files import from
 * upstream's `../../main.test`. The sync script rewrites that import to this
 * module. Upstream declares:
 *
 *   export type Step = (context: StepContext) => Promise<unknown> | unknown;
 *   export type StepContext = { page: BrowserPage; response: Response };
 *
 * The import in synced configs is a plain `import { Step, StepContext }`
 * (not `import type`), so it survives Node's type stripping as a real module
 * request — these undefined exports satisfy it at runtime.
 */
export const Step = undefined;
export const StepContext = undefined;
