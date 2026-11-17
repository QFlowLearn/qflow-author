import { expect } from 'vitest';

import axe from 'axe-core';
import type { Page } from 'playwright';
import type { I18n } from '../../lib/i18n/messages.ts';
import type { InterfaceLocale } from '../../lib/i18n/locale.ts';
import type { BrowserEvidenceDirectory } from './browser_evidence.ts';

/** Check visible consequences before acknowledgement with real responsive/theme rendering. */
export async function verifyAssessmentExportNotices(
  page: Page,
  i18n: I18n,
  locale: InterfaceLocale,
  evidence: BrowserEvidenceDirectory,
): Promise<void> {
  for (
    const key of [
      'delivery.diagnostic.partInstructionsOmitted',
      'delivery.diagnostic.standaloneTextOmitted',
      'delivery.diagnostic.standaloneImageOmitted',
      'delivery.diagnostic.standaloneVideoOmitted',
      'delivery.diagnostic.standaloneVideoLinkOmitted',

      'delivery.diagnostic.partFeedbackOmitted',
      'delivery.diagnostic.partNavigationOmitted',
      'delivery.diagnostic.partSubmissionOmitted',
      'delivery.diagnostic.partTimeLimitsOmitted',
      'delivery.diagnostic.partStructureOmitted',
    ]
  ) {
    if (!(await page.getByText(i18n.t(key), { exact: true }).first().isVisible())) {
      expect.unreachable(
        'Expected await page.getByText(i18n.t(key), { exact: true }).first().isVisible()',
      );
    }
  }
  await page.addScriptTag({ content: axe.source });
  const notice = page.getByRole('list').filter({
    has: page.getByText(i18n.t('delivery.diagnostic.partInstructionsOmitted'), { exact: true }),
  });
  await notice.evaluate((element) => element.setAttribute('data-export-notice-evidence', '1'));
  for (const theme of ['wireframe', 'dark']) {
    await page.evaluate((value) => document.documentElement.dataset.theme = value, theme);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 812 });
      if (!(await notice.isVisible())) expect.unreachable('Expected await notice.isVisible()');
      if (!(await notice.evaluate((element) => element.scrollWidth <= element.clientWidth))) {
        expect.unreachable(
          'Expected await notice.evaluate((element) => element.scrollWidth <= element.clientWidth)',
        );
      }
      const violations: unknown = await page.evaluate(
        `globalThis.axe.run(document.querySelector('[data-export-notice-evidence]'), {runOnly:{type:'tag',values:['wcag2a','wcag2aa']}}).then(result => result.violations.map(({id,impact}) => ({id,impact})))`,
      );
      expect(violations, `${locale} ${theme} ${width}`).toStrictEqual([]);
      await notice.screenshot({
        path: evidence.path(`qflow-export-settings-${locale}-${theme}-${width}.png`),
        animations: 'disabled',
      });
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => document.documentElement.dataset.theme = 'wireframe');
}
