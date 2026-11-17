import { expect } from 'vitest';

import type { Locator, Page } from 'playwright';
import type { I18n } from '../../lib/i18n/messages.ts';
import type { BrowserEvidenceDirectory } from './browser_evidence.ts';
import { assertNativeFormAccessibility } from './browser_form_accessibility.ts';

/** Capture and audit the real protected-question form at narrow and desktop widths. */
export async function captureQuestionProtectionFields(
  page: Page,
  surface: Locator,
  i18n: I18n,
  evidence: BrowserEvidenceDirectory,
  prefix: string,
): Promise<void> {
  const summary = surface.locator('summary').filter({
    hasText: i18n.t('assessments.partSettings.fixedQuestions'),
  });
  const group = surface.getByRole('group', {
    name: i18n.t('assessments.partSettings.fixedQuestions'),
    exact: true,
  });
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await summary.locator('..').scrollIntoViewIfNeeded();
    await group.evaluate((node) => node.scrollIntoView({ block: 'end' }));
    if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) {
      expect.unreachable(
        'Expected await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)',
      );
    }
    for (const checkbox of await group.getByRole('checkbox').all()) {
      const target = await checkbox.locator('..').boundingBox();
      if (!(target && target.height >= 48)) {
        expect.unreachable('Expected target && target.height >= 48');
      }
    }
    await page.screenshot({ path: evidence.path(`${prefix}-${width}.png`) });
  }
  await assertNativeFormAccessibility(page, group);
}
