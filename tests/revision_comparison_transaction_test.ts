import { expect, test as testCase } from 'vitest';

import { checkRevisionComparisonBrowser } from './helpers/revision_comparison_browser.ts';
import { restoreQuestionRevision } from '../lib/services/question_revision_restoration.ts';
import { getQuestionRevision } from '../lib/services/questions.ts';
import {
  getQuestionReviewWorkspace,
  requestQuestionReview,
} from '../lib/services/question_reviews.ts';
import { auditLogs, questionReviewRequests } from '../lib/db/schema.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { exportQti3AssessmentItemXml } from '../lib/types/qti3_authoring.ts';
import { prepareDriverDraftForBuild } from '../lib/types/buildable_driver_draft.ts';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import {
  organizationMemberships,
  questionRevisions,
  questions,
  tenants,
  users,
} from '../lib/db/schema.ts';
import { saveQuestionRevisionFixture } from './question_revision_fixture.ts';
import { loadItemBankDetailPageData } from '../lib/services/item_bank_detail_page.ts';
import type { RequestContext } from '../lib/tenants.ts';

testCase('comparison loads authorized r2 and r4 while latest remains r7', async function () {
  if (!(/test/.test(new URL(process.env['DATABASE_URL'] ?? '').pathname))) {
    expect.unreachable("Expected /test/.test(new URL(process.env['DATABASE_URL'] ?? '').pathname)");
  }
  const tenantId = crypto.randomUUID(), userId = crypto.randomUUID(), id = crypto.randomUUID();
  const auth: RequestContext = { tenantId, userId, role: 'owner' };
  try {
    await db.insert(tenants).values({ id: tenantId, slug: tenantId, name: 'Comparison' });
    await db.insert(users).values({
      id: userId,
      email: `${userId}@example.test`,
      emailNormalized: `${userId}@example.test`,
    });
    await db.insert(organizationMemberships).values({
      id: crypto.randomUUID(),
      tenantId,
      userId,
      role: 'owner',
    });
    for (let revision = 1; revision <= 7; revision++) {
      const body = {
        type: 'single_select' as const,
        itemLanguage: newAuthoringItemLanguage(),
        title: `Revision ${revision}`,
        promptHtml: `Question ${revision}`,
        bodyHtml:
          `<p><img src="/comparison-${tenantId}/r${revision}.svg" alt="Revision ${revision}"/></p>`,
        choices: [{ id: 'B', text: 'Bee' }, { id: 'C', text: 'Sea' }],
        correctId: revision < 4 ? 'B' : 'C',
      };
      await saveQuestionRevisionFixture(auth, {
        questionId: id,
        title: body.title,
        body,
        tags: [],
        provenance: revision === 1
          ? { _tag: 'Authored' }
          : { _tag: 'Revision', operation: 'revised', expectedParentRevision: revision - 1 },
        qtiXml: exportQti3AssessmentItemXml(
          'single_select',
          prepareDriverDraftForBuild('single_select', body),
          { identifier: `r${revision}` },
        ),
        draftState: 'published',
      });
    }
    const url = new URL(`http://localhost/items/${id}?compare=2&compareTo=4`);
    const page = await loadItemBankDetailPageData(auth, id, url);
    if (!(page?.comparison)) expect.unreachable('Expected page?.comparison');
    expect(page.detail.revision).toStrictEqual(7);
    expect([page.comparison.fromRevision, page.comparison.toRevision]).toStrictEqual([2, 4]);
    if (!(page.comparison.beforeXml.includes(`/comparison-${tenantId}/r2.svg`))) {
      expect.unreachable(
        'Expected page.comparison.beforeXml.includes(`/comparison-${tenantId}/r2.svg`)',
      );
    }
    if (!(page.comparison.afterXml.includes(`/comparison-${tenantId}/r4.svg`))) {
      expect.unreachable(
        'Expected page.comparison.afterXml.includes(`/comparison-${tenantId}/r4.svg`)',
      );
    }
    expect(page.comparison.changes.find((change) => change.label === 'correctAnswer')?.after)
      .toStrictEqual('"C"');
    for (
      const query of [
        'compare=4&compareTo=2',
        'compare=2&compareTo=8',
        'compare=2&compare=3',
        'compare=2&compareTo=4&compareTo=5',
        'compare=2.0&compareTo=4',
      ]
    ) {
      await expect(
        Promise.resolve().then(() =>
          loadItemBankDetailPageData(auth, id, new URL(`http://localhost/items/${id}?${query}`))
        ),
      ).rejects.toBeInstanceOf(Error);
    }
    expect(await loadItemBankDetailPageData({ ...auth, tenantId: crypto.randomUUID() }, id, url))
      .toStrictEqual(null);
    expect(await restoreQuestionRevision(auth, id, 999, page.reviews.latestRevisionId))
      .toStrictEqual({
        ok: false,
        code: 'source_unavailable',
      });
    expect(await restoreQuestionRevision(auth, id, 0, page.reviews.latestRevisionId)).toStrictEqual(
      {
        ok: false,
        code: 'invalid_reference',
      },
    );
    if (process.env['QFLOW_BROWSER_TESTS'] === '1') {
      await checkRevisionComparisonBrowser(auth, id);
    } else {
      const restored = await restoreQuestionRevision(auth, id, 3, page.reviews.latestRevisionId);
      expect(restored).toStrictEqual({ ok: true, revision: 8 });
    }
    expect(await restoreQuestionRevision(auth, id, 3, page.reviews.latestRevisionId)).toStrictEqual(
      {
        ok: false,
        code: 'stale_revision',
      },
    );
    const source = await getQuestionRevision(auth, id, 3);
    const latest = await getQuestionRevision(auth, id, 8);
    if (!(source && latest)) expect.unreachable('Expected source && latest');
    expect(latest.body).toStrictEqual(source.body);
    expect(latest.qtiXml).toStrictEqual(source.qtiXml);
    expect(latest.provenance.event.operation).toStrictEqual('restored');
    expect(latest.provenance.event.parentRevision).toStrictEqual(7);
    if (!(latest.provenance.event.operation === 'restored')) {
      expect.unreachable("Expected latest.provenance.event.operation === 'restored'");
    }
    expect(latest.provenance.event.restoredFromRevision).toStrictEqual(3);
    expect((await requestQuestionReview(auth, id, userId, 'x'.repeat(4001))).ok).toStrictEqual(
      false,
    );
    expect((await requestQuestionReview(auth, id, userId, '')).ok).toStrictEqual(true);
    expect((await getQuestionReviewWorkspace(auth, id))?.requests[0].changeReason).toStrictEqual(
      null,
    );
    expect(
      (await requestQuestionReview(auth, id, userId, 'Restore the verified answer and diagram.'))
        .ok,
    ).toStrictEqual(false);
    await db.delete(organizationMemberships).where(eq(organizationMemberships.userId, userId));
    expect(await loadItemBankDetailPageData(auth, id, url)).toStrictEqual(null);
    expect(await restoreQuestionRevision(auth, id, 3, page.reviews.latestRevisionId)).toStrictEqual(
      {
        ok: false,
        code: 'forbidden',
      },
    );
  } finally {
    await db.delete(questionReviewRequests).where(eq(questionReviewRequests.tenantId, tenantId));
    await db.delete(auditLogs).where(eq(auditLogs.tenantId, tenantId));
    await db.update(questions).set({ latestRevisionId: null }).where(
      eq(questions.tenantId, tenantId),
    );
    await db.delete(questionRevisions).where(eq(questionRevisions.tenantId, tenantId));
    await db.delete(questions).where(eq(questions.tenantId, tenantId));
    await db.delete(organizationMemberships).where(
      eq(organizationMemberships.tenantId, tenantId),
    );
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await shutdownDb();
  }
});
