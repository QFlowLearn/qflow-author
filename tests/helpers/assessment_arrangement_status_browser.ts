import { expect } from 'vitest';

import type { Locator, Page } from 'playwright';
import type { I18n } from '../../lib/i18n/messages.ts';

async function assertNoticeFits(page: Page, notice: Locator): Promise<void> {
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await notice.scrollIntoViewIfNeeded();
    if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) {
      expect.unreachable(
        'Expected await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)',
      );
    }
    const bounds = await notice.boundingBox();
    if (!(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width)) {
      expect.unreachable('Expected bounds && bounds.x >= 0 && bounds.x + bounds.width <= width');
    }
  }
}

/** Check localized settings failure messages at the HTTP seam; this does not prove DB conflicts. */
export async function assertSettingsFailureMessages(
  page: Page,
  rail: Locator,
  i18n: I18n,
  endpoint: string,
): Promise<void> {
  const maximum = rail.getByRole('textbox', {
    name: i18n.t('assessments.arrange.modal.maxTime'),
    exact: true,
  });
  const current = await maximum.inputValue();
  let failure: 'uncertain' | 'conflict' = 'uncertain';
  let intercepted = 0;
  await page.route(endpoint, async (route) => {
    intercepted++;
    if (failure === 'uncertain') await route.abort('failed');
    else {
      await route.continue({
        postData: JSON.stringify({
          ...route.request().postDataJSON(),
          expectedVersion: '0'.repeat(64),
        }),
      });
    }
  });
  try {
    await maximum.fill(String(Number(current) + 50));
    await rail.getByRole('button', { name: i18n.t('assessments.settings.save'), exact: true })
      .click();
    const uncertain = rail.getByText(i18n.t('assessments.settings.uncertain'), { exact: true });
    await uncertain.waitFor();
    await assertNoticeFits(page, uncertain);
    failure = 'conflict';
    await rail.getByRole('button', {
      name: i18n.t('assessments.builder.tool.retry'),
      exact: true,
    }).click();
    const conflict = rail.getByText(i18n.t('assessments.settings.conflict'), { exact: true });
    await conflict.waitFor();
    await assertNoticeFits(page, conflict);
    expect(intercepted).toStrictEqual(2);
  } finally {
    await page.unroute(endpoint);
  }
}

/** Check translated movement failures without repeating real commit/replay races in every locale. */
export async function assertCanvasMoveFailureMessages(
  page: Page,
  endpoint: string,
  handle: Locator,
  i18n: I18n,
): Promise<void> {
  let failure: 'uncertain' | 'rejected' | 'conflict' = 'uncertain';
  let intercepted = 0;
  await page.route(endpoint, async (route) => {
    intercepted++;
    if (failure === 'uncertain') await route.abort('failed');
    else if (failure === 'rejected') {
      await route.continue({
        postData: '{',
      });
    } else {
      await route.continue({
        postData: JSON.stringify({
          ...route.request().postDataJSON(),
          expectedVersion: '0'.repeat(64),
        }),
      });
    }
  });
  const status = (message: 'moveUncertain' | 'moveRejected' | 'moveConflict') =>
    page.getByRole('status').filter({ hasText: i18n.t(`assessments.builder.${message}`) });
  try {
    await handle.press('ArrowUp');
    await status('moveUncertain').waitFor();
    await assertNoticeFits(page, status('moveUncertain'));
    failure = 'rejected';
    await page.getByRole('button', {
      name: i18n.t('assessments.builder.tool.retry'),
      exact: true,
    }).click();
    await status('moveRejected').waitFor();
    await assertNoticeFits(page, status('moveRejected'));
    failure = 'conflict';
    await handle.press('ArrowUp');
    await status('moveConflict').waitFor();
    await assertNoticeFits(page, status('moveConflict'));
    expect(intercepted).toStrictEqual(3);
  } finally {
    await page.unroute(endpoint);
  }
}
