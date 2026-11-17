import { expect, test as testCase } from 'vitest';

import { and, eq } from 'drizzle-orm';
import { db } from '../lib/db.ts';
import {
  organizationMemberships,
  questionRevisions,
  questions,
  tenants,
  users,
} from '../lib/db/schema.ts';
import { parsePersistedDraft } from '../lib/persisted_draft.ts';
import { openLatestRevisionDraftSession } from '../lib/services/drafts.ts';
import { saveQuestionRevisionFixture } from './question_revision_fixture.ts';
import { exportQti3AssessmentItemXml } from '../lib/types/qti3_authoring.ts';
import { TYPE_DRIVERS } from '../lib/types/registry.ts';
import { draftBankRoute as draftByIdEndpoint } from '../lib/http/routes/bank_api/draft.ts';
import { prepareDriverDraftForBuild } from '../lib/types/buildable_driver_draft.ts';
import { invokeHttpRoute, makeHttpRequest } from './helpers/http_route.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';

const draftById = draftByIdEndpoint.handle;

testCase('revision draft autosave round-trip persists match fields', async () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const questionId = crypto.randomUUID();
  const auth = { tenantId, userId, role: 'owner' as const };
  const body = parsePersistedDraft({
    type: 'match',
    itemLanguage: newAuthoringItemLanguage(),
    title: 'Match test',
    promptHtml: '<p>Pair them</p>',
    bodyHtml: '<p>Match the animals.</p>',
    sources: [{ id: 'A', text: 'Dog', matchMax: 1 }],
    targets: [{ id: '1', text: 'Barks', matchMax: 2 }],
    correctPairs: [{ sourceId: 'A', targetId: '1' }],
    maxAssociations: 0,
    shuffle: false,
  }, 'match');
  await db.insert(tenants).values({ id: tenantId, slug: `draft-${tenantId}`, name: 'Draft Test' });
  const email = `${userId}@example.com`;
  await db.insert(users).values({ id: userId, email, emailNormalized: email });
  await db.insert(organizationMemberships).values({
    id: crypto.randomUUID(),
    tenantId,
    userId,
    role: 'owner',
  });
  try {
    const sourceRevision = await saveQuestionRevisionFixture(auth, {
      questionId,
      title: body.title,
      body,
      provenance: { _tag: 'Authored' },
      qtiXml: exportQti3AssessmentItemXml(
        'match',
        prepareDriverDraftForBuild('match', {
          ...TYPE_DRIVERS.match.defaults(),
          itemLanguage: newAuthoringItemLanguage(),
        }),
        { identifier: `item-${questionId}` },
      ),
      draftState: 'published',
    });
    const opened = await openLatestRevisionDraftSession(auth, questionId);
    if (!opened.ok) throw new Error(`Latest draft did not open: ${opened.code}`);
    expect(opened.sourceRevisionId).toStrictEqual(sourceRevision.revisionId);
    const session = opened.session;

    const malformed = await invokeHttpRoute(
      draftById,
      makeHttpRequest(
        new Request(`http://local/api/drafts/${session.id}`, {
          ...{ duplex: 'half' },
          method: 'PUT',
          body: JSON.stringify({ ...body, obsoleteField: true }),
          headers: { 'content-type': 'application/json' },
        }),
        { auth, params: { id: session.id } },
      ),
    );
    expect(malformed.status).toStrictEqual(400);

    const updated = await invokeHttpRoute(
      draftById,
      makeHttpRequest(
        new Request(`http://local/api/drafts/${session.id}`, {
          ...{ duplex: 'half' },
          method: 'PUT',
          body: JSON.stringify({ ...body, title: 'Updated', maxAssociations: 3 }),
          headers: { 'content-type': 'application/json' },
        }),
        { auth, params: { id: session.id } },
      ),
    );
    expect(updated.status).toStrictEqual(200);

    const unsupportedPatch = await invokeHttpRoute(
      draftById,
      makeHttpRequest(
        new Request(`http://local/api/drafts/${session.id}`, {
          ...{ duplex: 'half' },
          method: 'PATCH',
          body: JSON.stringify({ ...body, title: 'Must not persist' }),
          headers: { 'content-type': 'application/json' },
        }),
        { auth, params: { id: session.id } },
      ),
    );
    expect(unsupportedPatch.status).toStrictEqual(405);

    const read = await invokeHttpRoute(
      draftById,
      makeHttpRequest(
        new Request(`http://local/api/drafts/${session.id}`, { method: 'GET' }),
        { auth, params: { id: session.id } },
      ),
    );
    expect(read.status).toStrictEqual(200);
    const payload = await read.json();
    const draft = payload.draft;
    expect(draft.title).toStrictEqual('Updated');
    expect(draft.sources.length).toStrictEqual(1);
    expect(draft.targets.length).toStrictEqual(1);
    expect(draft.correctPairs.length).toStrictEqual(1);
    expect(draft.maxAssociations).toStrictEqual(3);

    const removed = await invokeHttpRoute(
      draftById,
      makeHttpRequest(
        new Request(`http://local/api/drafts/${session.id}`, { method: 'DELETE' }),
        { auth, params: { id: session.id } },
      ),
    );
    expect(removed.status).toStrictEqual(204);

    const updateAfterDelete = await invokeHttpRoute(
      draftById,
      makeHttpRequest(
        new Request(`http://local/api/drafts/${session.id}`, {
          ...{ duplex: 'half' },
          method: 'PUT',
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        }),
        { auth, params: { id: session.id } },
      ),
    );
    expect(updateAfterDelete.status).toStrictEqual(404);
  } finally {
    await db.delete(questions).where(and(
      eq(questions.id, questionId),
      eq(questions.tenantId, tenantId),
    ));
    await db.delete(questionRevisions).where(eq(questionRevisions.tenantId, tenantId));
    await db.delete(organizationMemberships).where(eq(organizationMemberships.tenantId, tenantId));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  }
});
