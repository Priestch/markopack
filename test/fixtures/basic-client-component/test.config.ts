import { Step, StepContext } from "../../harness/steps.mjs";

export const steps: Step[] = [
  (ctx) => click(ctx),
  (ctx) => click(ctx),
  (ctx) => click(ctx),
];

async function click({ page }: StepContext) {
  await page.click("button");
}
