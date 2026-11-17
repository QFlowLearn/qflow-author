import { expect, test as testCase } from 'vitest';

import { importedQuestionPlacements } from '../lib/import/types.ts';

import { eq } from 'drizzle-orm';
import { unzipSync } from 'fflate';
import { db, shutdownDb } from '../lib/db.ts';
import { uploadsTable } from '../lib/db/schema.ts';
import { assessmentQuestionPlacements } from '../lib/assessment_content.ts';
import { buildAssessmentPackage } from '../lib/export/assessment_package.ts';
import { strictAssessmentExportRequirements } from '../lib/export/assessment_export_requirements.ts';
import {
  materializeAssessmentExportArtifact,
  readMaterializedAssessmentExportArtifact,
} from '../lib/export/assessment_export_artifact.ts';
import { parseQtiPackage } from '../lib/import/adapters/qti3/parse_package.ts';
import { parsePersistedDraft } from '../lib/persisted_draft.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { getQuestionRevision } from '../lib/services/questions.ts';
import { sha256Hex } from '../lib/sha256.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { getUpload, saveUpload, type StoredUpload } from '../lib/uploads.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { requireQaDatabaseUrl } from './helpers/qa_database.ts';
import { createMemoryObjectStorage } from './memory_object_storage.ts';

