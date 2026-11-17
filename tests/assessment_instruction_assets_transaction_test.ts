import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';
import { unzipSync } from 'fflate';
import { db, shutdownDb } from '../lib/db.ts';
import { assessmentExportReceipts, uploadsTable } from '../lib/db/schema.ts';
import { buildAssessmentPackage } from '../lib/export/assessment_package.ts';
import { strictAssessmentExportRequirements } from '../lib/export/assessment_export_requirements.ts';
import { parseQtiPackage } from '../lib/import/adapters/qti3/parse_package.ts';
import { createMaterializedAssessmentExport } from '../lib/export/authorized_assessment_export_service.ts';
import { persistMaterializedAssessmentExport } from '../lib/export/assessment_export_receipt_store.ts';
import { exportActorIdFromAuthenticatedUser } from '../lib/export/assessment_export_requirements.ts';
import {
  claimDeliveryPublishAttempt,
  completeDeliveryPublishAttempt,
  prepareDeliveryPublishAttempt,
} from '../lib/services/delivery_publish_attempts.ts';
import { readAssessmentPublicationReview } from '../lib/services/assessment_publication_status.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { saveUpload, type StoredUpload } from '../lib/uploads.ts';
import { saveAssessmentArrangementFixture } from './helpers/assessment_arrangement.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { requireQaDatabaseUrl } from './helpers/qa_database.ts';
import { createMemoryObjectStorage } from './memory_object_storage.ts';

