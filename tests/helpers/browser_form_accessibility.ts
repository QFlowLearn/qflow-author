import { expect } from 'vitest';

import axe from 'axe-core';
import type { Locator, Page } from 'playwright';

/** Audit the caller's real form element using the actual installed axe browser script. */
export async function assertNativeFormAccessibility(page: Page, form: Locator): Promise<void> {
  await page.addScriptTag({ content: axe.source });
  const violations: unknown = await form.evaluate(async (node) => {
    // SAFETY: the real axe script installed above owns this public browser interface.
    const report = await (globalThis as typeof globalThis & {
      axe: { run: (element: Element) => Promise<{ violations: readonly unknown[] }> };
    }).axe.run(node);
    return report.violations;
  });
  expect(violations).toStrictEqual([]);
}
