import { expect, test as testCase } from 'vitest';

import { and, asc, eq } from 'drizzle-orm';

import { db, shutdownDb } from '../lib/db.ts';
import { questionRevisions, questions, tenants, users } from '../lib/db/schema.ts';
import { StaleQuestionRevisionError } from '../lib/question_provenance.ts';
import { getQuestionRevision } from '../lib/services/questions.ts';
import type { RequestContext } from '../lib/tenants.ts';
import {
  saveQuestionRevisionFixture,
  type TestQuestionRevisionInput,
} from './question_revision_fixture.ts';
import { questionXmlFixture } from './question_xml_fixture.ts';

testCase('concurrent saves serialize and reject the stale parent', async () => {
  const fixture = await createFixture();
  try {
    const first = await saveQuestionRevisionFixture(fixture.ctx, authoredInput());
    const revise = (title: string): TestQuestionRevisionInput => ({
      questionId: first.questionId,
      title,
      body: { type: 'text_entry', title },
      metadata: { identifier: `${title}-r2` },
      provenance: {
        _tag: 'Revision',
        operation: 'revised',
        expectedParentRevision: 1,
      },
      qtiXml: questionXmlFixture(`${title}-r2`),
      draftState: 'published',
    });

    const attempts = await Promise.allSettled([
      saveQuestionRevisionFixture(fixture.ctx, revise('alpha')),
      saveQuestionRevisionFixture(fixture.ctx, revise('beta')),
    ]);
    const fulfilled = attempts.filter((result) => result.status === 'fulfilled');
    const rejected = attempts.filter((result) => result.status === 'rejected');
    expect(fulfilled.length).toStrictEqual(1);
    expect(rejected.length).toStrictEqual(1);
    const reason = rejected[0]?.status === 'rejected' ? rejected[0].reason : null;
    expect(reason instanceof StaleQuestionRevisionError).toStrictEqual(true);

    const rows = await db.select({
      revision: questionRevisions.revision,
      metadata: questionRevisions.metadata,
    }).from(questionRevisions)
      .where(eq(questionRevisions.questionId, first.questionId))
      .orderBy(asc(questionRevisions.revision));
    expect(rows.map((row) => row.revision)).toStrictEqual([1, 2]);
    expect(
      rows[1]?.metadata?.identifier === 'alpha-r2' ||
        rows[1]?.metadata?.identifier === 'beta-r2',
    ).toStrictEqual(true);
  } finally {
    await cleanupFixture(fixture);
  }
});

testCase('single-revision readers reject an invalid provenance chain', async () => {
  const fixture = await createFixture();
  try {
    const first = await saveQuestionRevisionFixture(fixture.ctx, authoredInput());
    await saveQuestionRevisionFixture(fixture.ctx, {
      questionId: first.questionId,
      title: 'Revision 2',
      body: { type: 'text_entry', title: 'Revision 2' },
      provenance: {
        _tag: 'Revision',
        operation: 'revised',
        expectedParentRevision: 1,
      },
      qtiXml: questionXmlFixture('revision-2'),
      draftState: 'published',
    });
    await db.update(questionRevisions).set({
      provenance: {
        version: 1,
        event: {
          operation: 'revised',
          author: {
            id: fixture.userId,
            displayName: 'Concurrency Author',
            email: fixture.email,
          },
          parentRevision: 1,
          contentBasis: 'source',
        },
      },
    }).where(and(
      eq(questionRevisions.questionId, first.questionId),
      eq(questionRevisions.revision, 2),
    ));

    await expect(
      Promise.resolve().then(() => getQuestionRevision(fixture.ctx, first.questionId, 2)),
    ).rejects.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('contradictory content transition')
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

function authoredInput(): TestQuestionRevisionInput {
  return {
    title: 'Initial question',
    body: { type: 'text_entry', title: 'Initial question' },
    metadata: { identifier: 'initial-r1' },
    provenance: { _tag: 'Authored' },
    qtiXml: questionXmlFixture('initial-r1'),
    draftState: 'published',
  };
}

async function createFixture(): Promise<{
  readonly tenantId: string;
  readonly userId: string;
  readonly email: string;
  readonly ctx: RequestContext;
}> {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const email = `question-concurrency-${userId.slice(0, 8)}@example.com`;
  const ctx: RequestContext = { tenantId, userId, role: 'owner' };
  await db.insert(tenants).values({
    id: tenantId,
    slug: `question-concurrency-${tenantId.slice(0, 8)}`,
    name: 'Question Concurrency Test',
  });
  await db.insert(users).values({
    id: userId,
    email,
    emailNormalized: email,
    displayName: 'Concurrency Author',
  });
  return { tenantId, userId, email, ctx };
}

async function cleanupFixture(
  fixture: { readonly tenantId: string; readonly userId: string },
): Promise<void> {
  try {
    await db.delete(questions).where(eq(questions.tenantId, fixture.tenantId));
    await db.delete(users).where(eq(users.id, fixture.userId));
    await db.delete(tenants).where(eq(tenants.id, fixture.tenantId));
  } catch {
    // Cleanup must not hide the primary assertion.
  } finally {
    await shutdownDb().catch(() => {});
  }
}
