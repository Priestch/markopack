import assert from "assert";

import { Step } from "../../harness/steps.mjs";

export const steps: Step[] = [
  async ({ page }) => {
    const url = new URL(page.url());
    const response = await page.fetch(url.href, { method: "QUERY" });
    assert.equal(
      response.status,
      404,
      "QUERY without a handler should not be served",
    );
  },
];
