import { expect, test as testCase } from 'vitest';

import { checkPublicationReviewBrowser } from './helpers/publication_review_browser.ts';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import {
  auditLogs,
  organizationMemberships,
  questionReviewRequests,
  questionRevisions,
  questions,
  tenants,
  users,
  workspacePublicationGrants,
} from '../lib/db/schema.ts';
import { setPublicationGrant } from '../lib/services/publication_grants.ts';
import {
  canPublishEditions,
  lockWorkspace,
  lockWorkspaceAndRequireAuthority,
} from '../lib/services/workspace_authorization.ts';
import { removeMember, updateMemberRole } from '../lib/services/memberships.ts';
import {
  decideQuestionReview,
  getQuestionReviewWorkspace,
  requestQuestionReview,
} from '../lib/services/question_reviews.ts';
import { loadRevisionPublicationEligibility } from '../lib/services/publication_evidence.ts';
import { loadReviewQueue } from '../lib/services/review_queue.ts';
import { type RequestContext, SYSTEM_USER_ID } from '../lib/tenants.ts';
import { saveQuestionRevisionFixture } from './question_revision_fixture.ts';
import { TYPE_DRIVERS } from '../lib/types/registry.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { exportQti3AssessmentItemXml } from '../lib/types/qti3_authoring.ts';
import { prepareDriverDraftForBuild } from '../lib/types/buildable_driver_draft.ts';

