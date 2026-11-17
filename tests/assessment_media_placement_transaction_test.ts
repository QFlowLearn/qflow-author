import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';
import { unzipSync } from 'fflate';
import { db, shutdownDb } from '../lib/db.ts';
import { uploadsTable } from '../lib/db/schema.ts';
import type { AssessmentStandaloneContent } from '../lib/assessment_standalone_content.ts';
import { assessmentQuestionPlacements } from '../lib/assessment_content.ts';
import { buildAssessmentPackage } from '../lib/export/assessment_package.ts';
import {
  acceptDiagnosedAssessmentExportFallbacks,
  acceptManualAssessmentExportScoring,
  exportActorIdFromAuthenticatedUser,
  strictAssessmentExportRequirements,
} from '../lib/export/assessment_export_requirements.ts';
import { listSelectableAssessmentExportTargets } from '../lib/export/assessment_export_targets.ts';
import {
  materializeAssessmentExportArtifact,
  readMaterializedAssessmentExportArtifact,
} from '../lib/export/assessment_export_artifact.ts';
import { parseQtiPackage } from '../lib/import/adapters/qti3/parse_package.ts';
import {
  collectReferencedPackageAssetKeys,
  rewriteImportedStandaloneContent,
} from '../lib/import/package_asset_references.ts';
import { assetKey } from '../lib/asset_refs.ts';
import { AssessmentQuestionOrderPreviews } from '../lib/services/assessment_question_order_preview.ts';
import { saveAssessmentParts } from '../lib/services/assessment_arrangement_save.ts';
import { duplicateAssessment, getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { getUpload, saveUpload, type StoredUpload } from '../lib/uploads.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { assessmentArrangementCommandFixture } from './helpers/assessment_arrangement.ts';
import { requireQaDatabaseUrl } from './helpers/qa_database.ts';
import { createMemoryObjectStorage } from './memory_object_storage.ts';

testCase(
  'owned unscored media retains files, descriptions, mixed order and immutable packages without adding questions',
  async () => {
    requireQaDatabaseUrl(process.env['DATABASE_URL']);
    const storage = createMemoryObjectStorage();
    const encoder = new TextEncoder();
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const assessment = await createAssessmentDraft(ctx, { title: 'Unscored media' });
        const uploads: StoredUpload[] = [];
        let copyId: string | undefined;
        try {
          for (
            const file of [
              {
                name: 'rectangle.svg',
                type: 'image/svg+xml',
                data: encoder.encode(
                  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="18"><rect width="32" height="18" fill="blue"/></svg>',
                ),
              },
              // Persistence/package proof only; browser acceptance supplies a decodable video.
              {
                name: 'instructions.webm',
                type: 'video/webm',
                data: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]),
              },
              {
                name: 'captions.vtt',
                type: 'text/vtt',
                data: encoder.encode(
                  'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nA blue rectangle.\n',
                ),
              },
            ]
          ) {
            uploads.push(
              await saveUpload(ctx, file.data, {
                ...file,
                storage,
                runtime: { bindings: { QFLOW_UPLOAD_BASE: '/uploads' } },
              }),
            );
          }
          const initial = await getAssessment(ctx, assessment.id);
          if (!initial) expect.unreachable('Expected initial');
          for (const title of ['First', 'Second']) {
            if (
              !((await saveAssessmentQuestion(ctx, assessment.id, {
                _tag: 'Create',
                partId: initial.parts[0].id,
                draft: {
                  type: 'single_select',
                  title,
                  itemLanguage: newAuthoringItemLanguage(),
                  bodyHtml: '<p>Choose.</p>',
                  maximumScore: 1,
                  choices: [{ id: 'A', text: 'One' }, { id: 'B', text: 'Two' }],
                  correctId: 'A',
                },
              })).ok)
            ) {
              expect.unreachable(
                "Expected (await saveAssessmentQuestion(ctx, assessment.id, { _tag: 'Create', partId: initial.parts[",
              );
            }
          }
          const saved = await getAssessment(ctx, assessment.id);
          if (!saved) expect.unreachable('Expected saved');
          const [first, second] = assessmentQuestionPlacements(saved.parts[0].placements);
          const contents: AssessmentStandaloneContent[] = [
            {
              kind: 'image',
              src: uploads[0].url,
              alt: 'Blue rectangle',
              longDescription:
                '  A literal <script> description.\r\nBlue is the relevant colour.  ',
            },
            {
              kind: 'video',
              src: uploads[1].url,
              mimeType: 'video/webm',
              title: 'Instructions video',
              captionSrc: uploads[2].url,
              captionLanguage: 'en-GB',
              transcript: '  A blue rectangle.\nRead this without playing the video.  ',
            },
            {
              kind: 'video-link',
              url: 'https://www.youtube.com/watch?v=example',
              title: 'Online instructions',
              transcript: 'Equivalent instructions in text.',
              networkNotice: 'Opens YouTube. Internet access is required.',
            },
          ];
          const placements = contents.map((content) => ({
            id: crypto.randomUUID(),
            content,
            fixed: true as const,
          }));
          const parts = [{ ...saved.parts[0], placements: [first, ...placements, second] }];
          const command = await assessmentArrangementCommandFixture(ctx, assessment.id, parts);
          const inserted = await saveAssessmentParts(ctx, assessment.id, command);
          if (!(inserted.ok)) expect.unreachable(inserted.ok ? '' : inserted.error.message);
          if (!((await saveAssessmentParts(ctx, assessment.id, command)).ok)) {
            expect.unreachable(
              'Expected (await saveAssessmentParts(ctx, assessment.id, command)).ok',
            );
          }
          const mixed = await getAssessment(ctx, assessment.id);
          if (!mixed) expect.unreachable('Expected mixed');
          expect(mixed.parts).toStrictEqual(parts);
          expect(mixed.targetCount).toStrictEqual(2);
          const preview = await new AssessmentQuestionOrderPreviews(db).preview(
            ctx,
            assessment.id,
            inserted.version,
            { seed: 1 },
          );
          if (!(preview.ok)) expect.unreachable('Expected preview.ok');
          expect(preview.value.parts[0].questions.length).toStrictEqual(2);
          expect(preview.value.parts[0].instructions.map((
            entry,
          ) => [entry.beforeQuestionNumber, entry.content])).toStrictEqual(
            contents.map((content) => [2, content]),
          );
          const packaged = await buildAssessmentPackage({
            assessment: mixed,
            auth: ctx,
            targetId: 'qti3-conformant',
            requirements: strictAssessmentExportRequirements(),
            readUploadBytes: (upload) => storage.readObject(upload.path),
          });
          if (!(packaged.ok)) expect.unreachable(packaged.ok ? '' : packaged.body.message);
          const entries = unzipSync(packaged.artifact.bytes);
          expect(Object.keys(entries).filter((key) => key.startsWith('items/')).length)
            .toStrictEqual(2);
          expect(Object.keys(entries).filter((key) => key.startsWith('assets/')).length)
            .toStrictEqual(3);
          const xml = new TextDecoder().decode(entries['assessment.xml']);
          expect(xml).toContain('srclang="en-GB"');
          expect(xml).toContain('controls="controls"');
          expect(xml).toContain('alt="Blue rectangle"');
          const parsed = await parseQtiPackage(packaged.artifact.bytes);
          expect(parsed.items.length).toStrictEqual(2);
          expect(parsed.assets.length).toStrictEqual(3);
          const assetLookup = new Map(parsed.assets.map((asset) => [assetKey(asset.path), asset]));
          expect(collectReferencedPackageAssetKeys(parsed, assetLookup).size).toStrictEqual(3);
          const imported = parsed.parts[0].placements.filter((placement) => 'content' in placement);
          expect(imported.length).toStrictEqual(3);
          const replacementUrls = new Map(parsed.assets.map((asset) => {
            const upload = uploads.find((upload) => asset.name.endsWith(upload.name));
            if (!upload) expect.unreachable(asset.name);
            return [assetKey(asset.path), { url: upload.url }];
          }));
          expect(
            imported.map((placement) =>
              rewriteImportedStandaloneContent(placement.content, replacementUrls)
            ),
          ).toStrictEqual(contents);
          const frozen = await materializeAssessmentExportArtifact(storage, {
            tenantId: ctx.tenantId,
            assessmentId: assessment.id,
            ...packaged.artifact,
            expectedSha256: packaged.receipt.artifact.sha256,
          });
          if (!(frozen.ok)) expect.unreachable('Expected frozen.ok');
          for (const target of listSelectableAssessmentExportTargets()) {
            if (target.id === 'qti3-conformant') continue;
            const derivative = await buildAssessmentPackage({
              assessment: mixed,
              auth: ctx,
              targetId: target.id,
              requirements: acceptManualAssessmentExportScoring(
                acceptDiagnosedAssessmentExportFallbacks(
                  strictAssessmentExportRequirements(),
                  exportActorIdFromAuthenticatedUser(ctx.userId),
                ),
                exportActorIdFromAuthenticatedUser(ctx.userId),
              ),
              readUploadBytes: (upload) => storage.readObject(upload.path),
            });
            if (!(derivative.ok)) {
              expect.unreachable(derivative.ok ? '' : `${target.id}: ${derivative.body.message}`);
            }
            expect(derivative.preflight.items.length).toStrictEqual(2);
            expect(
              derivative.receipt.packageDiagnosticCodes.filter((code) =>
                code.startsWith('qflow.export.standalone_')
              ).sort(),
            ).toStrictEqual([
              'qflow.export.standalone_image_omitted',
              'qflow.export.standalone_video_link_omitted',
              'qflow.export.standalone_video_omitted',
            ].sort());
            expect(
              derivative.preflight.overallOutcome,
              JSON.stringify({
                target: target.id,
                codes: derivative.preflight.warningCodes,
                items: derivative.preflight.items,
                repairs: derivative.preflight.repairs,
              }),
            ).toStrictEqual('warning');
            if (!(derivative.preflight.acknowledgementToken)) {
              expect.unreachable('Expected derivative.preflight.acknowledgementToken');
            }
            const bytes = target.artifact.mediaType === 'application/zip'
              ? Object.entries(unzipSync(derivative.artifact.bytes)).filter(([path]) =>
                /\.(xml|html)$/.test(path)
              ).map(([, data]) => new TextDecoder().decode(data)).join('\n')
              : new TextDecoder().decode(derivative.artifact.bytes);
            if (bytes.includes('Read this without playing the video.')) {
              expect.unreachable(target.id);
            }
            expect((await getAssessment(ctx, assessment.id))?.parts).toStrictEqual(mixed.parts);
          }
          const copy = await duplicateAssessment(ctx, assessment.id);
          if (!(copy._tag === 'Duplicated')) {
            expect.unreachable("Expected copy._tag === 'Duplicated'");
          }
          copyId = copy.id;
          const copied = await getAssessment(ctx, copyId);
          if (!copied) expect.unreachable('Expected copied');
          const copiedContent = copied.parts[0].placements.filter((placement) =>
            'content' in placement
          );
          expect(copiedContent.map((placement) => placement.content)).toStrictEqual(contents);
          expect(copiedContent[0].id).not.toStrictEqual(placements[0].id);
          if (
            !((await saveAssessmentParts(
              ctx,
              assessment.id,
              await assessmentArrangementCommandFixture(ctx, assessment.id, [{
                ...mixed.parts[0],
                placements: [first, second],
              }]),
            )).ok)
          ) {
            expect.unreachable(
              'Expected (await saveAssessmentParts( ctx, assessment.id, await assessmentArrangementCommandFixture(',
            );
          }
          for (const upload of uploads) {
            expect((await getUpload(ctx, upload.id)).status).toStrictEqual('ok');
          }
          const frozenBytes = await readMaterializedAssessmentExportArtifact(storage, frozen.value);
          if (!(frozenBytes.ok)) expect.unreachable('Expected frozenBytes.ok');
          expect(frozenBytes.value).toStrictEqual(packaged.artifact.bytes);
          const copyPackage = await buildAssessmentPackage({
            assessment: copied,
            auth: ctx,
            targetId: 'qti3-conformant',
            requirements: strictAssessmentExportRequirements(),
            readUploadBytes: (upload) => storage.readObject(upload.path),
          });
          if (!(copyPackage.ok)) expect.unreachable('Expected copyPackage.ok');
          await storage.deleteObject(uploads[0].path);
          const missing = await buildAssessmentPackage({
            assessment: copied,
            auth: ctx,
            targetId: 'qti3-conformant',
            requirements: strictAssessmentExportRequirements(),
            readUploadBytes: (upload) => storage.readObject(upload.path),
          });
          if (missing.ok) expect.unreachable('Expected !missing.ok');
          expect(missing.body.error).toStrictEqual('PackageAssetResolutionFailed');
          expect((await getAssessment(ctx, copyId))?.parts).toStrictEqual(copied.parts);
        } finally {
          if (copyId) await deleteAssessment(ctx, copyId);
          await deleteAssessment(ctx, assessment.id);
          for (const upload of uploads) {
            await db.delete(uploadsTable).where(eq(uploadsTable.id, upload.id));
          }
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);

testCase(
  'media saves reject unowned, spoofed and wrongly typed files without changing the assessment',
  async () => {
    requireQaDatabaseUrl(process.env['DATABASE_URL']);
    const storage = createMemoryObjectStorage();
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const assessment = await createAssessmentDraft(ctx, { title: 'File ownership' });
        const upload = await saveUpload(ctx, new TextEncoder().encode('WEBVTT\n'), {
          name: 'captions.vtt',
          type: 'text/vtt',
          storage,
          runtime: { bindings: { QFLOW_UPLOAD_BASE: '/uploads' } },
        });
        try {
          const initial = await getAssessment(ctx, assessment.id);
          if (!initial) expect.unreachable('Expected initial');
          await withEnrichmentWorkspace(async (other) => {
            const foreign = await saveUpload(
              other,
              new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
              {
                name: 'foreign.svg',
                type: 'image/svg+xml',
                storage,
                runtime: { bindings: { QFLOW_UPLOAD_BASE: '/uploads' } },
              },
            );
            try {
              const result = await saveAssessmentParts(
                ctx,
                assessment.id,
                await assessmentArrangementCommandFixture(ctx, assessment.id, [{
                  ...initial.parts[0],
                  placements: [{
                    id: crypto.randomUUID(),
                    content: {
                      kind: 'image',
                      src: foreign.url,
                      alt: 'Description',
                      longDescription: '',
                    },
                    fixed: true,
                  }],
                }]),
              );
              if (result.ok) expect.unreachable('Expected !result.ok');
              expect(result.error.code).toStrictEqual('content_asset_unavailable');
              expect((await getAssessment(ctx, assessment.id))?.parts).toStrictEqual(initial.parts);
            } finally {
              await db.delete(uploadsTable).where(eq(uploadsTable.id, foreign.id));
            }
          });
          for (
            const src of [
              upload.url,
              `https://wrong.example${upload.url}`,
              `/uploads/${crypto.randomUUID()}`,
            ]
          ) {
            const result = await saveAssessmentParts(
              ctx,
              assessment.id,
              await assessmentArrangementCommandFixture(ctx, assessment.id, [{
                ...initial.parts[0],
                placements: [{
                  id: crypto.randomUUID(),
                  content: { kind: 'image', src, alt: 'Description', longDescription: '' },
                  fixed: true,
                }],
              }]),
            );
            if (result.ok) expect.unreachable('Expected !result.ok');
            expect(result.error.code).toStrictEqual('content_asset_unavailable');
            expect((await getAssessment(ctx, assessment.id))?.parts).toStrictEqual(initial.parts);
          }
        } finally {
          await deleteAssessment(ctx, assessment.id);
          await db.delete(uploadsTable).where(eq(uploadsTable.id, upload.id));
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);
