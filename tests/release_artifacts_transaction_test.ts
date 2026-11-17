import { expect, test as testCase } from 'vitest';

import * as _fs from 'node:fs/promises';

import { eq, sql } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { workflowDispatches } from '../lib/db/workflow_canvas_schema.ts';
import { organizationMemberships, tenants, users } from '../lib/db/principal_schema.ts';
import { bankCollectionItems, bankCollections } from '../lib/db/bank_schema.ts';
import { releaseArtifacts, releaseBuildAttempts } from '../lib/db/release_artifact_schema.ts';
import {
  createBankRelease,
  getBankRelease,
  mutateBankRelease,
} from '../lib/services/bank_releases.ts';
import { prepareBankRelease } from '../lib/services/bank_release_preparation.ts';
import { claimReleaseBuild, requestReleaseBuild } from '../lib/services/release_artifacts.ts';
import { processReleaseBuild } from '../lib/services/release_build_processor.ts';
import {
  acknowledgeReleaseCandidate,
  downloadReleaseArtifact,
} from '../lib/services/release_artifact_delivery.ts';
import { setPublicationGrant } from '../lib/services/publication_grants.ts';
import {
  parseReleaseArtifactReceipt,
  RELEASE_DESTINATION,
  RELEASE_POLICY,
} from '../lib/banks/release_artifact.ts';
import { createMemoryObjectStorage } from './memory_object_storage.ts';
import { saveQuestionRevisionFixture } from './question_revision_fixture.ts';
import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import type { RequestContext } from '../lib/tenants.ts';