testCase(
  'publication grants, immutable reviews and revocation share the tenant boundary',
  async function () {
    const tenantId = crypto.randomUUID(),
      ownerId = crypto.randomUUID(),
      memberId = crypto.randomUUID(),
      questionId = crypto.randomUUID();
    const owner: RequestContext = { tenantId, userId: ownerId, role: 'owner' };
    const member: RequestContext = { tenantId, userId: memberId, role: 'instructor' };
    try {
      await db.insert(tenants).values({ id: tenantId, slug: tenantId, name: 'Publication test' });
      await db.insert(users).values(
        [ownerId, memberId].map((id) => ({
          id,
          email: id + '@example.test',
          emailNormalized: id + '@example.test',
        })),
      );
      await db.insert(organizationMemberships).values(
        [owner, member].map((ctx) => ({
          id: crypto.randomUUID(),
          tenantId,
          userId: ctx.userId,
          role: ctx.role,
        })),
      );
      expect(await canPublishEditions(db, owner)).toStrictEqual(false);
      expect(await setPublicationGrant(member, memberId, 'grant')).toStrictEqual({
        ok: false,
        code: 'forbidden',
      });
      expect(await setPublicationGrant(owner, SYSTEM_USER_ID, 'grant')).toStrictEqual({
        ok: false,
        code: 'invalid_member',
      });
      if (!((await setPublicationGrant(owner, memberId, 'grant')).ok)) {
        expect.unreachable("Expected (await setPublicationGrant(owner, memberId, 'grant')).ok");
      }
      if (!(await canPublishEditions(db, member))) {
        expect.unreachable('Expected await canPublishEditions(db, member)');
      }
      expect(await canPublishEditions(db, owner)).toStrictEqual(false);
      expect(await canPublishEditions(db, { ...member, tenantId: crypto.randomUUID() }))
        .toStrictEqual(false);

      const pending = Promise.withResolvers<Promise<boolean>>();
      await db.transaction(async (tx) => {
        if (!(await lockWorkspace(tx, tenantId))) {
          expect.unreachable('Expected await lockWorkspace(tx, tenantId)');
        }
        await tx.delete(workspacePublicationGrants).where(
          eq(workspacePublicationGrants.tenantId, tenantId),
        );
        if (!(await canPublishEditions(db, member))) {
          expect.unreachable('Expected await canPublishEditions(db, member)');
        }
        pending.resolve(
          db.transaction((other) =>
            lockWorkspaceAndRequireAuthority(other, member, { grant: 'publication' })
          ),
        );
      });
      expect(await pending.promise).toStrictEqual(false);
      if (!((await setPublicationGrant(owner, memberId, 'grant')).ok)) {
        expect.unreachable("Expected (await setPublicationGrant(owner, memberId, 'grant')).ok");
      }

      const body = {
        ...TYPE_DRIVERS.single_select.defaults(),
        type: 'single_select' as const,
        itemLanguage: newAuthoringItemLanguage(),
        title: 'Owned review item',
      };
      const saved = await saveQuestionRevisionFixture(member, {
        questionId,
        title: body.title,
        body,
        tags: [],
        qtiXml: exportQti3AssessmentItemXml(
          'single_select',
          prepareDriverDraftForBuild('single_select', body),
        ),
        provenance: { _tag: 'Authored' },
        draftState: 'published',
      });
      const requested = await requestQuestionReview(
        member,
        questionId,
        memberId,
        'Verified answer',
      );
      if (!(requested.ok)) expect.unreachable('Expected requested.ok');
      expect((await loadReviewQueue(member, { view: 'assigned', before: null }))?.rows.length)
        .toStrictEqual(1);
      if (
        !((await updateMemberRole({
          actor: owner,
          tenantId,
          userId: memberId,
          role: 'teaching_assistant',
        })).ok)
      ) {
        expect.unreachable(
          "Expected (await updateMemberRole({ actor: owner, tenantId, userId: memberId, role: 'teaching_assist",
        );
      }
      expect(
        (await decideQuestionReview(member, questionId, requested.requestId, 'approved', null)).ok,
      ).toStrictEqual(false);
      expect((await requestQuestionReview(member, questionId, ownerId, 'Read-only attempt')).ok)
        .toStrictEqual(false);
      if (
        !((await updateMemberRole({ actor: owner, tenantId, userId: memberId, role: 'instructor' }))
          .ok)
      ) {
        expect.unreachable(
          "Expected (await updateMemberRole({ actor: owner, tenantId, userId: memberId, role: 'instructor' }))",
        );
      }
      if (
        !((await decideQuestionReview(member, questionId, requested.requestId, 'approved', null))
          .ok)
      ) {
        expect.unreachable(
          "Expected (await decideQuestionReview(member, questionId, requested.requestId, 'approved', null)).ok",
        );
      }
      expect(
        (await getQuestionReviewWorkspace(owner, questionId))?.requests[0].approvalIndependence,
      ).toStrictEqual('self_review');
      const [revision] = await db.select().from(questionRevisions).where(
        eq(questionRevisions.questionId, questionId),
      );
      const evidence = await loadRevisionPublicationEligibility(db, owner, [revision.id]);
      if (!(evidence.ok)) expect.unreachable('Expected evidence.ok');
      if (!(evidence.revisions[0].kind === 'reviewed')) {
        expect.unreachable("Expected evidence.revisions[0].kind === 'reviewed'");
      }
      expect(evidence.revisions[0].evidence.independence).toStrictEqual('self_review');
      expect(saved.revision).toStrictEqual(1);
      await expect(
        Promise.resolve().then(() =>
          db.update(questionReviewRequests).set({ decisionNote: 'Rewritten evidence' }).where(
            eq(questionReviewRequests.id, requested.requestId),
          ).execute()
        ),
      ).rejects.toBeInstanceOf(Error);
      if (process.env['QFLOW_BROWSER_TESTS'] === '1') {
        await checkPublicationReviewBrowser(owner, questionId);
      }
      await db.update(questions).set({ ownerUserId: ownerId }).where(eq(questions.id, questionId));
      const corrected = { ...body, correctId: 'B' };
      await saveQuestionRevisionFixture(member, {
        questionId,
        title: body.title,
        body: corrected,
        tags: [],
        qtiXml: exportQti3AssessmentItemXml(
          'single_select',
          prepareDriverDraftForBuild('single_select', corrected),
        ),
        provenance: { _tag: 'Revision', operation: 'revised', expectedParentRevision: 1 },
        draftState: 'published',
      });
      const revisions = await db.select().from(questionRevisions).where(
        eq(questionRevisions.questionId, questionId),
      );
      const afterEdit = await loadRevisionPublicationEligibility(
        db,
        owner,
        revisions.map((row) => row.id),
      );
      if (!(afterEdit.ok)) expect.unreachable('Expected afterEdit.ok');
      const original = afterEdit.revisions.find((row) => row.revisionId === revision.id);
      if (!(original?.kind === 'reviewed')) {
        expect.unreachable("Expected original?.kind === 'reviewed'");
      }
      expect(original.evidence.independence).toStrictEqual('self_review');
      expect(afterEdit.revisions.filter((row) => row.kind === 'attestation_required').length)
        .toStrictEqual(1);
      expect(await loadRevisionPublicationEligibility(db, owner, [crypto.randomUUID()]))
        .toStrictEqual({
          ok: false,
          code: 'revision_set_unavailable',
        });
      expect(
        await loadRevisionPublicationEligibility(db, { ...owner, userId: SYSTEM_USER_ID }, [
          revision.id,
        ]),
      ).toStrictEqual({
        ok: false,
        code: 'forbidden',
      });
      const correction = await requestQuestionReview(
        member,
        questionId,
        ownerId,
        'Check the corrected answer',
      );
      if (!(correction.ok)) expect.unreachable('Expected correction.ok');
      expect((await loadReviewQueue(member, { view: 'assigned', before: null }))?.rows.length)
        .toStrictEqual(0);
      expect(
        (await loadReviewQueue(owner, { view: 'assigned', before: null }))?.rows.map((row) =>
          row.id
        ),
      ).toStrictEqual([correction.requestId]);
      expect(
        (await loadReviewQueue(owner, { view: 'open', before: null }))?.rows.map((row) => row.id),
      ).toStrictEqual([correction.requestId]);
      if (
        !((await decideQuestionReview(
          owner,
          questionId,
          correction.requestId,
          'changes_requested',
          'Explain the answer',
        )).ok)
      ) {
        expect.unreachable(
          "Expected (await decideQuestionReview( owner, questionId, correction.requestId, 'changes_requested',",
        );
      }
      expect(
        (await loadReviewQueue(owner, { view: 'changes_requested', before: null }))?.rows.map(
          (row) => row.id,
        ),
      ).toStrictEqual([correction.requestId]);
      expect(
        (await loadReviewQueue(owner, { view: 'closed', before: null }))?.rows.map((row) => row.id),
      ).toStrictEqual([requested.requestId]);
      await expect(
        Promise.resolve().then(() =>
          loadReviewQueue(owner, { view: 'closed', before: correction.requestId })
        ),
      ).rejects.toBeInstanceOf(Error);
      if (!((await removeMember({ actor: owner, tenantId, userId: memberId })).ok)) {
        expect.unreachable(
          'Expected (await removeMember({ actor: owner, tenantId, userId: memberId })).ok',
        );
      }
      expect(await canPublishEditions(db, member)).toStrictEqual(false);
      expect(
        await db.select().from(workspacePublicationGrants).where(
          eq(workspacePublicationGrants.tenantId, tenantId),
        ),
      ).toStrictEqual([]);
      expect(
        (await decideQuestionReview(member, questionId, requested.requestId, 'approved', null)).ok,
      ).toStrictEqual(false);
      if (
        !((await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId))).some((row) =>
          row.action === 'publication.granted'
        ))
      ) {
        expect.unreachable(
          'Expected (await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId))).some((row) => ',
        );
      }
    } finally {
      await db.delete(questionReviewRequests).where(eq(questionReviewRequests.tenantId, tenantId));
      await db.update(questions).set({ latestRevisionId: null }).where(
        eq(questions.tenantId, tenantId),
      );
      await db.delete(questionRevisions).where(eq(questionRevisions.tenantId, tenantId));
      await db.delete(questions).where(eq(questions.tenantId, tenantId));
      await db.delete(tenants).where(eq(tenants.id, tenantId));
      await db.delete(auditLogs).where(eq(auditLogs.tenantId, tenantId));
      for (const id of [ownerId, memberId]) {
        await db.delete(users).where(eq(users.id, id));
      }
      await shutdownDb();
    }
  },
);
