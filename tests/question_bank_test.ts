import { expect, test as testCase } from 'vitest';

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../lib/db.ts';
import {
  auditLogs,
  draftSessions,
  organizationMemberships,
  questionReviewComments,
  questionReviewRequests,
  questionRevisions,
  questions,
  tenants,
  users,
} from '../lib/db/schema.ts';
import {
  parsePrecomputedQuestionCompatibilityRecord,
  parseQuestionCompatibility,
  projectQuestionBankRevision,
  projectQuestionBankRevisionFromPrecomputedCompatibility,
  projectQuestionCompatibility,
  projectQuestionSearchText,
  QUESTION_SEARCH_TEXT_MAX_LENGTH,
} from '../lib/question_bank.ts';
import { exportQti3AssessmentItemXml } from '../lib/types/qti3_authoring.ts';
import { TYPE_DRIVERS } from '../lib/types/registry.ts';
import { prepareDriverDraftForBuild } from '../lib/types/buildable_driver_draft.ts';
import { applyQuestionBankBulkCommand } from '../lib/services/question_bank_bulk.ts';
import {
  parseQuestionBankPickerQuery,
  parseQuestionBankQuery,
  QuestionBankInputError,
} from '../lib/services/question_bank_query.ts';
import { getQuestionBankItemDetail, listQuestionBank } from '../lib/services/question_bank_read.ts';
import {
  dispatchQuestionBankItemAction,
  parseQuestionBankBulkForm,
  QuestionBankBulkFormError,
} from '../lib/services/question_bank_actions.ts';
import {
  addQuestionReviewComment,
  decideQuestionReview,
  getQuestionReviewWorkspace,
  requestQuestionReview,
} from '../lib/services/question_reviews.ts';
import { getQuestionRevision } from '../lib/services/questions.ts';
import { saveQuestionRevisionFixture } from './question_revision_fixture.ts';
import {
  deleteDraftSession,
  getDraftSession,
  openLatestRevisionDraftSession,
} from '../lib/services/drafts.ts';
import type { RequestContext } from '../lib/tenants.ts';
import { parsePersistedDraft } from '../lib/persisted_draft.ts';
import { publishRevisionDraft } from '../lib/services/revision_draft_publication.ts';
import { prepareQuestionRevision } from '../lib/question_revision_preparation.ts';
import { bankSearchApiRoute as itemSearchHandlerEndpoint } from '../lib/http/routes/assessment_api/bank_search.ts';
import { invokeHttpMethod, makeHttpRequest } from './helpers/http_route.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';

const itemSearchHandler = itemSearchHandlerEndpoint.handle;

const ITEM_XML = exportQti3AssessmentItemXml(
  'single_select',
  prepareDriverDraftForBuild('single_select', {
    ...TYPE_DRIVERS.single_select.defaults(),
    itemLanguage: newAuthoringItemLanguage(),
  }),
  { identifier: 'question-bank-test-item' },
);

testCase(
  'question bank projection uses every export target and semantic content identity',
  async () => {
    const body = {
      type: 'single_select',
      itemLanguage: newAuthoringItemLanguage(),
      title: 'Capital',
      tags: ['geography'],
      standards: [{ standardId: 'GEO.1' }],
      promptHtml: 'Capital of France?',
      choices: [{ id: 'A', text: 'Paris' }, { id: 'B', text: 'Berlin' }],
      correctId: 'A',
    };
    const first = await projectQuestionBankRevision('Capital', body, ITEM_XML);
    const renamed = await projectQuestionBankRevision('Renamed', {
      ...body,
      title: 'Renamed',
      tags: ['new-tag'],
      standards: [{ standardId: 'GEO.2' }],
      answerMasking: false,
      customAttributes: [],
      responseMode: 'all_or_nothing',
    }, ITEM_XML);
    const renamedXml = ITEM_XML.replace(
      'identifier="question-bank-test-item"',
      'identifier="renamed"',
    )
      .replace('title="New Single Select"', 'title="Renamed item"');
    const changedAnswerXml = ITEM_XML.replace(
      '<qti-value>A</qti-value>',
      '<qti-value>B</qti-value>',
    );
    const renamedQti = await projectQuestionBankRevision('Renamed again', body, renamedXml);
    const changedAnswer = await projectQuestionBankRevision('Capital', body, changedAnswerXml);

    expect(first.compatibility.length).toStrictEqual(9);
    expect(first.compatibility).toStrictEqual(projectQuestionCompatibility(ITEM_XML));
    expect(first.contentHash).toStrictEqual(renamed.contentHash);
    expect(first.contentHash).toStrictEqual(renamedQti.contentHash);
    expect(first.contentHash).not.toStrictEqual(changedAnswer.contentHash);
    expect(first.contentHash.length).toStrictEqual(64);
    expect(first.searchText.includes('Capital of France?')).toStrictEqual(true);
  },
);