testCase(
  'assessment instructions package owned images at root-relative paths and reject missing bytes',
  async () => {
    requireQaDatabaseUrl(process.env['DATABASE_URL']);
    const storage = createMemoryObjectStorage();
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const assessment = await createAssessmentDraft(ctx, {
          title: 'Instruction asset acceptance',
        });
        const uploads: StoredUpload[] = [];
        try {
          const bytes = new TextEncoder().encode(
            '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="18"><rect width="32" height="18" fill="blue"/></svg>',
          );
          const upload = await saveUpload(ctx, bytes, {
            name: 'instructions.svg',
            type: 'image/svg+xml',
            storage,
            runtime: { bindings: { QFLOW_UPLOAD_BASE: '/uploads' } },
          });
          uploads.push(upload);
          const instructionOnly = await saveUpload(ctx, bytes, {
            name: 'instruction-only.svg',
            type: 'image/svg+xml',
            storage,
            runtime: { bindings: { QFLOW_UPLOAD_BASE: '/uploads' } },
          });
          uploads.push(instructionOnly);
          const initial = await getAssessment(ctx, assessment.id);
          if (!initial) expect.unreachable('Expected initial');
          const question = await saveAssessmentQuestion(ctx, assessment.id, {
            _tag: 'Create',
            partId: initial.parts[0].id,
            draft: {
              type: 'single_select',
              title: 'Choose a shape',
              itemLanguage: newAuthoringItemLanguage(),
              bodyHtml:
                `<p>Choose the blue rectangle.</p><img src="${upload.url}" alt="Question blue rectangle"/>`,
              choices: [{ id: 'A', text: 'Rectangle' }, { id: 'B', text: 'Circle' }],
              correctId: 'A',
            },
          });
          if (!(question.ok)) expect.unreachable('Expected question.ok');
          const saved = await getAssessment(ctx, assessment.id);
          if (!saved) expect.unreachable('Expected saved');
          await saveAssessmentArrangementFixture(ctx, assessment.id, [{
            ...saved.parts[0],
            options: {
              instructionsHtml:
                `<p>Read the diagram.</p><img src="${upload.url}" alt="Instruction blue rectangle"/><img src="${instructionOnly.url}" alt="Instruction-only rectangle"/>`,
            },
          }]);
          const current = await getAssessment(ctx, assessment.id);
          if (!current) expect.unreachable('Expected current');
          const input = {
            assessment: current,
            auth: ctx,
            targetId: 'qti3-conformant',
            requirements: strictAssessmentExportRequirements(),
            readUploadBytes: (value: StoredUpload) => storage.readObject(value.path),
          };
          const built = await buildAssessmentPackage(input);
          if (!(built.ok)) expect.unreachable(built.ok ? '' : built.body.error);
          const entries = unzipSync(built.artifact.bytes);
          const path = `assets/${upload.id}-${upload.name}`;
          const decoder = new TextDecoder();
          expect(entries[path]).toStrictEqual(bytes);
          const instructionPath = `assets/${instructionOnly.id}-${instructionOnly.name}`;
          expect(entries[instructionPath]).toStrictEqual(bytes);
          const xml = decoder.decode(entries['assessment.xml']);
          expect(xml).toContain(`src="${path}"`);
          expect(xml).toContain(`src="${instructionPath}"`);
          expect(xml).toContain('alt="Instruction blue rectangle"');
          if (xml.includes('/uploads/')) {
            expect.unreachable("Expected !xml.includes('/uploads/')");
          }
          const itemXml = Object.entries(entries).find(([name]) => name.startsWith('items/'));
          if (!itemXml) expect.unreachable('Expected itemXml');
          expect(decoder.decode(itemXml[1])).toContain(`src="../${path}"`);
          const manifest = decoder.decode(entries['imsmanifest.xml']);
          expect((manifest.match(/<resource[^>]+type="webcontent"/g) ?? []).length).toStrictEqual(
            2,
          );
          expect((manifest.match(/<dependency identifierref="asset-/g) ?? []).length).toStrictEqual(
            3,
          );
          const imported = await parseQtiPackage(built.artifact.bytes);
          expect(imported.items.length).toStrictEqual(1);
          expect(imported.assets.length).toStrictEqual(2);
          for (const asset of imported.assets) expect(asset.data).toStrictEqual(bytes);
          expect(imported.parts[0].options?.instructionsHtml ?? '').toContain(`src="${path}"`);
          expect(imported.parts[0].options?.instructionsHtml ?? '').toContain(
            `src="${instructionPath}"`,
          );
          if (!(built.preflight._tag === 'Evaluated')) {
            expect.unreachable("Expected built.preflight._tag === 'Evaluated'");
          }
          const retained = await createMaterializedAssessmentExport({
            ...input,
            storage,
            authorizedBy: exportActorIdFromAuthenticatedUser(ctx.userId),
            approvedPreflightId: built.preflight.preflightId,
            acknowledgementToken: built.preflight.acknowledgementToken,
            createdAt: new Date('2026-10-08T12:00:00.000Z'),
          });
          if (!(retained.ok)) expect.unreachable('Expected retained.ok');
          const persisted = await persistMaterializedAssessmentExport(ctx, retained.value);
          if (!(persisted.ok)) expect.unreachable('Expected persisted.ok');
          const attemptId = crypto.randomUUID();
          await prepareDeliveryPublishAttempt(ctx, {
            assessmentId: assessment.id,
            attemptId,
            exportReceiptId: retained.value.receipt.receiptId,
            preflightId: retained.value.receipt.preflightId,
            request: {
              publishId: `qflow-${attemptId}`,
              qflowTenantId: ctx.tenantId,
              qflowAssessmentId: assessment.id,
              actorId: ctx.userId,
              issuedAt: new Date('2026-10-08T12:00:00.000Z').toISOString(),
              packageUrl:
                `https://qflow.example/package?receiptId=${retained.value.receipt.receiptId}`,
            },
          });
          const claimed = await claimDeliveryPublishAttempt(ctx, assessment.id, attemptId);
          if (!(claimed._tag === 'Claimed')) {
            expect.unreachable("Expected claimed._tag === 'Claimed'");
          }
          // Exercise local publication state only; this does not call a learner host.
          await completeDeliveryPublishAttempt(ctx, {
            assessmentId: assessment.id,
            attemptId,
            leaseToken: claimed.attempt.leaseToken,
            response: {
              publishId: `qflow-${attemptId}`,
              status: 'published',
              version: {
                assessmentId: 'local-fixture',
                assessmentVersionId: 'local-fixture-version',
              },
            },
          });
          const published = await getAssessment(ctx, assessment.id);
          if (!published) expect.unreachable('Expected published');
          expect(await readAssessmentPublicationReview(db, ctx, published, storage)).toStrictEqual({
            status: 'current',
          });
          const instructions = published.parts[0].options?.instructionsHtml;
          if (!(typeof instructions === 'string')) {
            expect.unreachable("Expected typeof instructions === 'string'");
          }
          await saveAssessmentArrangementFixture(ctx, assessment.id, [{
            ...published.parts[0],
            options: {
              ...published.parts[0].options,
              instructionsHtml: instructions.replaceAll(
                'src="/uploads/',
                'src="https://qflow.example/uploads/',
              ),
            },
          }]);
          const equivalentUrls = await getAssessment(ctx, assessment.id);
          if (!equivalentUrls) expect.unreachable('Expected equivalentUrls');
          expect(await readAssessmentPublicationReview(db, ctx, equivalentUrls, storage))
            .toStrictEqual({
              status: 'changed',
              structureChanged: false,
              added: [],
              removed: [],
              edited: [],
            });
          const revised = await saveAssessmentQuestion(ctx, assessment.id, {
            _tag: 'Revise',
            expectedParentRevision: question.value.revision,
            placementId: question.value.placementId,
            itemId: question.value.itemId,
            draft: {
              type: 'single_select',
              title: 'Renamed question',
              itemLanguage: newAuthoringItemLanguage(),
              bodyHtml:
                `<p>Choose the blue rectangle.</p><img src="${upload.url}" alt="Question blue rectangle"/>`,
              choices: [{ id: 'A', text: 'Rectangle' }, { id: 'B', text: 'Circle' }],
              correctId: 'A',
            },
          });
          if (!(revised.ok)) expect.unreachable('Expected revised.ok');
          const questionEdit = await getAssessment(ctx, assessment.id);
          if (!questionEdit) expect.unreachable('Expected questionEdit');
          expect(await readAssessmentPublicationReview(db, ctx, questionEdit, storage))
            .toStrictEqual({
              status: 'changed',
              structureChanged: true,
              added: ['Renamed question'],
              removed: ['Choose a shape'],
              edited: [],
            });
          await saveAssessmentArrangementFixture(ctx, assessment.id, [{
            ...questionEdit.parts[0],
            options: {
              ...questionEdit.parts[0].options,
              instructionsHtml: `${
                questionEdit.parts[0].options?.instructionsHtml
              }<p>Updated instructions.</p>`,
            },
          }]);
          const instructionEdit = await getAssessment(ctx, assessment.id);
          if (!instructionEdit) expect.unreachable('Expected instructionEdit');
          expect(await readAssessmentPublicationReview(db, ctx, instructionEdit, storage))
            .toStrictEqual({
              status: 'changed',
              structureChanged: true,
              added: ['Renamed question'],
              removed: ['Choose a shape'],
              edited: [],
            });
          expect(await storage.readObject(retained.value.artifact.storageKey)).toStrictEqual(
            built.artifact.bytes,
          );
          await storage.deleteObject(instructionOnly.path);
          const missing = await buildAssessmentPackage(input);
          if (missing.ok) expect.unreachable('Expected !missing.ok');
          expect(missing.body.error).toStrictEqual('PackageAssetResolutionFailed');
          expect(await getAssessment(ctx, assessment.id)).toStrictEqual(instructionEdit);
          expect(await readAssessmentPublicationReview(db, ctx, instructionEdit, storage))
            .toStrictEqual({
              status: 'unavailable',
            });
          expect(await storage.readObject(retained.value.artifact.storageKey)).toStrictEqual(
            built.artifact.bytes,
          );
        } finally {
          await deleteAssessment(ctx, assessment.id);
          await db.delete(assessmentExportReceipts).where(
            eq(assessmentExportReceipts.assessmentId, assessment.id),
          );
          for (const upload of uploads) {
            await db.delete(uploadsTable).where(eq(uploadsTable.id, upload.id));
            await storage.deleteObject(upload.path);
          }
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);
