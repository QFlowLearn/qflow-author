import { expect, test as testCase } from 'vitest';

import { loadReleasePreview } from '../lib/services/bank_release_preview.ts';
import { renderPage as renderToString } from './helpers/render_page.tsx';
import ReleasePage from '../components/releases/ReleasePage.tsx';
import { createI18n } from '../lib/i18n/messages.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';

import { eq, sql } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import {
  bankReleaseEvents,
  bankReleasePreparations,
  bankReleaseRevisions,
  bankReleases,
} from '../lib/db/bank_release_schema.ts';
import {
  organizationMemberships,
  questionReviewRequests,
  questionRevisions,
  tenants,
  users,
} from '../lib/db/schema.ts';
import {
  createBankRelease,
  getBankRelease,
  listBankReleases,
  mutateBankRelease,
} from '../lib/services/bank_releases.ts';
import {
  cleanupReleasePreparation,
  downloadReleaseSource,
  prepareBankRelease,
} from '../lib/services/bank_release_preparation.ts';
import { setPublicationGrant } from '../lib/services/publication_grants.ts';
import { decideQuestionReview, requestQuestionReview } from '../lib/services/question_reviews.ts';
import {
  compareReleases,
  parseReleaseManifest,
  releaseManifestDigest,
} from '../lib/banks/bank_release.ts';
import { saveQuestionRevisionFixture } from './question_revision_fixture.ts';
import { createMemoryObjectStorage } from './memory_object_storage.ts';
import { TYPE_DRIVERS } from '../lib/types/registry.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { exportQti3AssessmentItemXml } from '../lib/types/qti3_authoring.ts';
import { prepareDriverDraftForBuild } from '../lib/types/buildable_driver_draft.ts';
import type { RequestContext } from '../lib/tenants.ts';