testCase('question revisions reject titles that disagree with their immutable body', async () => {
  await expect(
    Promise.resolve().then(() =>
      prepareQuestionRevision({
        title: 'Question title',
        body: { type: 'single_select', title: 'Different title' },
        qtiXml: ITEM_XML,
      })
    ),
  ).rejects.toSatisfy((caught: unknown) =>
    caught instanceof Error && caught.message.includes('must match its immutable revision body')
  );
});

testCase('question compatibility parsing matches targets by id regardless of array order', () => {
  const ordered = projectQuestionCompatibility(ITEM_XML);
  const scrambled = [...ordered].reverse();
  expect(parseQuestionCompatibility(scrambled)).toStrictEqual(ordered);
});

testCase('question compatibility parsing rejects unregistered targets', () => {
  const compatibility = projectQuestionCompatibility(ITEM_XML);
  expect(() =>
    parseQuestionCompatibility([
      ...compatibility,
      {
        targetId: 'unknown-target',
        targetContractId: 'unknown-target@1',
        outcome: 'exact',
        diagnosticCodes: [],
      },
    ])
  ).toThrowError(Error);
});

testCase('question compatibility parsing rejects persisted extension fields', () => {
  const compatibility = projectQuestionCompatibility(ITEM_XML);
  expect(() =>
    parseQuestionCompatibility([
      { ...compatibility[0], ignoredByOldReader: true },
      ...compatibility.slice(1),
    ])
  ).toThrowError(Error);
});

testCase('precomputed compatibility is refined once at its serialized boundary', async () => {
  const projected = await projectQuestionBankRevision('Capital', { title: 'Capital' }, ITEM_XML);
  const parsed = parsePrecomputedQuestionCompatibilityRecord({
    capital: {
      contentHash: projected.contentHash,
      compatibility: projected.compatibility,
    },
  });
  const precomputed = parsed.capital;
  if (!precomputed) throw new Error('Expected parsed precomputed compatibility.');

  expect(
    await projectQuestionBankRevisionFromPrecomputedCompatibility(
      'Capital',
      { title: 'Capital' },
      ITEM_XML,
      precomputed,
    ),
  ).toStrictEqual(projected);
  expect(() =>
    parsePrecomputedQuestionCompatibilityRecord({
      capital: { contentHash: projected.contentHash, compatibility: [] },
    })
  ).toThrowError(Error);
});

testCase('question search projection indexes bounded author text, not opaque payloads', () => {
  const searchText = projectQuestionSearchText('Searchable title', {
    itemId: crypto.randomUUID(),
    type: 'single_select',
    promptHtml: '<p>Searchable prompt</p>',
    choices: [{ id: 'choice-secret', text: 'Visible choice' }],
    drawingImageSrc: `data:image/png;base64,${'x'.repeat(100_000)}`,
    customAttributes: [{ name: 'private-attribute', value: 'opaque-value' }],
    importWarnings: [{ message: 'Opaque importer warning text' }],
  });
  expect(searchText).toStrictEqual('Searchable title Searchable prompt Visible choice');

  const bounded = projectQuestionSearchText('', {
    bodyHtml: `<p>${'x'.repeat(QUESTION_SEARCH_TEXT_MAX_LENGTH * 2)}</p>`,
  });
  expect(bounded.length).toStrictEqual(QUESTION_SEARCH_TEXT_MAX_LENGTH);
});

testCase('item picker query rejects malformed bounds and unknown keys', () => {
  for (const query of ['pageSize=garbage', 'page=garbage', 'page=0', 'owner=me']) {
    expect(() => parseQuestionBankPickerQuery(new URLSearchParams(query))).toThrowError(
      QuestionBankInputError,
    );
  }
  expect(parseQuestionBankPickerQuery(new URLSearchParams('pageSize=20&page=3'))).toStrictEqual({
    search: '',
    tags: [],
    assignedToMe: false,
    lifecycle: 'active',
    duplicatesOnly: false,
    page: 3,
    pageSize: 20,
  });
});