testCase(
  'copied uploaded images survive real canonical packaging and leave saved artifact bytes intact',
  async () => {
    requireQaDatabaseUrl(process.env['DATABASE_URL']);
    const storage = createMemoryObjectStorage();
    const encoder = new TextEncoder(), decoder = new TextDecoder();
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const assessment = await createAssessmentDraft(ctx, { title: 'Copy package acceptance' });
        const uploads: StoredUpload[] = [];
        const imageBytes = [
          encoder.encode(
            '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="18"><rect width="32" height="18" fill="blue"/></svg>',
          ),
          encoder.encode(
            '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="red"/></svg>',
          ),
        ];
        try {
          // Real tenant-owned upload metadata, with the established object-storage seam supplied locally.
          for (const [index, data] of imageBytes.entries()) {
            uploads.push(
              await saveUpload(ctx, data, {
                name: `copy-image-${index}.svg`,
                type: 'image/svg+xml',
                storage,
                runtime: { bindings: { QFLOW_UPLOAD_BASE: '/uploads' } },
              }),
            );
          }
          const initial = await getAssessment(ctx, assessment.id);
          if (!initial) expect.unreachable('Expected initial');
          const partId = initial.parts[0].id;
          const source = await saveAssessmentQuestion(ctx, assessment.id, {
            _tag: 'Create',
            partId,
            draft: {
              type: 'single_select',
              title: 'Images with a copied question',
              itemLanguage: newAuthoringItemLanguage(),
              bodyHtml: `<p>Choose the red circle.</p><img src="${
                uploads[0].url
              }" alt="A blue rectangle"/>`,
              maximumScore: 3.125,
              shuffle: true,
              choices: [
                {
                  id: 'A',
                  html: `<p>Red circle <img src="${uploads[1].url}" alt="A red circle"/></p>`,
                  fixed: true,
                },
                { id: 'B', text: 'Blue rectangle' },
              ],
              correctId: 'A',
            },
          });
          if (!(source.ok)) expect.unreachable(source.ok ? '' : source.error.message);
          const original = await getQuestionRevision(ctx, source.value.itemId, 1);
          if (!original) expect.unreachable('Expected original');
          const exportCurrent = async () => {
            const current = await getAssessment(ctx, assessment.id);
            if (!current) expect.unreachable('Expected current');
            const result = await buildAssessmentPackage({
              assessment: current,
              auth: ctx,
              targetId: 'qti3-conformant',
              requirements: strictAssessmentExportRequirements(),
              readUploadBytes: (upload) => storage.readObject(upload.path),
            });
            if (!(result.ok)) expect.unreachable(result.ok ? '' : result.body.error);
            expect(result.receipt.artifact.sha256).toStrictEqual(
              await sha256Hex(result.artifact.bytes),
            );
            return result;
          };
          const before = await exportCurrent();
          const frozen = await materializeAssessmentExportArtifact(storage, {
            tenantId: ctx.tenantId,
            assessmentId: assessment.id,
            ...before.artifact,
            expectedSha256: before.receipt.artifact.sha256,
          });
          if (!(frozen.ok)) expect.unreachable('Expected frozen.ok');
          const copied = await saveAssessmentQuestion(ctx, assessment.id, {
            _tag: 'Variant',
            requestId: crypto.randomUUID(),
            partId,
            sourcePlacementId: source.value.placementId,
            sourceItemId: source.value.itemId,
            sourceRevision: 1,
            targetType: 'single_select',
          });
          if (!(copied.ok)) expect.unreachable(copied.ok ? '' : copied.error.message);
          if (!(copied.value.itemId !== source.value.itemId)) {
            expect.unreachable('Expected copied.value.itemId !== source.value.itemId');
          }
          const copyRevision = await getQuestionRevision(ctx, copied.value.itemId, 1);
          if (!copyRevision) expect.unreachable('Expected copyRevision');
          expect(copyRevision.body).toStrictEqual({ ...original.body, preserveSourceXml: false });
          expect(await getQuestionRevision(ctx, source.value.itemId, 1)).toStrictEqual(original);
          const withCopy = await getAssessment(ctx, assessment.id);
          if (!withCopy) expect.unreachable('Expected withCopy');
          expect(
            assessmentQuestionPlacements(withCopy.parts[0].placements).map((placement) =>
              placement.id
            ),
          ).toStrictEqual([source.value.placementId, copied.value.placementId]);
          expect(withCopy.targetCount).toStrictEqual(2);
          const packaged = await exportCurrent();
          const parsed = await parseQtiPackage(packaged.artifact.bytes);
          expect(parsed.items.length).toStrictEqual(2);
          expect(parsed.assets.length).toStrictEqual(2);
          expect(
            importedQuestionPlacements(parsed.parts[0].placements).map((placement) =>
              placement.href
            ),
          ).toStrictEqual(parsed.items.map((item) => item.href));
          const entries = unzipSync(packaged.artifact.bytes);
          const manifest = decoder.decode(entries['imsmanifest.xml']);
          expect((manifest.match(/<resource[^>]+type="webcontent"/g) ?? []).length).toStrictEqual(
            2,
          );
          // Shared referenced uploads are packaged once, with dependencies from both independent items.
          expect((manifest.match(/<dependency identifierref="asset-/g) ?? []).length).toStrictEqual(
            4,
          );
          for (const [index, upload] of uploads.entries()) {
            const path = `assets/${upload.id}-${upload.name}`;
            expect(entries[path]).toStrictEqual(imageBytes[index]);
            const asset = parsed.assets.find((entry) => entry.path === path);
            if (!asset) expect.unreachable('Expected asset');
            expect(asset.data).toStrictEqual(imageBytes[index]);
            expect(asset.mime).toStrictEqual('image/svg+xml');
            for (const item of parsed.items) expect(item.xml).toContain(`../${path}`);
          }
          for (const item of parsed.items) {
            expect(item.draft.type).toStrictEqual('single_select');
            expect(item.draft.maximumScore).toStrictEqual(3.125);
            expect(item.draft.correctId).toStrictEqual('A');
            expect(item.draft.choices?.map((choice) => choice.id)).toStrictEqual(['A', 'B']);
            expect(item.draft.choices?.[0].fixed).toStrictEqual(true);
            expect(item.xml).toContain('alt="A blue rectangle"');
            expect(item.xml).toContain('alt="A red circle"');
            if (item.xml.includes('/uploads/')) {
              expect.unreachable("Expected !item.xml.includes('/uploads/')");
            }
          }
          // Edit only the independent copy through the canonical revision path after saving the old artifact.
          const parsedCopy = parsePersistedDraft(copyRevision.body, 'single_select');
          const revised = await saveAssessmentQuestion(ctx, assessment.id, {
            _tag: 'Revise',
            expectedParentRevision: copied.value.revision,
            placementId: copied.value.placementId,
            itemId: copied.value.itemId,
            draft: {
              ...parsedCopy,
              title: 'Edited independent copy',
              bodyHtml: '<p>New plain prompt.</p>',
              choices: [{ id: 'A', text: 'Red circle' }, { id: 'B', text: 'Blue rectangle' }],
              correctId: 'B',
            },
          });
          if (!(revised.ok)) expect.unreachable(revised.ok ? '' : revised.error.message);
          expect(revised.value.revision).toStrictEqual(2);
          expect(await getQuestionRevision(ctx, source.value.itemId, 1)).toStrictEqual(original);
          expect(await getQuestionRevision(ctx, copied.value.itemId, 1)).toStrictEqual(
            copyRevision,
          );
          for (const [index, upload] of uploads.entries()) {
            const metadata = await getUpload(ctx, upload.id);
            if (!(metadata.status === 'ok')) {
              expect.unreachable("Expected metadata.status === 'ok'");
            }
            expect(metadata.upload).toStrictEqual(upload);
            expect(await storage.readObject(upload.path)).toStrictEqual(imageBytes[index]);
          }
          const recovered = await readMaterializedAssessmentExportArtifact(storage, frozen.value);
          if (!(recovered.ok)) expect.unreachable('Expected recovered.ok');
          expect(recovered.value).toStrictEqual(before.artifact.bytes);
          expect(await sha256Hex(recovered.value)).toStrictEqual(before.receipt.artifact.sha256);
          const originalPackage = await parseQtiPackage(recovered.value);
          expect(originalPackage.items.length).toStrictEqual(1);
          expect(originalPackage.assets.length).toStrictEqual(2);
          expect(originalPackage.items[0].xml).toContain('Choose the red circle.');
          expect(originalPackage.items[0].draft.correctId).toStrictEqual('A');
          expect(originalPackage.items[0].draft.maximumScore).toStrictEqual(3.125);
          const afterRevision = await exportCurrent();
          if (
            !((await sha256Hex(afterRevision.artifact.bytes)) !== before.receipt.artifact.sha256)
          ) {
            expect.unreachable(
              'Expected (await sha256Hex(afterRevision.artifact.bytes)) !== before.receipt.artifact.sha256',
            );
          }
          // A missing live upload is an explicit failure, never an empty or silently flattened package.
          const unchanged = await getAssessment(ctx, assessment.id);
          if (!unchanged) expect.unreachable('Expected unchanged');
          await storage.deleteObject(uploads[0].path);
          const missingAsset = await buildAssessmentPackage({
            assessment: unchanged,
            auth: ctx,
            targetId: 'qti3-conformant',
            requirements: strictAssessmentExportRequirements(),
            readUploadBytes: (upload) => storage.readObject(upload.path),
          });
          if (missingAsset.ok) expect.unreachable('Expected !missingAsset.ok');
          expect(missingAsset.status).toStrictEqual(422);
          expect(missingAsset.body.error).toStrictEqual('PackageAssetResolutionFailed');
          expect(await getAssessment(ctx, assessment.id)).toStrictEqual(unchanged);
          expect(await getQuestionRevision(ctx, source.value.itemId, 1)).toStrictEqual(original);
          const stillFrozen = await readMaterializedAssessmentExportArtifact(storage, frozen.value);
          if (!(stillFrozen.ok)) expect.unreachable('Expected stillFrozen.ok');
          expect(stillFrozen.value).toStrictEqual(before.artifact.bytes);
          console.log(JSON.stringify({
            outcome: 'copy-media-package-and-saved-artifact-preserved',
            sharedVersion: '0.13.4',
            originalPackageSha256: before.receipt.artifact.sha256,
            copiedPackageSha256: packaged.receipt.artifact.sha256,
            revisedPackageSha256: afterRevision.receipt.artifact.sha256,
            assets: await Promise.all(imageBytes.map(sha256Hex)),
          }));
        } finally {
          await deleteAssessment(ctx, assessment.id);
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
