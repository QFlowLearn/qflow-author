import { expect } from 'vitest';
import { builtWorkerBrowserEnvironment } from './built_worker_environment.ts';

import { eq } from 'drizzle-orm';
import { scoreQtiItemServerSide } from '@longsightgroup/qti3-core';
import { db } from '../../lib/db.ts';
import { authSessions } from '../../lib/db/auth_schema.ts';
import { assessmentQuestionPlacements } from '../../lib/assessment_content.ts';
import { safeErrorSummary } from '../../lib/error_summary.ts';
import { catalogForLocale } from '../../lib/i18n/catalogs.ts';
import { createI18n } from '../../lib/i18n/messages.ts';
import { createInitialUserSettings } from '../../lib/settings.ts';
import { createSession } from '../../lib/services/auth_sessions.ts';
import { getAssessment } from '../../lib/services/assessment_records.ts';
import { getQuestionRevision } from '../../lib/services/questions.ts';
import { saveUserSettings } from '../../lib/services/user_settings.ts';
import type { RequestContext } from '../../lib/tenants.ts';
import { openLocalAppBrowser } from '../../tools/local_app_browser.ts';
import { captureBrowserFailure, createBrowserEvidenceDirectory } from './browser_evidence.ts';
import { requireQaDatabaseUrl } from './qa_database.ts';

/** Exercise a supported imported question's actual canvas copy and reload in both production themes. */
export async function verifyNativeCopyInBrowser(
  ctx: RequestContext,
  assessmentId: string,
  title: string,
): Promise<void> {
  const evidence = await createBrowserEvidenceDirectory();
  const i18n = createI18n('en-US', catalogForLocale('en-US'));
  const app = await openLocalAppBrowser({
    endpoint: {
      _tag: 'ManagedLocalApp',
      portRange: { first: 5490, lastExclusive: 5500 },
      environment: {
        ...builtWorkerBrowserEnvironment,
        DATABASE_URL: requireQaDatabaseUrl(process.env['DATABASE_URL']),
      },
    },
    headless: true,
  });
  try {
    for (const theme of ['wireframe', 'dark'] as const) {
      await saveUserSettings(ctx.userId, { ...createInitialUserSettings('en-US'), theme });
      const context: import('playwright').BrowserContext = await app.newContext({
        authSession: await createSession(ctx),
        browser: { viewport: { width: theme === 'dark' ? 390 : 1280, height: 900 } },
      });
      const page: import('playwright').Page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (cause) => errors.push(safeErrorSummary(cause)));
      try {
        await context.addInitScript(
          (selected) => localStorage.setItem('qflow-theme', selected),
          theme,
        );
        await page.goto(`${app.baseUrl}/assessments/${assessmentId}`);
        await page.getByRole('button', {
          name: i18n.t('assessments.builder.editQuestion', { number: '1.1', title }),
          exact: true,
        }).click();
        await page.locator('[data-editor-field="textEntry"]').waitFor();
        const before = await getAssessment(ctx, assessmentId);
        if (!before) expect.unreachable('Expected before');
        const saved = page.waitForResponse((response) =>
          response.url() === `${app.baseUrl}/api/assessments/${assessmentId}/questions` &&
          response.request().method() === 'POST'
        );
        await page.getByRole('button', {
          name: i18n.t('assessments.builder.duplicateQuestion'),
          exact: true,
        }).click();
        expect((await saved).status()).toStrictEqual(201);
        const after = await getAssessment(ctx, assessmentId);
        if (!after) expect.unreachable('Expected after');
        const placements = assessmentQuestionPlacements(after.parts[0].placements);
        expect(placements.length).toStrictEqual(before.parts[0].placements.length + 1);
        const copy = placements[1];
        const card = page.locator(`#assessment-question-${copy.id}[data-authoring-card]`);
        await card.locator('[data-editor-field="textEntry"]').waitFor();
        expect(
          await card.locator(`input[placeholder="${i18n.t('driver.scorePlaceholder')}"]`)
            .inputValue(),
        ).toStrictEqual('3');
        const revision = await getQuestionRevision(ctx, copy.itemId, 1);
        if (!revision) expect.unreachable('Expected revision');
        const score = scoreQtiItemServerSide({
          itemXml: revision.qtiXml,
          trustedResponses: { RESPONSE: 'A' },
        });
        if (!(score.ok)) expect.unreachable('Expected score.ok');
        expect(score.score).toStrictEqual(3);
        await page.screenshot({ path: evidence.path(`native-copy-${theme}.png`), fullPage: true });
        await page.getByRole('tab', { name: i18n.t('editor.preview'), exact: true }).click();
        const preview = page.locator('[data-qti-preview-host="true"]');
        await preview.getByText(i18n.t('preview.ready'), { exact: true }).waitFor();
        for (const [answer, expected] of [['A', 3], ['B', 0]] as const) {
          await preview.getByRole('textbox').fill(answer);
          await preview.getByRole('button', { name: i18n.t('preview.check'), exact: true }).click();
          await preview.getByText(i18n.t('preview.score'), { exact: true }).waitFor();
          const shown = await preview.locator('qti-assessment-item-player').evaluate((element) => {
            const serialize: unknown = Reflect.get(element, 'serialize');
            if (typeof serialize !== 'function') throw new Error('Expected Preview serialization.');
            const state: unknown = serialize.call(element);
            if (!state || typeof state !== 'object') throw new Error('Expected Preview state.');
            const outcomes: unknown = Reflect.get(state, 'outcomes');
            if (!outcomes || typeof outcomes !== 'object') {
              throw new Error('Expected Preview outcomes.');
            }
            return Reflect.get(outcomes, 'SCORE');
          });
          expect(shown).toStrictEqual(expected);
          if (expected === 3) {
            await page.screenshot({
              path: evidence.path(`native-preview-${theme}.png`),
              fullPage: true,
            });
          }
          await preview.getByRole('button', { name: i18n.t('preview.resetButton'), exact: true })
            .click();
          await preview.getByText(i18n.t('preview.reset'), { exact: true }).waitFor();
        }
        await page.reload();
        expect(await getAssessment(ctx, assessmentId)).toStrictEqual(after);
        await page.getByRole('button', {
          name: i18n.t('assessments.builder.editQuestion', { number: '1.2', title }),
          exact: true,
        }).click();
        await card.locator('[data-editor-field="textEntry"]').waitFor();
        expect(
          await card.locator(`input[placeholder="${i18n.t('driver.scorePlaceholder')}"]`)
            .inputValue(),
        ).toStrictEqual('3');
        expect(errors).toStrictEqual([]);
      } catch (cause: unknown) {
        await captureBrowserFailure(page, evidence, `native-copy-${theme}`);
        throw cause;
      } finally {
        await context.close();
      }
    }
  } finally {
    await app.close();
    await db.delete(authSessions).where(eq(authSessions.userId, ctx.userId));
  }
}