testCase('item search endpoint returns 400 for malformed pagination', async () => {
  const response = await invokeHttpMethod(
    itemSearchHandler,
    'GET',
    makeHttpRequest(
      new Request('http://local/api/items/search?pageSize=garbage&page=garbage'),
      {
        auth: {
          tenantId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
          role: 'owner',
        },
      },
    ),
  );
  expect(response.status).toStrictEqual(400);
  expect((await response.json()).error).toStrictEqual('invalid_query');
});

testCase('question bank query rejects profile outcomes without an exact target', () => {
  expect(() => parseQuestionBankQuery(new URLSearchParams('compatibility=exact'))).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof QuestionBankInputError && caught.message.includes('Choose a target')
    ),
  );
});

testCase(
  'item-bank forms reject malformed identifiers, oversized tags, and extra fields',
  async () => {
    const malformedSelection = new FormData();
    malformedSelection.set('bulkAction', 'archive');
    malformedSelection.set('questionId', 'not-a-uuid');
    expect(() => parseQuestionBankBulkForm(malformedSelection)).toThrowError(
      expect.toSatisfy((caught: unknown) =>
        caught instanceof QuestionBankBulkFormError && caught.message.includes('Select valid items')
      ),
    );

    const oversizedTag = new FormData();
    oversizedTag.set('bulkAction', 'add_tags');
    oversizedTag.set('questionId', crypto.randomUUID());
    oversizedTag.set('bulkTags', 'x'.repeat(81));
    expect(() => parseQuestionBankBulkForm(oversizedTag)).toThrowError(
      expect.toSatisfy((caught: unknown) =>
        caught instanceof QuestionBankBulkFormError && caught.message.includes('between 1 and 80')
      ),
    );

    const malformedReview = new FormData();
    malformedReview.set('action', 'comment');
    malformedReview.set('requestId', 'not-a-uuid');
    malformedReview.set('comment', 'Review comment');
    expect(
      await dispatchQuestionBankItemAction(
        { tenantId: crypto.randomUUID(), userId: crypto.randomUUID(), role: 'owner' },
        crypto.randomUUID(),
        malformedReview,
      ),
    ).toStrictEqual({ ok: false, message: 'Review request not found.', code: 'invalid_input' });

    const extraField = new FormData();
    extraField.set('action', 'archive');
    extraField.set('unexpected', 'ignored before');
    expect(
      await dispatchQuestionBankItemAction(
        { tenantId: crypto.randomUUID(), userId: crypto.randomUUID(), role: 'owner' },
        crypto.randomUUID(),
        extraField,
      ),
    ).toStrictEqual({
      ok: false,
      message: 'Item-bank form contains unsupported fields.',
      code: 'invalid_input',
    });
  },
);

