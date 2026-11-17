import { expect } from 'vitest';

import { and, eq } from 'drizzle-orm';
import type { Page } from 'playwright';
import { db } from '../../lib/db.ts';
import { enrichmentAssignments, enrichmentChanges } from '../../lib/db/bank_enrichment_schema.ts';

/** Continue the 106-question browser fixture after correction/undo, through a real topic-merge rerun. */
export async function exerciseAffectedEnrichment(
  page: Page,
  baseUrl: string,
  tenantId: string,
  versionId: string,
  drain: () => Promise<void>,
  runtimeUrl: string,
) {
  const before = await db.select().from(enrichmentAssignments).where(and(
    eq(enrichmentAssignments.tenantId, tenantId),
    eq(enrichmentAssignments.dimension, 'difficulty'),
  )).orderBy(enrichmentAssignments.questionId);
  await page.setViewportSize({ width: 1440, height: 1100 });
  // Resume a frozen generative-task fixture directly; the entry screen now starts Clef organization.
  const response = await page.request.post(runtimeUrl + '/items/organize', {
    multipart: {
      payload: JSON.stringify({
        action: 'begin',
        operationId: crypto.randomUUID(),
        scope: { _tag: 'Filtered', queryString: 'tags=source-science' },
        audience: 'Grade 6 science',
        baseVersionId: versionId,
      }),
    },
  });
  const reply: unknown = await response.json();
  if (
    !(typeof reply === 'object' && reply !== null && 'url' in reply &&
      typeof reply.url === 'string')
  ) {
    expect.unreachable(
      "Expected typeof reply === 'object' && reply !== null && 'url' in reply && typeof reply.url === 'str",
    );
  }
  await page.goto(baseUrl + reply.url);
  await page.getByRole('status').filter({ hasText: 'Analyzing a sample' }).waitFor();
  await drain();
  await page.getByRole('heading', { name: 'Customize your vocabulary', exact: true }).waitFor();
  const cells = page.locator('[data-category=cells]');
  await cells.getByText('Definition & options', { exact: true }).click();
  await cells.getByRole('combobox', { name: 'Merge into', exact: true }).selectOption('energy');
  await cells.getByRole('button', { name: 'Merge', exact: true }).click();
  await page.locator('input[name=update-subject]').uncheck();
  await page.locator('input[name=update-difficulty]').uncheck();
  await page.getByRole('button', { name: 'Preview affected questions', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Analyzing a sample' }).waitFor();
  await drain();
  await page.getByRole('heading', { name: 'Customize your vocabulary', exact: true }).waitFor();
  await page.getByText('Questions affected by your changes', { exact: true }).waitFor();
  expect(new URL(page.url()).searchParams.get('fields')).toStrictEqual('topic');
  expect(await page.locator('[data-category=cells]').count()).toStrictEqual(0);
  expect(await page.locator('input[name=update-topic]').isChecked()).toStrictEqual(true);
  await page.getByText('Additional guidance', { exact: true }).click();
  await page.locator('textarea[name=instructions]').fill('Use the edited topic definitions.');
  await page.getByText(
    'Your settings changed. Preview examples again to refresh the affected selection before starting.',
    { exact: true },
  ).waitFor();
  if (!(await page.getByRole('button', { name: 'Tag bank', exact: true }).isDisabled())) {
    expect.unreachable(
      "Expected await page.getByRole('button', { name: 'Tag bank', exact: true }).isDisabled()",
    );
  }
  await page.getByRole('button', { name: 'Preview examples', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Analyzing a sample' }).waitFor();
  await drain();
  await page.getByRole('heading', { name: 'Customize your vocabulary', exact: true }).waitFor();
  await page.screenshot({
    path: '/tmp/qflow-enrichment-step6-affected-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Tag bank', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: '/tmp/qflow-enrichment-step6-affected-mobile.png',
    animations: 'disabled',
  });
  if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) {
    expect.unreachable(
      'Expected await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)',
    );
  }
  await page.getByRole('button', { name: 'Tag bank', exact: true }).click();
  await page.getByRole('heading', { name: 'Tagging progress', exact: true }).waitFor();
  await page.getByText('0 of 32 questions processed', { exact: true }).waitFor();
  const runId = new URL(page.url()).pathname.split('/').at(-1);
  if (!runId) expect.unreachable('Expected runId');
  await drain();
  await page.getByRole('status').filter({ hasText: 'Tagging complete' }).waitFor();
  const writes = await db.select().from(enrichmentChanges).where(
    eq(enrichmentChanges.operationId, runId),
  );
  expect(writes.length).toStrictEqual(32);
  if (!(writes.every((w) => w.dimension === 'topic'))) {
    expect.unreachable("Expected writes.every((w) => w.dimension === 'topic')");
  }
  expect(
    await db.select().from(enrichmentAssignments).where(and(
      eq(enrichmentAssignments.tenantId, tenantId),
      eq(enrichmentAssignments.dimension, 'difficulty'),
    )).orderBy(enrichmentAssignments.questionId),
  ).toStrictEqual(before);
  await page.getByRole('link', { name: 'View questions', exact: true }).click();
  await page.getByRole('heading', { name: 'Question bank', exact: true }).waitFor();
  expect(new URL(page.url()).searchParams.get('tags')).toStrictEqual('source-science');
}
