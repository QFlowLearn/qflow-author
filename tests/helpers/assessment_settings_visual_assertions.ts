import { expect } from 'vitest';

import type { Locator, Page } from 'playwright';
import type { I18n } from '../../lib/i18n/messages.ts';
import type { BrowserEvidenceDirectory } from './browser_evidence.ts';
import { assertNativeFormAccessibility } from './browser_form_accessibility.ts';
import { captureQuestionProtectionFields } from './question_protection_browser.ts';
import { assertSettingsFailureMessages } from './assessment_arrangement_status_browser.ts';

/** Audit the saved settings form in each locale/theme at narrow and desktop widths. */
export async function assertAssessmentSettingsVisuals(input: {
  readonly page: Page;
  readonly rail: Locator;
  readonly card: Locator;
  readonly i18n: I18n;
  readonly evidence: BrowserEvidenceDirectory;
  readonly locale: string;
  readonly theme: string;
  readonly maximum: string;
  readonly statusEndpoint: string | null;
  readonly fixed: readonly boolean[];
  readonly instructionsHtml: string;
}): Promise<void> {
  const { page, rail, card, i18n, evidence, locale, theme } = input;
  expect(
    await rail.getByRole('textbox', {
      name: i18n.t('assessments.arrange.modal.maxTime'),
      exact: true,
    }).inputValue(),
  ).toStrictEqual(input.maximum);
  const shuffle = rail.getByRole('checkbox', {
    name: i18n.t('assessments.partSettings.shuffleQuestions'),
    exact: true,
  });
  expect(await shuffle.isChecked()).toStrictEqual(true);
  const shuffleTarget = await shuffle.locator('..').boundingBox();
  if (!(shuffleTarget && shuffleTarget.height >= 48)) {
    expect.unreachable('Expected shuffleTarget && shuffleTarget.height >= 48');
  }
  await assertNativeFormAccessibility(page, shuffle.locator('../..'));
  const summary = rail.locator('summary').filter({
    hasText: i18n.t('assessments.partSettings.fixedQuestions'),
  });
  if (await summary.locator('..').getAttribute('open') === null) await summary.click();
  for (
    const [index, title] of ['First question', 'Second question', 'Protected question'].entries()
  ) {
    expect(await rail.getByRole('checkbox', { name: new RegExp(`${title}$`) }).isChecked())
      .toStrictEqual(input.fixed[index]);
  }
  await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme);
  await captureQuestionProtectionFields(
    page,
    rail,
    i18n,
    evidence,
    `qflow-question-protection-${locale}-${theme}`,
  );
  expect(
    await rail.getByRole('textbox', {
      name: i18n.t('assessments.arrange.modal.instructions'),
      exact: true,
    }).inputValue(),
  ).toStrictEqual(input.instructionsHtml);
  for (const width of [390, 1024, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await shuffle.locator('../..').scrollIntoViewIfNeeded();
    await page.screenshot({
      path: evidence.path(`qflow-assessment-settings-${locale}-${theme}-${width}.png`),
    });
    const railBox = await rail.boundingBox(), cardBox = await card.boundingBox();
    if (!(railBox && cardBox)) expect.unreachable('Expected railBox && cardBox');
    if (width >= 1280) {
      expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(railBox.x);
    } else {
      expect(railBox.y + railBox.height).toBeLessThanOrEqual(cardBox.y);
    }
    if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) {
      expect.unreachable(
        'Expected await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)',
      );
    }
  }
  if (input.statusEndpoint !== null) {
    await assertSettingsFailureMessages(page, rail, i18n, input.statusEndpoint);
  }
}