testCase(
  'question bank lifecycle, duplicates, ownership, drafts, and review stay revision-bound',
  async () => {
    const tenantId = crypto.randomUUID();
    const authorId = crypto.randomUUID();
    const reviewerId = crypto.randomUUID();
    const questionIds = [crypto.randomUUID(), crypto.randomUUID()];
    const author: RequestContext = { tenantId, userId: authorId, role: 'owner' };
    const reviewer: RequestContext = { tenantId, userId: reviewerId, role: 'instructor' };
    await db.insert(tenants).values({ id: tenantId, slug: `bank-${tenantId}`, name: 'Bank Test' });
    await db.insert(users).values([
      {
        id: authorId,
        email: `${authorId}@example.com`,
        emailNormalized: `${authorId}@example.com`,
        displayName: 'Ada Author',
      },
      {
        id: reviewerId,
        email: `${reviewerId}@example.com`,
        emailNormalized: `${reviewerId}@example.com`,
        displayName: 'Rae Reviewer',
      },
    ]);
    await db.insert(organizationMemberships).values([
      { id: crypto.randomUUID(), tenantId, userId: authorId, role: 'owner' },
      { id: crypto.randomUUID(), tenantId, userId: reviewerId, role: 'instructor' },
    ]);
    try {
      const body = {
        type: 'single_select',
        itemLanguage: newAuthoringItemLanguage(),
        title: 'Exact duplicate construct',
        promptHtml: 'Capital of France?',
        choices: [{ id: 'A', text: 'Paris' }, { id: 'B', text: 'Berlin' }],
        correctId: 'A',
        standards: [{ standardId: 'GEO.1', label: 'Geography 1' }],
      };
      const revisions: Array<Awaited<ReturnType<typeof saveQuestionRevisionFixture>>> = [];
      for (const [index, questionId] of questionIds.entries()) {
        revisions.push(
          await saveQuestionRevisionFixture(author, {
            questionId,
            title: `Duplicate ${index + 1}`,
            tags: [`set-${index + 1}`],
            body: { ...body, itemId: questionId, title: `Duplicate ${index + 1}` },
            provenance: { _tag: 'Authored' },
            qtiXml: ITEM_XML,
            draftState: 'published',
          }),
        );
      }

      const detail = await getQuestionBankItemDetail(author, questionIds[0]);
      expect(detail?.duplicateItems).toStrictEqual([{ id: questionIds[1], title: 'Duplicate 2' }]);
      expect(detail?.owner.userId).toStrictEqual(authorId);
      expect(detail?.compatibility.length).toStrictEqual(9);

      const duplicateBank = await listQuestionBank(
        author,
        parseQuestionBankQuery(new URLSearchParams('q=France&standard=GEO.1&duplicates=true')),
        { locale: 'en-US' },
      );
      expect(duplicateBank.items.map((item) => item.id).sort()).toStrictEqual(
        [...questionIds].sort(),
      );
      expect(duplicateBank.facets.tags).toStrictEqual(['set-1', 'set-2']);
      expect(duplicateBank.facets.standards).toStrictEqual([{ id: 'GEO.1', label: 'Geography 1' }]);
      expect(duplicateBank.facets.types).toStrictEqual([{
        id: 'single_select',
        label: 'Single Select',
      }]);

      const readOnly = { ...reviewer, role: 'teaching_assistant' as const };
      const sourceDraft = parsePersistedDraft(
        { ...body, itemId: questionIds[0], title: 'Author revision', tags: ['shared'] },
        'single_select',
      );
      expect(
        (await applyQuestionBankBulkCommand(readOnly, {
          _tag: 'Archive',
          questionIds: [questionIds[0]],
        })).ok,
      ).toStrictEqual(false);
      expect(
        (await requestQuestionReview(readOnly, questionIds[0], reviewerId, 'Corrected answer')).ok,
      ).toStrictEqual(false);
      expect(await openLatestRevisionDraftSession(readOnly, questionIds[0])).toStrictEqual({
        ok: false,
        code: 'forbidden',
      });

      expect(
        await applyQuestionBankBulkCommand(author, {
          _tag: 'AddTags',
          questionIds,
          tags: ['shared'],
        }),
      ).toStrictEqual({ ok: true, changed: 2 });
      expect(
        await applyQuestionBankBulkCommand(author, {
          _tag: 'TransferOwnership',
          questionIds: [questionIds[0]],
          ownerUserId: reviewerId,
        }),
      ).toStrictEqual({ ok: true, changed: 1 });
      expect(
        await applyQuestionBankBulkCommand(author, {
          _tag: 'Archive',
          questionIds: [questionIds[0]],
        }),
      ).toStrictEqual({ ok: true, changed: 1 });
      expect((await getQuestionBankItemDetail(author, questionIds[0]))?.lifecycle).toStrictEqual(
        'archived',
      );
      expect(
        await applyQuestionBankBulkCommand(author, {
          _tag: 'Archive',
          questionIds,
        }),
      ).toStrictEqual({
        ok: false,
        code: 'invalid_state',
        message: 'Only active items can be archived.',
      });
      expect((await getQuestionBankItemDetail(author, questionIds[1]))?.lifecycle).toStrictEqual(
        'active',
      );
      expect(
        await applyQuestionBankBulkCommand(author, {
          _tag: 'Restore',
          questionIds: [questionIds[0]],
        }),
      ).toStrictEqual({ ok: true, changed: 1 });

      const openedAuthorDraft = await openLatestRevisionDraftSession(author, questionIds[0]);
      if (!openedAuthorDraft.ok) {
        throw new Error(`Author draft did not open: ${openedAuthorDraft.code}`);
      }
      expect(openedAuthorDraft.sourceRevisionId).toStrictEqual(revisions[0].revisionId);
      const authorDraft = openedAuthorDraft.session;
      const reviewerDraftBody = parsePersistedDraft(
        { ...sourceDraft, title: 'Reviewer revision' },
        'single_select',
      );
      const openedReviewerDraft = await openLatestRevisionDraftSession(reviewer, questionIds[0]);
      if (!openedReviewerDraft.ok) {
        throw new Error(`Reviewer draft did not open: ${openedReviewerDraft.code}`);
      }
      expect(openedReviewerDraft.sourceRevisionId).toStrictEqual(revisions[0].revisionId);
      const reviewerDraft = openedReviewerDraft.session;
      const published = await publishRevisionDraft(author, {
        draftSessionId: authorDraft.id,
        sourceRevisionId: revisions[0].revisionId,
        draft: sourceDraft,
      });
      expect(published.ok).toStrictEqual(true);
      expect(await getDraftSession(author, authorDraft.id)).toStrictEqual(null);
      const reopenedAuthorDraft = await openLatestRevisionDraftSession(author, questionIds[0]);
      if (!reopenedAuthorDraft.ok) {
        throw new Error(`Published revision draft did not open: ${reopenedAuthorDraft.code}`);
      }
      expect(reopenedAuthorDraft.sourceRevisionId).not.toStrictEqual(revisions[0].revisionId);

      const stale = await publishRevisionDraft(reviewer, {
        draftSessionId: reviewerDraft.id,
        sourceRevisionId: revisions[0].revisionId,
        draft: reviewerDraftBody,
      });
      expect(stale.ok).toStrictEqual(false);
      if (stale.ok) throw new Error('Expected stale publication to fail.');
      expect(stale.body.error).toStrictEqual('stale_source_revision');
      expect((await getDraftSession(reviewer, reviewerDraft.id))?.id).toStrictEqual(
        reviewerDraft.id,
      );

      const latest = await getQuestionRevision(author, questionIds[0]);
      if (!latest) throw new Error('Published revision is missing.');
      const archivedDraftBody = parsePersistedDraft(
        { ...sourceDraft, title: 'Archived revision' },
        'single_select',
      );
      expect(reopenedAuthorDraft.sourceRevisionId).toStrictEqual(latest.id);
      const archivedDraft = reopenedAuthorDraft.session;
      expect(
        await applyQuestionBankBulkCommand(author, {
          _tag: 'Archive',
          questionIds: [questionIds[0]],
        }),
      ).toStrictEqual({ ok: true, changed: 1 });
      const archivedPublication = await publishRevisionDraft(author, {
        draftSessionId: archivedDraft.id,
        sourceRevisionId: latest.id,
        draft: archivedDraftBody,
      });
      expect(archivedPublication.ok).toStrictEqual(false);
      if (archivedPublication.ok) throw new Error('Expected archived publication to fail.');
      expect(archivedPublication.body.error).toStrictEqual('item_archived');
      expect((await getDraftSession(author, archivedDraft.id))?.id).toStrictEqual(archivedDraft.id);
      expect(
        await applyQuestionBankBulkCommand(author, {
          _tag: 'Restore',
          questionIds: [questionIds[0]],
        }),
      ).toStrictEqual({ ok: true, changed: 1 });

      const requested = await requestQuestionReview(
        author,
        questionIds[0],
        reviewerId,
        'Corrected answer',
      );
      if (!requested.ok) throw new Error(requested.message);
      const assigned = await listQuestionBank(
        reviewer,
        parseQuestionBankQuery(new URLSearchParams('assigned=me&review=open')),
        { locale: 'en-US' },
      );
      expect(assigned.items.map((item) => item.id)).toStrictEqual([questionIds[0]]);
      expect(
        (await addQuestionReviewComment(
          author,
          questionIds[0],
          requested.requestId,
          'The distractor set is clear.',
        )).ok,
      ).toStrictEqual(true);
      await db.update(questionReviewComments).set({ createdAt: new Date(0) }).where(and(
        eq(questionReviewComments.tenantId, tenantId),
        eq(questionReviewComments.body, 'The distractor set is clear.'),
      ));
      for (let index = 1; index <= 20; index += 1) {
        expect(
          (await addQuestionReviewComment(
            author,
            questionIds[0],
            requested.requestId,
            `Bounded review comment ${index}`,
          )).ok,
        ).toStrictEqual(true);
      }
      await db.update(questionReviewComments).set({ createdAt: new Date(1_000) }).where(and(
        eq(questionReviewComments.tenantId, tenantId),
        eq(questionReviewComments.reviewRequestId, requested.requestId),
      ));
      await db.update(questionReviewComments).set({ createdAt: new Date(0) }).where(and(
        eq(questionReviewComments.tenantId, tenantId),
        eq(questionReviewComments.body, 'The distractor set is clear.'),
      ));
      expect(
        (await decideQuestionReview(
          reviewer,
          questionIds[0],
          requested.requestId,
          'approved',
          null,
        )).ok,
      ).toStrictEqual(true);
      const earlierRequestId = crypto.randomUUID();
      await db.insert(questionReviewRequests).values({
        id: earlierRequestId,
        tenantId,
        questionId: questionIds[0],
        revisionId: revisions[0].revisionId,
        requestedBy: authorId,
        reviewerUserId: reviewerId,
        state: 'open',
      });
      for (const body of ['Earlier thread first', 'Earlier thread second']) {
        expect((await addQuestionReviewComment(author, questionIds[0], earlierRequestId, body)).ok)
          .toStrictEqual(true);
      }
      await db.update(questionReviewComments).set({ createdAt: new Date(0) }).where(and(
        eq(questionReviewComments.reviewRequestId, earlierRequestId),
        eq(questionReviewComments.body, 'Earlier thread first'),
      ));
      await db.update(questionReviewComments).set({ createdAt: new Date(1_000) }).where(and(
        eq(questionReviewComments.reviewRequestId, earlierRequestId),
        eq(questionReviewComments.body, 'Earlier thread second'),
      ));
      const workspace = await getQuestionReviewWorkspace(author, questionIds[0]);
      expect(workspace?.requests.length).toStrictEqual(2);
      expect(workspace?.requests[0].state).toStrictEqual('approved');
      expect(workspace?.requests[0].comments.length).toStrictEqual(20);
      expect(workspace?.requests[1].comments.map((comment) => comment.body)).toStrictEqual([
        'Earlier thread first',
        'Earlier thread second',
      ]);
      const olderCommentCursor = workspace?.requests[0].nextBeforeCommentId;
      if (!olderCommentCursor) throw new Error('Expected an older comment page.');
      expect(workspace?.requests[0].comments.map((comment) => comment.body).sort()).toStrictEqual(
        Array.from(
          { length: 20 },
          (_value, index) => `Bounded review comment ${index + 1}`,
        ).sort(),
      );
      const olderComments = await getQuestionReviewWorkspace(author, questionIds[0], {
        commentPage: {
          requestId: requested.requestId,
          beforeCommentId: olderCommentCursor,
        },
      });
      expect(olderComments?.requests[0].comments.length).toStrictEqual(1);
      expect(olderComments?.requests[0].comments[0].body).toStrictEqual(
        'The distractor set is clear.',
      );
      expect(olderComments?.requests[0].beforeCommentId).toStrictEqual(olderCommentCursor);
      expect(olderComments?.requests[0].nextBeforeCommentId).toStrictEqual(null);
      expect(
        (await listQuestionBank(
          reviewer,
          parseQuestionBankQuery(new URLSearchParams('assigned=me&review=open')),
          { locale: 'en-US' },
        )).items,
      ).toStrictEqual([]);
      await deleteDraftSession(reviewer, reviewerDraft.id);
      await deleteDraftSession(author, archivedDraft.id);
    } finally {
      const requests = await db.select({ id: questionReviewRequests.id })
        .from(questionReviewRequests).where(eq(questionReviewRequests.tenantId, tenantId));
      if (requests.length) {
        await db.delete(questionReviewComments).where(inArray(
          questionReviewComments.reviewRequestId,
          requests.map((request) => request.id),
        ));
      }
      await db.delete(questionReviewRequests).where(eq(questionReviewRequests.tenantId, tenantId));
      await db.delete(draftSessions).where(eq(draftSessions.tenantId, tenantId));
      await db.delete(auditLogs).where(eq(auditLogs.tenantId, tenantId));
      await db.delete(questions).where(eq(questions.tenantId, tenantId));
      await db.delete(questionRevisions).where(eq(questionRevisions.tenantId, tenantId));
      await db.delete(organizationMemberships).where(
        and(
          eq(organizationMemberships.tenantId, tenantId),
          inArray(organizationMemberships.userId, [authorId, reviewerId]),
        ),
      );
      await db.delete(users).where(inArray(users.id, [authorId, reviewerId]));
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    }
  },
);