testCase(
  '400-question editions retain exact content, attest the whole set and serialize withdrawal',
  async function () {
    const tenantId = crypto.randomUUID(), userId = crypto.randomUUID();
    const ctx: RequestContext = { tenantId, userId, role: 'owner' };
    const storage = createMemoryObjectStorage();
    const deps = { database: db, storage, now: () => new Date('2026-09-09T12:00:00Z') };
    try {
      await db.insert(tenants).values({ id: tenantId, slug: tenantId, name: 'Edition test' });
      await db.insert(users).values({
        id: userId,
        email: userId + '@example.test',
        emailNormalized: userId + '@example.test',
      });
      await db.insert(organizationMemberships).values({
        id: crypto.randomUUID(),
        tenantId,
        userId,
        role: 'owner',
      });
      const ids: string[] = [];
      const body = {
        ...TYPE_DRIVERS.single_select.defaults(),
        type: 'single_select' as const,
        itemLanguage: newAuthoringItemLanguage(),
        title: 'Edition question',
      };
      const save = async (questionId: string, revision = 1) => {
        const draft = { ...body, correctId: revision === 1 ? 'A' : 'B' };
        return await saveQuestionRevisionFixture(ctx, {
          questionId,
          title: body.title,
          body: draft,
          tags: [],
          qtiXml: exportQti3AssessmentItemXml(
            'single_select',
            prepareDriverDraftForBuild('single_select', draft),
          ),
          provenance: revision === 1
            ? { _tag: 'Authored' }
            : { _tag: 'Revision', operation: 'revised', expectedParentRevision: revision - 1 },
          draftState: 'published',
        });
      };
      for (let i = 0; i < 400; i++) {
        const id = crypto.randomUUID();
        ids.push(id);
        await save(id);
      }
      const input = {
        id: crypto.randomUUID(),
        operationId: crypto.randomUUID(),
        label: 'Biology A',
        notes: 'First edition',
        collectionIds: [],
        questionIds: ids,
      };
      expect(await createBankRelease(ctx, input, deps)).toStrictEqual({
        ok: false,
        code: 'forbidden',
      });
      if (!((await setPublicationGrant(ctx, userId, 'grant')).ok)) {
        expect.unreachable("Expected (await setPublicationGrant(ctx, userId, 'grant')).ok");
      }
      if (!((await createBankRelease(ctx, input, deps)).ok)) {
        expect.unreachable('Expected (await createBankRelease(ctx, input, deps)).ok');
      }
      if (!((await createBankRelease(ctx, input, deps)).ok)) {
        expect.unreachable('Expected (await createBankRelease(ctx, input, deps)).ok');
      }
      expect(await createBankRelease(ctx, { ...input, notes: 'different' }, deps)).toStrictEqual({
        ok: false,
        code: 'operation_conflict',
      });
      const read = async (id: string = input.id) => {
        const result = await getBankRelease(ctx, id, deps);
        if (!(result.ok)) expect.unreachable('Expected result.ok');
        return result.value;
      };
      const prepare = async (id: string = input.id) => {
        const row = await read(id);
        const command = {
          releaseId: id,
          version: row.version,
          digest: row.digest,
          preparationId: crypto.randomUUID(),
        };
        if (!((await prepareBankRelease(ctx, command, deps)).ok)) {
          expect.unreachable('Expected (await prepareBankRelease(ctx, command, deps)).ok');
        }
        if (!((await prepareBankRelease(ctx, command, deps)).ok)) {
          expect.unreachable('Expected (await prepareBankRelease(ctx, command, deps)).ok');
        }
        return await read(id);
      };
      const a = await prepare();
      expect(a.manifest.items.length).toStrictEqual(400);
      const operationId = crypto.randomUUID();
      const attestation = {
        reason: 'Publisher checked this complete edition',

        overrides: [],
      };
      const freeze = {
        action: 'freeze',
        releaseId: a.id,
        operationId,
        version: a.version,
        digest: a.digest,
        attestation,
      };
      expect(
        await mutateBankRelease(ctx, {
          ...freeze,
          attestation: {
            ...attestation,
            revisionIds: a.manifest.items.slice(0, 50).map((item) => item.revisionId),
          },
        }, deps),
      ).toStrictEqual({ ok: false, code: 'invalid_input' });
      if (!((await mutateBankRelease(ctx, freeze, deps)).ok)) {
        expect.unreachable('Expected (await mutateBankRelease(ctx, freeze, deps)).ok');
      }
      if (!((await mutateBankRelease(ctx, freeze, deps)).ok)) {
        expect.unreachable('Expected (await mutateBankRelease(ctx, freeze, deps)).ok');
      }
      expect(
        (await db.select().from(questionReviewRequests).where(
          eq(questionReviewRequests.tenantId, tenantId),
        )).length,
      ).toStrictEqual(0);
      const downloaded = await downloadReleaseSource(ctx, a.id, crypto.randomUUID(), deps);
      if (!(downloaded.ok)) expect.unreachable('Expected downloaded.ok');
      if (!(a.manifest.preparation)) expect.unreachable('Expected a.manifest.preparation');
      expect(await cleanupReleasePreparation(ctx, a.manifest.preparation.id, deps)).toStrictEqual({
        ok: false,
        code: 'frozen',
      });
      await expect(
        Promise.resolve().then(() =>
          db.update(bankReleases).set({ label: 'Rewrite' }).where(eq(bankReleases.id, a.id))
            .execute()
        ),
      ).rejects.toBeInstanceOf(Error);
      await expect(
        Promise.resolve().then(() =>
          db.delete(bankReleaseRevisions).where(eq(bankReleaseRevisions.releaseId, a.id)).execute()
        ),
      ).rejects.toBeInstanceOf(Error);
      await save(ids[0], 2);
      const bInput = {
        ...input,
        id: crypto.randomUUID(),
        operationId: crypto.randomUUID(),
        label: 'Biology B',
      };
      if (!((await createBankRelease(ctx, bInput, deps)).ok)) {
        expect.unreachable('Expected (await createBankRelease(ctx, bInput, deps)).ok');
      }
      const b = await prepare(bInput.id);
      expect(b.manifest.items.filter((item) => item.previouslyShipped).length).toStrictEqual(399);
      const diff = compareReleases(a.manifest, b.manifest);
      expect(diff.changed.length).toStrictEqual(1);
      expect(diff.added.length).toStrictEqual(0);
      const pageEight = await loadReleasePreview(ctx, b.id, {
        version: b.version,
        page: 8,
        filter: 'all',
      }, deps);
      if (!(pageEight.ok)) expect.unreachable('Expected pageEight.ok');
      expect(pageEight.value.counts.total).toStrictEqual(400);
      expect(pageEight.value.rows.length).toStrictEqual(50);
      for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419'] as const) {
        const html = renderToString(
          ReleasePage({
            data: pageEight.value,
            i18n: createI18n(locale, catalogForLocale(locale)),
          }),
        );
        expect((html.match(/name="attest"/g) ?? []).length).toStrictEqual(1);
        if (!(html.includes('400'))) expect.unreachable("Expected html.includes('400')");
        expect((html.match(/class="py-4 space-y-2"/g) ?? []).length).toStrictEqual(50);
      }
      const bOperation = crypto.randomUUID();
      if (
        !((await mutateBankRelease(ctx, {
          action: 'freeze',
          releaseId: b.id,
          version: b.version,
          digest: b.digest,
          operationId: bOperation,
          attestation: {
            ...attestation,
          },
        }, deps)).ok)
      ) {
        expect.unreachable(
          "Expected (await mutateBankRelease(ctx, { action: 'freeze', releaseId: b.id, version: b.version, dig",
        );
      }
      const original = await downloadReleaseSource(ctx, a.id, crypto.randomUUID(), deps);
      if (!(original.ok)) expect.unreachable('Expected original.ok');
      expect(original.value.sha256).toStrictEqual(downloaded.value.sha256);
      expect(original.value.bytes).toStrictEqual(downloaded.value.bytes);
      const withdrawn = {
        action: 'withdraw',
        releaseId: a.id,
        version: a.version,
        digest: a.digest,
        operationId: crypto.randomUUID(),
        reason: 'Use corrected edition',
        replacementId: b.id,
      };
      const readStarted = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
      const pending = downloadReleaseSource(ctx, a.id, crypto.randomUUID(), {
        ...deps,
        storage: {
          ...storage,
          async readObject(key) {
            readStarted.resolve();
            await resume.promise;
            return await storage.readObject(key);
          },
        },
      });
      await readStarted.promise;
      if (!((await mutateBankRelease(ctx, withdrawn, deps)).ok)) {
        expect.unreachable('Expected (await mutateBankRelease(ctx, withdrawn, deps)).ok');
      }
      expect((await read(a.id)).replacementId).toStrictEqual(b.id);
      expect(await mutateBankRelease(ctx, { ...withdrawn, operationId: crypto.randomUUID() }, deps))
        .toStrictEqual({ ok: false, code: 'invalid_transition' });
      if (!((await mutateBankRelease(ctx, withdrawn, deps)).ok)) {
        expect.unreachable('Expected (await mutateBankRelease(ctx, withdrawn, deps)).ok');
      }
      resume.resolve();
      expect(await pending).toStrictEqual({ ok: false, code: 'withdrawn' });
      expect(await downloadReleaseSource(ctx, a.id, crypto.randomUUID(), deps)).toStrictEqual({
        ok: false,
        code: 'withdrawn',
      });
      if (
        !((await mutateBankRelease(ctx, {
          ...withdrawn,
          action: 'restore',
          operationId: crypto.randomUUID(),
          reason: 'Available for reference',
          replacementId: null,
        }, deps)).ok)
      ) {
        expect.unreachable(
          "Expected (await mutateBankRelease(ctx, { ...withdrawn, action: 'restore', operationId: crypto.rando",
        );
      }
      if (!((await downloadReleaseSource(ctx, a.id, crypto.randomUUID(), deps)).ok)) {
        expect.unreachable(
          'Expected (await downloadReleaseSource(ctx, a.id, crypto.randomUUID(), deps)).ok',
        );
      }
      if (!((await setPublicationGrant(ctx, userId, 'revoke')).ok)) {
        expect.unreachable("Expected (await setPublicationGrant(ctx, userId, 'revoke')).ok");
      }
      expect(await downloadReleaseSource(ctx, a.id, crypto.randomUUID(), deps)).toStrictEqual({
        ok: false,
        code: 'forbidden',
      });
      if (!((await setPublicationGrant(ctx, userId, 'grant')).ok)) {
        expect.unreachable("Expected (await setPublicationGrant(ctx, userId, 'grant')).ok");
      }
      // A changed current revision rejects freeze; explicit historical retention preserves it.
      const cInput = {
        ...input,
        id: crypto.randomUUID(),
        operationId: crypto.randomUUID(),
        label: 'Historical choice',
        questionIds: [ids[0], ids[1]],
      };
      if (!((await createBankRelease(ctx, cInput, deps)).ok)) {
        expect.unreachable('Expected (await createBankRelease(ctx, cInput, deps)).ok');
      }
      let c = await prepare(cInput.id);
      await save(ids[0], 3);
      const stalePreview = await loadReleasePreview(ctx, c.id, {
        version: c.version,
        page: 1,
        filter: 'stale',
      }, deps);
      if (!(stalePreview.ok)) expect.unreachable('Expected stalePreview.ok');
      expect(stalePreview.value.counts.stale).toStrictEqual(1);
      expect(stalePreview.value.rows.map((item) => item.questionId)).toStrictEqual([ids[0]]);
      expect(stalePreview.value.correctionQuestionIds).toStrictEqual([]);
      const cOp = crypto.randomUUID();
      const cFreeze = {
        action: 'freeze',
        releaseId: c.id,
        version: c.version,
        digest: c.digest,
        operationId: cOp,
        attestation: {
          ...attestation,
        },
      };
      expect(await mutateBankRelease(ctx, cFreeze, deps)).toStrictEqual({
        ok: false,
        code: 'stale_preview',
      });
      if (
        !((await mutateBankRelease(ctx, {
          action: 'keep',
          releaseId: c.id,
          version: c.version,
          digest: c.digest,
          operationId: crypto.randomUUID(),
          questionIds: [ids[0]],
        }, deps)).ok)
      ) {
        expect.unreachable(
          "Expected (await mutateBankRelease(ctx, { action: 'keep', releaseId: c.id, version: c.version, diges",
        );
      }
      c = await prepare(c.id);
      const cFinalOp = crypto.randomUUID();
      if (
        !((await mutateBankRelease(ctx, {
          ...cFreeze,
          version: c.version,
          digest: c.digest,
          operationId: cFinalOp,
          attestation: {
            ...attestation,
          },
        }, deps)).ok)
      ) {
        expect.unreachable(
          'Expected (await mutateBankRelease(ctx, { ...cFreeze, version: c.version, digest: c.digest, operatio',
        );
      }
      const frozenC = await read(c.id);
      expect(frozenC.manifest.items[0].revision).toStrictEqual(2);
      // An exception outside the first 50 rows must participate in freeze and cannot be omitted.
      const request = await requestQuestionReview(ctx, ids[399], userId, 'Check the last question');
      if (!(request.ok)) expect.unreachable('Expected request.ok');
      if (
        !((await decideQuestionReview(
          ctx,
          ids[399],
          request.requestId,
          'changes_requested',
          'Needs a correction',
        )).ok)
      ) {
        expect.unreachable(
          "Expected (await decideQuestionReview( ctx, ids[399], request.requestId, 'changes_requested', 'Needs",
        );
      }
      const dInput = {
        ...input,
        id: crypto.randomUUID(),
        operationId: crypto.randomUUID(),
        label: 'Exception edition',
      };
      if (!((await createBankRelease(ctx, dInput, deps)).ok)) {
        expect.unreachable('Expected (await createBankRelease(ctx, dInput, deps)).ok');
      }
      let d = await prepare(dInput.id);
      const exceptionPreview = await loadReleasePreview(ctx, d.id, {
        version: d.version,
        page: 1,
        filter: 'all',
      }, deps);
      if (!(exceptionPreview.ok)) expect.unreachable('Expected exceptionPreview.ok');
      expect(exceptionPreview.value.counts.exceptions).toStrictEqual(1);
      expect(exceptionPreview.value.rows[0].questionId).toStrictEqual(ids[399]);
      expect(exceptionPreview.value.correctionQuestionIds).toStrictEqual([ids[399]]);
      expect(exceptionPreview.value.counts.stale).toStrictEqual(0);
      const dOp = crypto.randomUUID();
      expect(
        await mutateBankRelease(ctx, {
          action: 'freeze',
          releaseId: d.id,
          version: d.version,
          digest: d.digest,
          operationId: dOp,
          attestation: {
            ...attestation,
          },
        }, deps),
      ).toStrictEqual({ ok: false, code: 'override_required' });
      if (
        !((await mutateBankRelease(ctx, {
          action: 'exclude',
          releaseId: d.id,
          version: d.version,
          digest: d.digest,
          operationId: crypto.randomUUID(),
          questionIds: [ids[399]],
          reason: 'Resolve before next edition',
        }, deps)).ok)
      ) {
        expect.unreachable(
          "Expected (await mutateBankRelease(ctx, { action: 'exclude', releaseId: d.id, version: d.version, di",
        );
      }
      d = await prepare(d.id);
      expect(
        await loadReleasePreview(
          ctx,
          d.id,
          { version: d.version - 1, page: 1, filter: 'all' },
          deps,
        ),
      ).toStrictEqual({ ok: false, code: 'stale_preview' });
      expect(d.manifest.items.length).toStrictEqual(399);
      expect(d.manifest.exclusions.length).toStrictEqual(1);
      expect(d.manifest.items.some((item) => item.questionId === ids[399])).toStrictEqual(false);
      const rollbackOperation = crypto.randomUUID();
      const excludedFreeze = {
        action: 'freeze',
        releaseId: d.id,
        version: d.version,
        digest: d.digest,
        operationId: rollbackOperation,
        attestation: {
          ...attestation,
        },
      };
      await db.execute(
        sql.raw(
          `CREATE FUNCTION reject_test_release_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.command->>'action' = 'freeze' THEN RAISE EXCEPTION 'injected event failure'; END IF; RETURN NEW; END $$`,
        ),
      );
      await db.execute(
        sql.raw(
          'CREATE TRIGGER reject_test_release_event BEFORE INSERT ON bank_release_events FOR EACH ROW EXECUTE FUNCTION reject_test_release_event()',
        ),
      );
      await expect(Promise.resolve().then(() => mutateBankRelease(ctx, excludedFreeze, deps)))
        .rejects.toBeInstanceOf(Error);
      expect((await read(d.id)).state).toStrictEqual('draft');
      expect((await read(d.id)).evidence).toStrictEqual(null);
      if (!(d.manifest.preparation)) expect.unreachable('Expected d.manifest.preparation');
      const [unadopted] = await db.select().from(bankReleasePreparations).where(
        eq(bankReleasePreparations.id, d.manifest.preparation.id),
      );
      expect(unadopted.state).toStrictEqual('ready');
      await db.execute(sql.raw('DROP TRIGGER reject_test_release_event ON bank_release_events'));
      await db.execute(sql.raw('DROP FUNCTION reject_test_release_event()'));
      if (!((await mutateBankRelease(ctx, excludedFreeze, deps)).ok)) {
        expect.unreachable('Expected (await mutateBankRelease(ctx, excludedFreeze, deps)).ok');
      }
      expect((await read(d.id)).manifest.items.length).toStrictEqual(399);
      // Cleanup racing an in-flight preparation prevents adoption and removes late bytes.
      const raceInput = {
        ...input,
        id: crypto.randomUUID(),
        operationId: crypto.randomUUID(),
        label: 'Preparation race',
        questionIds: [ids[1]],
      };
      if (!((await createBankRelease(ctx, raceInput, deps)).ok)) {
        expect.unreachable('Expected (await createBankRelease(ctx, raceInput, deps)).ok');
      }
      const race = await read(raceInput.id);
      const prepId = crypto.randomUUID(),
        writing = Promise.withResolvers<void>(),
        continueWrite = Promise.withResolvers<void>();
      const preparation = prepareBankRelease(ctx, {
        releaseId: race.id,
        version: race.version,
        digest: race.digest,
        preparationId: prepId,
      }, {
        ...deps,
        storage: {
          ...storage,
          async putObject(input) {
            writing.resolve();
            await continueWrite.promise;
            await storage.putObject(input);
          },
        },
      });
      await writing.promise;
      if (!((await cleanupReleasePreparation(ctx, prepId, deps)).ok)) {
        expect.unreachable('Expected (await cleanupReleasePreparation(ctx, prepId, deps)).ok');
      }
      continueWrite.resolve();
      expect(await preparation).toStrictEqual({ ok: false, code: 'preparation_conflict' });
      const [reserved] = await db.select().from(bankReleasePreparations).where(
        eq(bankReleasePreparations.id, prepId),
      );
      await expect(Promise.resolve().then(async () => await storage.readObject(reserved.objectKey)))
        .rejects.toBeInstanceOf(Error);
      // Keyset history reaches older editions without duplicates.
      const historyTime = new Date();
      const historyEvidence = (await read(a.id)).evidence;
      await db.insert(bankReleases).values(
        await Promise.all(Array.from({ length: 101 }, async (_, index) => {
          const manifest = { ...a.manifest, label: `History ${index}` };
          return {
            id: crypto.randomUUID(),
            tenantId,
            label: manifest.label,
            version: 1,
            state: 'frozen',
            distribution: 'available',
            manifest,
            digest: await releaseManifestDigest(manifest),
            createdBy: userId,
            createdAt: historyTime,
            frozenAt: historyTime,
            evidence: historyEvidence,
          };
        })),
      );
      const firstHistory = await listBankReleases(ctx, { before: null }, deps);
      if (!(firstHistory.ok)) expect.unreachable('Expected firstHistory.ok');
      expect(firstHistory.value.rows.length).toStrictEqual(100);
      if (!(firstHistory.value.next)) expect.unreachable('Expected firstHistory.value.next');
      const secondHistory = await listBankReleases(ctx, { before: firstHistory.value.next }, deps);
      if (!(secondHistory.ok)) expect.unreachable('Expected secondHistory.ok');
      if (!(secondHistory.value.rows.some((row) => row.id === a.id))) {
        expect.unreachable('Expected secondHistory.value.rows.some((row) => row.id === a.id)');
      }
      expect(secondHistory.value.next).toStrictEqual(null);
      if (
        secondHistory.value.rows.some((row) =>
          firstHistory.value.rows.some((first) => first.id === row.id)
        )
      ) {
        expect.unreachable(
          'Expected !secondHistory.value.rows.some((row) => firstHistory.value.rows.some((first) => first.id =',
        );
      }
      if (
        !((await loadReleasePreview(ctx, a.id, { version: null, page: 1, filter: 'all' }, deps)).ok)
      ) {
        expect.unreachable(
          "Expected (await loadReleasePreview(ctx, a.id, { version: null, page: 1, filter: 'all' }, deps)).ok",
        );
      }
      const firstChoices = await loadReleasePreview(ctx, a.id, {
        version: a.version,
        page: 1,
        filter: 'all',
      }, deps);
      if (!(firstChoices.ok)) expect.unreachable('Expected firstChoices.ok');
      expect(firstChoices.value.comparisons.length).toStrictEqual(100);
      if (!(firstChoices.value.comparisonNext)) {
        expect.unreachable('Expected firstChoices.value.comparisonNext');
      }
      const olderChoices = await loadReleasePreview(ctx, a.id, {
        version: a.version,
        page: 1,
        filter: 'all',
        comparisonBefore: firstChoices.value.comparisonNext,
      }, deps);
      if (!(olderChoices.ok)) expect.unreachable('Expected olderChoices.ok');
      if (!(olderChoices.value.comparisons.some((row) => row.id === b.id))) {
        expect.unreachable(
          'Expected olderChoices.value.comparisons.some((row) => row.id === b.id)',
        );
      }
      expect(olderChoices.value.comparisonNext).toStrictEqual(null);
      if (
        olderChoices.value.comparisons.some((row) =>
          firstChoices.value.comparisons.some((first) => row.id === first.id)
        )
      ) {
        expect.unreachable(
          'Expected !olderChoices.value.comparisons.some((row) => firstChoices.value.comparisons.some((first) ',
        );
      }
      // Missing retained bytes block freeze even if a preparation receipt exists.
      const missing = await prepare(race.id);
      if (!(missing.manifest.preparation)) {
        expect.unreachable('Expected missing.manifest.preparation');
      }
      const [missingPrep] = await db.select().from(bankReleasePreparations).where(
        eq(bankReleasePreparations.id, missing.manifest.preparation.id),
      );
      await storage.deleteObject(missingPrep.objectKey);
      expect(
        await mutateBankRelease(ctx, {
          ...cFreeze,
          releaseId: missing.id,
          version: missing.version,
          digest: missing.digest,
          operationId: crypto.randomUUID(),
        }, deps),
      ).toStrictEqual({ ok: false, code: 'technical_blocker' });
      expect(parseReleaseManifest((await read(a.id)).manifest)).toStrictEqual(a.manifest);
      if (
        !((await db.select().from(bankReleaseEvents).where(eq(bankReleaseEvents.releaseId, a.id)))
          .length >= 4)
      ) {
        expect.unreachable(
          'Expected (await db.select().from(bankReleaseEvents).where(eq(bankReleaseEvents.releaseId, a.id))) .',
        );
      }
      if (
        !((await db.select().from(questionRevisions).where(
          eq(questionRevisions.tenantId, tenantId),
        ))
          .length >= 402)
      ) {
        expect.unreachable(
          'Expected (await db.select().from(questionRevisions).where(eq(questionRevisions.tenantId, tenantId))',
        );
      }
    } finally {
      await shutdownDb();
    }
  },
);