testCase(
  'retained Sakai artifacts fence attempts, acknowledgements and distribution across A and B',
  async function () {
    const tenantId = crypto.randomUUID(),
      userId = crypto.randomUUID(),
      otherId = crypto.randomUUID();
    const ctx: RequestContext = { tenantId, userId, role: 'owner' },
      other: RequestContext = { tenantId, userId: otherId, role: 'instructor' };
    const storage = createMemoryObjectStorage(),
      now = () => new Date('2026-09-09T23:00:00Z'),
      deps = { storage, database: db, now };
    try {
      await db.insert(tenants).values({ id: tenantId, slug: tenantId, name: 'Artifact fixture' });
      for (const actor of [ctx, other]) {
        await db.insert(users).values({
          id: actor.userId,
          email: `${actor.userId}@example.test`,
          emailNormalized: `${actor.userId}@example.test`,
        });
        await db.insert(organizationMemberships).values({
          id: crypto.randomUUID(),
          tenantId,
          userId: actor.userId,
          role: actor.role,
        });
        if (!((await setPublicationGrant(ctx, actor.userId, 'grant')).ok)) {
          expect.unreachable("Expected (await setPublicationGrant(ctx, actor.userId, 'grant')).ok");
        }
      }
      const ids = Array.from({ length: 100 }, () => crypto.randomUUID());
      const save = async (index: number, revision = 1, rich = false, unsupported = false) => {
        const body = {
          type: unsupported ? 'multi_select' : 'single_select',
          title: `Proof ${index + 1}`,
          itemLanguage: newAuthoringItemLanguage(),
          promptHtml: '',
          bodyHtml: `<p>Question ${index + 1}: Which number is two plus two?${
            rich ? '<strong>Choose.</strong>' : ''
          }</p>`,
          choices: [
            { id: 'first', text: 'Three' },
            { id: 'second', text: 'Four' },
            { id: 'third', text: 'Five' },
          ],
          correctId: revision === 1 ? 'second' : 'third',
          shuffle: false,
          ...(unsupported ? { correctIds: ['first', 'second'], maxChoices: 2, minChoices: 1 } : {}),
        };
        return await saveQuestionRevisionFixture(ctx, {
          questionId: ids[index],
          title: body.title,
          body,
          tags: [],
          qtiXml: exportQti3TestItemXml(unsupported ? 'multi_select' : 'single_select', body, {
            identifier: `item-${ids[index]}`,
          }),
          draftState: 'published',
          provenance: revision === 1
            ? { _tag: 'Authored' }
            : { _tag: 'Revision', operation: 'revised', expectedParentRevision: revision - 1 },
        });
      };
      for (let i = 0; i < ids.length; i++) await save(i);
      const collectionId = crypto.randomUUID();
      await db.insert(bankCollections).values({
        id: collectionId,
        tenantId,
        name: 'Chapter',
        description: '',
        position: 0,
        createdAt: now(),
        updatedAt: now(),
      });
      await db.insert(bankCollectionItems).values(
        ids.map((questionId, position) => ({ tenantId, collectionId, questionId, position })),
      );
      const read = async (id: string) => {
        const result = await getBankRelease(ctx, id, deps);
        if (!(result.ok)) expect.unreachable('Expected result.ok');
        return result.value;
      };
      const freeze = async (label: string, collection = false) => {
        const id = crypto.randomUUID();
        if (
          !((await createBankRelease(ctx, {
            id,
            operationId: crypto.randomUUID(),
            label,
            notes: '',
            questionIds: collection ? [] : ids,
            collectionIds: collection ? [collectionId] : [],
          }, deps)).ok)
        ) {
          expect.unreachable(
            "Expected (await createBankRelease(ctx, { id, operationId: crypto.randomUUID(), label, notes: '', qu",
          );
        }
        let release = await read(id);
        if (
          !((await prepareBankRelease(ctx, {
            releaseId: id,
            preparationId: crypto.randomUUID(),
            version: release.version,
            digest: release.digest,
          }, deps)).ok)
        ) {
          expect.unreachable(
            'Expected (await prepareBankRelease(ctx, { releaseId: id, preparationId: crypto.randomUUID(), versio',
          );
        }
        release = await read(id);
        if (
          !((await mutateBankRelease(ctx, {
            action: 'freeze',
            releaseId: id,
            operationId: crypto.randomUUID(),
            version: release.version,
            digest: release.digest,
            attestation: { reason: 'Reviewed owned fixture', overrides: [] },
          }, deps)).ok)
        ) {
          expect.unreachable(
            "Expected (await mutateBankRelease(ctx, { action: 'freeze', releaseId: id, operationId: crypto.rando",
          );
        }
        return await read(id);
      };
      const a = await freeze('Retained Sakai A compiler 2');
      const priorCompilerArtifact = {
        id: crypto.randomUUID(),
        tenantId,
        releaseId: a.id,
        releaseDigest: a.digest,
        destination: RELEASE_DESTINATION,
        compiler: 'qflow-sakai-pool.3+qti3-transcoder.0.13.0',
        policy: RELEASE_POLICY,
        currentAttemptId: crypto.randomUUID(),
        receipt: null,
        createdAt: now(),
      };
      await db.transaction(async (tx) => {
        await tx.insert(releaseArtifacts).values(priorCompilerArtifact);
        await tx.insert(releaseBuildAttempts).values({
          id: priorCompilerArtifact.currentAttemptId,
          tenantId,
          artifactId: priorCompilerArtifact.id,
          actorId: userId,
          previousAttemptId: null,
          state: 'queued',
          objectKey: `bank-releases/${tenantId}/${a.id}/${priorCompilerArtifact.id}/prior.xml`,
          createdAt: now(),
        });
      });
      const firstId = crypto.randomUUID(),
        firstRequest = { releaseId: a.id, attemptId: firstId, previousAttemptId: null };
      const requested = await requestReleaseBuild(ctx, firstRequest, deps);
      if (!(requested.ok)) expect.unreachable('Expected requested.ok');
      expect(requested.value).not.toStrictEqual(priorCompilerArtifact.id);
      const [retainedPriorCompiler] = await db.select().from(releaseArtifacts).where(
        eq(releaseArtifacts.id, priorCompilerArtifact.id),
      );
      expect(retainedPriorCompiler).toStrictEqual(priorCompilerArtifact);
      expect(await requestReleaseBuild(ctx, firstRequest, deps)).toStrictEqual(requested);
      expect(await requestReleaseBuild(other, firstRequest, deps)).toStrictEqual({
        ok: false,
        code: 'operation_conflict',
      });
      const oldClaim = await claimReleaseBuild(firstId, firstId, db);
      if (!oldClaim) expect.unreachable('Expected oldClaim');
      expect(await claimReleaseBuild(firstId, crypto.randomUUID(), db)).toStrictEqual(null);
      const currentId = crypto.randomUUID();
      if (
        !((await requestReleaseBuild(ctx, {
          releaseId: a.id,
          attemptId: currentId,
          previousAttemptId: firstId,
        }, deps)).ok)
      ) {
        expect.unreachable(
          'Expected (await requestReleaseBuild(ctx, { releaseId: a.id, attemptId: currentId, previousAttemptId',
        );
      }
      expect(await processReleaseBuild(oldClaim, deps)).toStrictEqual({
        ok: false,
        code: 'stale_preview',
      });
      const currentClaim = await claimReleaseBuild(currentId, currentId, db);
      if (!currentClaim) expect.unreachable('Expected currentClaim');
      if (!((await processReleaseBuild(currentClaim, deps)).ok)) {
        expect.unreachable('Expected (await processReleaseBuild(currentClaim, deps)).ok');
      }
      if (!((await processReleaseBuild(currentClaim, deps)).ok)) {
        expect.unreachable('Expected (await processReleaseBuild(currentClaim, deps)).ok');
      }
      const original = await downloadReleaseArtifact(
        ctx,
        a.id,
        requested.value,
        crypto.randomUUID(),
        deps,
      );
      if (!(original.ok)) expect.unreachable('Expected original.ok');
      expect(original.value.receipt.revisionIds.length).toStrictEqual(100);
      await save(0, 2);
      const b = await freeze('Retained Sakai B compiler 2', true), bId = crypto.randomUUID();
      const bBuild = await requestReleaseBuild(ctx, {
        releaseId: b.id,
        attemptId: bId,
        previousAttemptId: null,
      }, deps);
      if (!(bBuild.ok)) expect.unreachable('Expected bBuild.ok');
      const bClaim = await claimReleaseBuild(bId, bId, db);
      if (!bClaim) expect.unreachable('Expected bClaim');
      if (!((await processReleaseBuild(bClaim, deps)).ok)) {
        expect.unreachable('Expected (await processReleaseBuild(bClaim, deps)).ok');
      }
      const [candidate] = await db.select().from(releaseBuildAttempts).where(
        eq(releaseBuildAttempts.id, bId),
      );
      expect(candidate.state).toStrictEqual('candidate');
      if (!(candidate.candidateDigest)) expect.unreachable('Expected candidate.candidateDigest');
      const confirm = {
        attemptId: bId,
        candidateDigest: candidate.candidateDigest,
        policy: RELEASE_POLICY,
      };
      expect(await acknowledgeReleaseCandidate(other, b.id, confirm, deps)).toStrictEqual({
        ok: false,
        code: 'forbidden',
      });
      expect(
        await acknowledgeReleaseCandidate(ctx, b.id, {
          ...confirm,
          candidateDigest: '0'.repeat(64),
        }, deps),
      ).toStrictEqual({ ok: false, code: 'stale_preview' });
      expect((await downloadReleaseArtifact(ctx, b.id, bBuild.value, crypto.randomUUID(), deps)).ok)
        .toStrictEqual(false);
      if (!((await acknowledgeReleaseCandidate(ctx, b.id, confirm, deps)).ok)) {
        expect.unreachable(
          'Expected (await acknowledgeReleaseCandidate(ctx, b.id, confirm, deps)).ok',
        );
      }
      if (!((await acknowledgeReleaseCandidate(ctx, b.id, confirm, deps)).ok)) {
        expect.unreachable(
          'Expected (await acknowledgeReleaseCandidate(ctx, b.id, confirm, deps)).ok',
        );
      }
      const revised = await downloadReleaseArtifact(
        other,
        b.id,
        bBuild.value,
        crypto.randomUUID(),
        deps,
      );
      if (!(revised.ok)) expect.unreachable('Expected revised.ok');
      expect(revised.value.receipt.sha256).not.toStrictEqual(original.value.receipt.sha256);
      expect(revised.value.receipt.warnings).toStrictEqual(['sakai.flat_pool']);
      expect(revised.value.receipt.acknowledgement?.actorId).toStrictEqual(ctx.userId);
      const oldAgain = await downloadReleaseArtifact(
        other,
        a.id,
        requested.value,
        crypto.randomUUID(),
        deps,
      );
      if (!(oldAgain.ok)) expect.unreachable('Expected oldAgain.ok');
      expect(oldAgain.value.bytes).toStrictEqual(original.value.bytes);
      const [stored] = await db.select().from(releaseArtifacts).where(
        eq(releaseArtifacts.id, requested.value),
      );
      expect(parseReleaseArtifactReceipt(stored.receipt)).toStrictEqual(original.value.receipt);
      // Retained all-or-nothing evidence gains explicit exclusions at migration time only.
      await db.transaction(async (tx) => {
        await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
        const [beforeAttempt] = await tx.select().from(releaseBuildAttempts).where(
          eq(releaseBuildAttempts.id, currentId),
        );
        await tx.execute(sql`ALTER TABLE release_artifacts DISABLE TRIGGER release_artifact_guard`);
        await tx.execute(
          sql`ALTER TABLE release_build_attempts DISABLE TRIGGER release_build_attempt_guard`,
        );
        await tx.execute(
          sql`UPDATE release_artifacts SET receipt = receipt - 'excluded' WHERE id = ${requested.value}`,
        );
        await tx.execute(
          sql`UPDATE release_build_attempts SET report = report - 'excluded' WHERE id = ${currentId}`,
        );
        await tx.execute(sql`ALTER TABLE release_artifacts ENABLE TRIGGER release_artifact_guard`);
        await tx.execute(
          sql`ALTER TABLE release_build_attempts ENABLE TRIGGER release_build_attempt_guard`,
        );
        const migration = await _fs.readFile(
          new URL('../db/migrations/0078_release_question_exclusions.sql', import.meta.url),
          'utf8',
        );
        await tx.execute(sql.raw(migration));
        const [afterArtifact] = await tx.select().from(releaseArtifacts).where(
          eq(releaseArtifacts.id, requested.value),
        );
        const [afterAttempt] = await tx.select().from(releaseBuildAttempts).where(
          eq(releaseBuildAttempts.id, currentId),
        );
        expect(afterArtifact).toStrictEqual(stored);
        expect(afterAttempt).toStrictEqual(beforeAttempt);
      });
      await expect(
        Promise.resolve().then(() =>
          db.update(releaseArtifacts).set({ receipt: {} }).where(
            eq(releaseArtifacts.id, requested.value),
          )
        ),
      ).rejects.toBeInstanceOf(Error);
      await expect(
        Promise.resolve().then(() =>
          db.update(releaseBuildAttempts).set({ sha256: '0'.repeat(64) }).where(
            eq(releaseBuildAttempts.id, currentId),
          )
        ),
      ).rejects.toBeInstanceOf(Error);
      const withdrawn = await mutateBankRelease(ctx, {
        action: 'withdraw',
        releaseId: a.id,
        operationId: crypto.randomUUID(),
        version: a.version,
        digest: a.digest,
        reason: 'Use B',
        replacementId: b.id,
      }, deps);
      if (!(withdrawn.ok)) expect.unreachable('Expected withdrawn.ok');
      expect(await downloadReleaseArtifact(other, a.id, requested.value, crypto.randomUUID(), deps))
        .toStrictEqual({ ok: false, code: 'withdrawn' });
      expect(
        await requestReleaseBuild(ctx, {
          releaseId: a.id,
          attemptId: crypto.randomUUID(),
          previousAttemptId: currentId,
        }, deps),
      ).toStrictEqual({ ok: false, code: 'withdrawn' });
      const publisherRetry = await freeze('Different publisher retry', true),
        ownerAttempt = crypto.randomUUID();
      if (
        !((await requestReleaseBuild(ctx, {
          releaseId: publisherRetry.id,
          attemptId: ownerAttempt,
          previousAttemptId: null,
        }, deps)).ok)
      ) {
        expect.unreachable(
          'Expected (await requestReleaseBuild(ctx, { releaseId: publisherRetry.id, attemptId: ownerAttempt, p',
        );
      }
      const ownerClaim = await claimReleaseBuild(ownerAttempt, ownerAttempt, db);
      if (!ownerClaim) expect.unreachable('Expected ownerClaim');
      if (!((await processReleaseBuild(ownerClaim, deps)).ok)) {
        expect.unreachable('Expected (await processReleaseBuild(ownerClaim, deps)).ok');
      }
      const [ownerCandidate] = await db.select().from(releaseBuildAttempts).where(
        eq(releaseBuildAttempts.id, ownerAttempt),
      );
      if (!(ownerCandidate.candidateDigest)) {
        expect.unreachable('Expected ownerCandidate.candidateDigest');
      }
      const otherAttempt = crypto.randomUUID();
      if (
        !((await requestReleaseBuild(other, {
          releaseId: publisherRetry.id,
          attemptId: otherAttempt,
          previousAttemptId: ownerAttempt,
        }, deps)).ok)
      ) {
        expect.unreachable(
          'Expected (await requestReleaseBuild(other, { releaseId: publisherRetry.id, attemptId: otherAttempt,',
        );
      }
      expect(
        await acknowledgeReleaseCandidate(ctx, publisherRetry.id, {
          attemptId: ownerAttempt,
          candidateDigest: ownerCandidate.candidateDigest,
          policy: RELEASE_POLICY,
        }, deps),
      ).toStrictEqual({ ok: false, code: 'stale_preview' });
      const otherClaim = await claimReleaseBuild(otherAttempt, otherAttempt, db);
      if (!otherClaim) expect.unreachable('Expected otherClaim');
      if (!((await processReleaseBuild(otherClaim, deps)).ok)) {
        expect.unreachable('Expected (await processReleaseBuild(otherClaim, deps)).ok');
      }
      const [otherCandidate] = await db.select().from(releaseBuildAttempts).where(
        eq(releaseBuildAttempts.id, otherAttempt),
      );
      if (!(otherCandidate.candidateDigest)) {
        expect.unreachable('Expected otherCandidate.candidateDigest');
      }
      const otherConfirmation = {
        attemptId: otherAttempt,
        candidateDigest: otherCandidate.candidateDigest,
        policy: RELEASE_POLICY,
      };
      expect(await acknowledgeReleaseCandidate(ctx, publisherRetry.id, otherConfirmation, deps))
        .toStrictEqual({ ok: false, code: 'forbidden' });
      if (
        !((await acknowledgeReleaseCandidate(other, publisherRetry.id, otherConfirmation, deps)).ok)
      ) {
        expect.unreachable(
          'Expected (await acknowledgeReleaseCandidate(other, publisherRetry.id, otherConfirmation, deps)).ok',
        );
      }

      const downloadRace = await downloadReleaseArtifact(
        ctx,
        b.id,
        bBuild.value,
        crypto.randomUUID(),
        {
          ...deps,
          storage: {
            ...storage,
            async readObject(key) {
              const bytes = await storage.readObject(key);
              if (
                !((await mutateBankRelease(ctx, {
                  action: 'withdraw',
                  releaseId: b.id,
                  operationId: crypto.randomUUID(),
                  version: b.version,
                  digest: b.digest,
                  reason: 'Withdraw during storage read',
                  replacementId: null,
                }, deps)).ok)
              ) {
                expect.unreachable(
                  "Expected (await mutateBankRelease(ctx, { action: 'withdraw', releaseId: b.id, operationId: crypto.r",
                );
              }
              return bytes;
            },
          },
        },
      );
      expect(downloadRace).toStrictEqual({ ok: false, code: 'withdrawn' });
      const buildRace = await freeze('Withdraw during build'), raceAttempt = crypto.randomUUID();
      if (
        !((await requestReleaseBuild(ctx, {
          releaseId: buildRace.id,
          attemptId: raceAttempt,
          previousAttemptId: null,
        }, deps)).ok)
      ) {
        expect.unreachable(
          'Expected (await requestReleaseBuild(ctx, { releaseId: buildRace.id, attemptId: raceAttempt, previou',
        );
      }
      const raceClaim = await claimReleaseBuild(raceAttempt, raceAttempt, db);
      if (!raceClaim) expect.unreachable('Expected raceClaim');
      expect(
        await processReleaseBuild(raceClaim, {
          ...deps,
          storage: {
            ...storage,
            async putObject(input) {
              await storage.putObject(input);
              if (
                !((await mutateBankRelease(ctx, {
                  action: 'withdraw',
                  releaseId: buildRace.id,
                  operationId: crypto.randomUUID(),
                  version: buildRace.version,
                  digest: buildRace.digest,
                  reason: 'Withdraw during package write',
                  replacementId: null,
                }, deps)).ok)
              ) {
                expect.unreachable(
                  "Expected (await mutateBankRelease(ctx, { action: 'withdraw', releaseId: buildRace.id, operationId: ",
                );
              }
            },
          },
        }),
      ).toStrictEqual({ ok: false, code: 'withdrawn' });

      const revoked = await freeze('Revocation'), revokedId = crypto.randomUUID();
      if (
        !((await requestReleaseBuild(other, {
          releaseId: revoked.id,
          attemptId: revokedId,
          previousAttemptId: null,
        }, deps)).ok)
      ) {
        expect.unreachable(
          'Expected (await requestReleaseBuild(other, { releaseId: revoked.id, attemptId: revokedId, previousA',
        );
      }
      const revokedClaim = await claimReleaseBuild(revokedId, revokedId, db);
      if (!revokedClaim) expect.unreachable('Expected revokedClaim');
      if (!((await setPublicationGrant(ctx, otherId, 'revoke')).ok)) {
        expect.unreachable("Expected (await setPublicationGrant(ctx, otherId, 'revoke')).ok");
      }
      expect(await processReleaseBuild(revokedClaim, deps)).toStrictEqual({
        ok: false,
        code: 'forbidden',
      });
      expect(await downloadReleaseArtifact(other, b.id, bBuild.value, crypto.randomUUID(), deps))
        .toStrictEqual({ ok: false, code: 'forbidden' });
      await save(1, 2, true);
      await save(2, 2, false, true);
      const blocked = await freeze('Supported questions with a disclosed exclusion'),
        blockedId = crypto.randomUUID();
      if (
        !((await requestReleaseBuild(ctx, {
          releaseId: blocked.id,
          attemptId: blockedId,
          previousAttemptId: null,
        }, deps)).ok)
      ) {
        expect.unreachable(
          'Expected (await requestReleaseBuild(ctx, { releaseId: blocked.id, attemptId: blockedId, previousAtt',
        );
      }
      const blockedClaim = await claimReleaseBuild(blockedId, blockedId, db);
      if (!blockedClaim) expect.unreachable('Expected blockedClaim');
      if (!((await processReleaseBuild(blockedClaim, deps)).ok)) {
        expect.unreachable('Expected (await processReleaseBuild(blockedClaim, deps)).ok');
      }
      const [blockedAttempt] = await db.select().from(releaseBuildAttempts).where(
        eq(releaseBuildAttempts.id, blockedId),
      );
      expect(blockedAttempt.state).toStrictEqual('candidate');
      if (!(blockedAttempt.sha256)) expect.unreachable('Expected blockedAttempt.sha256');
      if (!(blockedAttempt.candidateDigest)) {
        expect.unreachable('Expected blockedAttempt.candidateDigest');
      }
      expect(
        (await acknowledgeReleaseCandidate(ctx, blocked.id, {
          attemptId: blockedId,
          candidateDigest: '0'.repeat(64),
          policy: RELEASE_POLICY,
        }, deps)).ok,
      ).toStrictEqual(false);
      if (
        !((await acknowledgeReleaseCandidate(ctx, blocked.id, {
          attemptId: blockedId,
          candidateDigest: blockedAttempt.candidateDigest,
          policy: RELEASE_POLICY,
        }, deps)).ok)
      ) {
        expect.unreachable(
          'Expected (await acknowledgeReleaseCandidate(ctx, blocked.id, { attemptId: blockedId, candidateDiges',
        );
      }
      const partial = await downloadReleaseArtifact(
        ctx,
        blocked.id,
        blockedClaim.artifactId,
        crypto.randomUUID(),
        deps,
      );
      if (!(partial.ok)) expect.unreachable('Expected partial.ok');
      expect(partial.value.receipt.revisionIds.length).toStrictEqual(99);
      expect(partial.value.receipt.excluded.length).toStrictEqual(1);
      expect(partial.value.receipt.excluded[0].revisionId).toStrictEqual(
        blocked.manifest.items[2].revisionId,
      );
      if (partial.value.receipt.revisionIds.includes(blocked.manifest.items[2].revisionId)) {
        expect.unreachable(
          'Expected !partial.value.receipt.revisionIds.includes(blocked.manifest.items[2].revisionId)',
        );
      }
      expect(blocked.manifest.items.length).toStrictEqual(100);
      if (!(partial.value.receipt.warnings.includes('sakai.questions_excluded'))) {
        expect.unreachable(
          "Expected partial.value.receipt.warnings.includes('sakai.questions_excluded')",
        );
      }
      if (!(partial.value.receipt.warnings.includes('sakai.presentation_simplified'))) {
        expect.unreachable(
          "Expected partial.value.receipt.warnings.includes('sakai.presentation_simplified')",
        );
      }
      const partialXml = new TextDecoder().decode(partial.value.bytes);
      expect((partialXml.match(/<item\s/g) ?? []).length).toStrictEqual(99);
      if (partialXml.includes(blocked.manifest.items[2].revisionId)) {
        expect.unreachable('Expected !partialXml.includes(blocked.manifest.items[2].revisionId)');
      }
      expect(parseReleaseArtifactReceipt(partial.value.receipt)).toStrictEqual(
        partial.value.receipt,
      );
      expect(() =>
        parseReleaseArtifactReceipt({
          ...partial.value.receipt,
          revisionIds: [
            ...partial.value.receipt.revisionIds,
            partial.value.receipt.excluded[0].revisionId,
          ],
        })
      ).toThrowError(Error);
      const evidenceDir = process.env['QFLOW_SAKAI_EVIDENCE_DIR'];
      if (evidenceDir) {
        await _fs.mkdir(evidenceDir, { recursive: true });
        await _fs.writeFile(`${evidenceDir}/retained-a.xml`, original.value.bytes);
        await _fs.writeFile(`${evidenceDir}/retained-b.xml`, revised.value.bytes);
        await _fs.writeFile(
          `${evidenceDir}/receipts.json`,
          JSON.stringify({ a: original.value.receipt, b: revised.value.receipt }, null, 2),
          'utf8',
        );
      }
    } finally {
      await db.delete(workflowDispatches).where(eq(workflowDispatches.tenantId, tenantId));
      await shutdownDb();
    }
  },
);
