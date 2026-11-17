import { expect, test as testCase } from 'vitest';

import { assessmentQuestionPlacements } from '../lib/assessment_content.ts';

import { eq } from 'drizzle-orm';

import { db, shutdownDb } from '../lib/db.ts';
import { questions, tenants, users } from '../lib/db/schema.ts';
import {
  type AssessmentExportSelectionDocument,
  buildQti3AssessmentPackageEntries,
  buildValidatedQti3Assessment,
} from '../lib/export/assessment.ts';
import { loadAssessmentItemExports } from '../lib/export/assessment_loader.ts';
import { normalizePlacementRevisionSelectors } from '../lib/placement_question_views.ts';
import { loadPlacementQuestionRevisionRows } from '../lib/services/placement_question_revision_rows.ts';
import { getPlacementQuestionViews } from '../lib/services/questions.ts';
import type { RequestContext } from '../lib/tenants.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import {
  saveQuestionRevisionFixture,
  type TestQuestionRevisionInput,
} from './question_revision_fixture.ts';
import { questionXmlFixture } from './question_xml_fixture.ts';

testCase('placement question views load exact revisions and preserve tenant isolation', {
  skip: !process.env['DATABASE_URL'],
}, async function () {
  const fixture = await createFixture();
  try {
    const questionId = await createQuestionHistory(fixture.ctx);
    const references = [
      { placementId: 'pinned', itemId: questionId, revision: 2 },
      { placementId: 'latest', itemId: questionId, revision: null },
      { placementId: 'repeated', itemId: questionId, revision: 2 },
    ] as const;

    const selectedRows = await loadPlacementQuestionRevisionRows(
      db,
      fixture.tenantId,
      normalizePlacementRevisionSelectors(references),
    );
    expect(
      selectedRows.map((row) => ({ itemId: row.itemId, revision: row.revision }))
        .toSorted((left, right) => left.revision - right.revision),
    ).toStrictEqual([
      { itemId: questionId, revision: 2 },
      { itemId: questionId, revision: 5 },
    ]);

    const views = await getPlacementQuestionViews(fixture.ctx, references);

    expect(
      Object.values(views).map((view) => ({
        placementId: view.placementId,
        revision: view.revision,
        title: view.title,
      })),
    ).toStrictEqual([
      { placementId: 'pinned', revision: 2, title: 'Revision 2' },
      { placementId: 'latest', revision: 5, title: 'Revision 5' },
      { placementId: 'repeated', revision: 2, title: 'Revision 2' },
    ]);

    await expect(
      Promise.resolve().then(() => getPlacementQuestionViews(fixture.otherTenantCtx, references)),
    ).rejects.toSatisfy((caught: unknown) =>
      caught instanceof Error &&
      caught.message.includes('Question revision not found for placement pinned')
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

testCase('latest placement lookup rejects a revision owned by another question', {
  skip: !process.env['DATABASE_URL'],
}, async function () {
  const fixture = await createFixture();
  try {
    const owner = await saveQuestionRevisionFixture(
      fixture.ctx,
      authoredQuestionInput('Owner question', 'placement-owner'),
    );
    const foreign = await saveQuestionRevisionFixture(
      fixture.ctx,
      authoredQuestionInput('Foreign question', 'placement-foreign'),
    );
    await db.update(questions)
      .set({ latestRevisionId: foreign.revisionId })
      .where(eq(questions.id, owner.questionId));

    await expect(
      Promise.resolve().then(() =>
        getPlacementQuestionViews(fixture.ctx, [{
          placementId: 'latest',
          itemId: owner.questionId,
          revision: null,
        }])
      ),
    ).rejects.toSatisfy((caught: unknown) =>
      caught instanceof Error &&
      caught.message.includes('Question revision not found for placement latest')
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

testCase(
  'assessment export resolves pinned and latest placements into distinct package resources',
  { skip: !process.env['DATABASE_URL'] },
  async function () {
    const fixture = await createFixture();
    try {
      const questionId = await createQuestionHistory(fixture.ctx);
      const selectionDocument: AssessmentExportSelectionDocument = {
        assessment: { id: 'revision-aware-export', title: 'Revision-aware export' },
        parts: [{
          id: 'part-1',
          title: 'Part 1',
          placements: [
            { id: 'pinned', itemId: questionId, snapshotRev: 2 },
            { id: 'latest', itemId: questionId, snapshotRev: null },
            { id: 'repeated', itemId: questionId, snapshotRev: 2 },
          ],
        }],
      };

      const loaded = await loadAssessmentItemExports(db, fixture.ctx, selectionDocument);
      const pinnedResourceId = `item-${questionId}-r2`;
      const latestResourceId = `item-${questionId}-r5`;
      expect(Object.keys(loaded.itemsXml).toSorted()).toStrictEqual([
        latestResourceId,
        pinnedResourceId,
      ].toSorted());
      expect(loaded.itemsXml[pinnedResourceId]).toContain('placement-question-r2');
      expect(loaded.itemsXml[latestResourceId]).toContain('placement-question-r5');
      expect(
        assessmentQuestionPlacements(loaded.document.parts[0].placements).map((placement) =>
          placement.itemId
        ),
      ).toStrictEqual([pinnedResourceId, latestResourceId, pinnedResourceId]);

      const assessment = await buildValidatedQti3Assessment(loaded.document);
      expect(assessment.validation.ok).toStrictEqual(true);
      const entries = buildQti3AssessmentPackageEntries({
        document: loaded.document,
        assessmentXml: assessment.xml,
        itemsXml: loaded.itemsXml,
        assets: [],
      });
      expect(entries.filter((entry) => entry.name.startsWith('items/')).map((entry) => entry.name))
        .toStrictEqual([`items/${pinnedResourceId}.xml`, `items/${latestResourceId}.xml`]);
      expect(assessment.xml).toContain(`href="items/${pinnedResourceId}.xml"`);
      expect(assessment.xml).toContain(`href="items/${latestResourceId}.xml"`);
    } finally {
      await cleanupFixture(fixture);
    }
  },
);

async function createQuestionHistory(ctx: RequestContext): Promise<string> {
  const first = await saveQuestionRevisionFixture(
    ctx,
    authoredQuestionInput('Revision 1', 'placement-question-r1'),
  );

  for (let revision = 2; revision <= 5; revision += 1) {
    const title = `Revision ${revision}`;
    await saveQuestionRevisionFixture(ctx, {
      questionId: first.questionId,
      title,
      body: questionBody(title),
      metadata: { identifier: `placement-question-r${revision}` },
      provenance: {
        _tag: 'Revision',
        operation: 'revised',
        expectedParentRevision: revision - 1,
      },
      qtiXml: questionXmlFixture(`placement-question-r${revision}`),
      draftState: 'published',
    });
  }

  return first.questionId;
}

function authoredQuestionInput(
  title: string,
  identifier: string,
): TestQuestionRevisionInput {
  return {
    title,
    body: questionBody(title),
    metadata: { identifier },
    provenance: { _tag: 'Authored' },
    qtiXml: questionXmlFixture(identifier),
    draftState: 'published',
  };
}

function questionBody(title: string) {
  return {
    title,
    type: 'single_select' as const,
    itemLanguage: newAuthoringItemLanguage(),
    bodyHtml: `<p>${title}</p>`,
    choices: [{ id: 'A', text: 'One' }, { id: 'B', text: 'Two' }],
    correctId: 'A',
  };
}

async function createFixture(): Promise<{
  readonly tenantId: string;
  readonly otherTenantId: string;
  readonly userId: string;
  readonly otherUserId: string;
  readonly ctx: RequestContext;
  readonly otherTenantCtx: RequestContext;
}> {
  const tenantId = crypto.randomUUID();
  const otherTenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const otherUserId = crypto.randomUUID();
  const email = `placement-view-${userId.slice(0, 8)}@example.com`;
  const otherEmail = `placement-view-${otherUserId.slice(0, 8)}@example.com`;
  const ctx: RequestContext = { tenantId, userId, role: 'owner' };
  const otherTenantCtx: RequestContext = {
    tenantId: otherTenantId,
    userId: otherUserId,
    role: 'owner',
  };
  await db.insert(tenants).values([
    {
      id: tenantId,
      slug: `placement-view-${tenantId.slice(0, 8)}`,
      name: 'Placement View Test',
    },
    {
      id: otherTenantId,
      slug: `placement-view-${otherTenantId.slice(0, 8)}`,
      name: 'Other Placement View Test',
    },
  ]);
  await db.insert(users).values([
    {
      id: userId,
      email,
      emailNormalized: email,
      displayName: 'Placement View Author',
    },
    {
      id: otherUserId,
      email: otherEmail,
      emailNormalized: otherEmail,
      displayName: 'Other Placement View Author',
    },
  ]);

  return {
    tenantId,
    otherTenantId,
    userId,
    otherUserId,
    ctx,
    otherTenantCtx,
  };
}

async function cleanupFixture(
  fixture: {
    readonly tenantId: string;
    readonly otherTenantId: string;
    readonly userId: string;
    readonly otherUserId: string;
  },
): Promise<void> {
  try {
    await db.delete(questions).where(eq(questions.tenantId, fixture.tenantId));
    await db.delete(questions).where(eq(questions.tenantId, fixture.otherTenantId));
    await db.delete(users).where(eq(users.id, fixture.userId));
    await db.delete(users).where(eq(users.id, fixture.otherUserId));
    await db.delete(tenants).where(eq(tenants.id, fixture.tenantId));
    await db.delete(tenants).where(eq(tenants.id, fixture.otherTenantId));
  } catch {
    // Cleanup must not hide the primary assertion.
  } finally {
    await shutdownDb().catch(() => {});
  }
}
