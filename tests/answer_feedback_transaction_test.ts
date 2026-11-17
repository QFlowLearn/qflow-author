import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { uploadsTable } from '../lib/db/schema.ts';
import { createDraftSessionId } from '../lib/draft_session_id.ts';
import { projectJsonPersistenceObject } from '../lib/canonical_json.ts';
import { assetKey } from '../lib/asset_refs.ts';
import { parsePersistedDraft } from '../lib/persisted_draft.ts';
import { buildAssessmentPackage } from '../lib/export/assessment_package.ts';
import { strictAssessmentExportRequirements } from '../lib/export/assessment_export_requirements.ts';
import { parseQtiPackage } from '../lib/import/adapters/qti3/parse_package.ts';
import { prepareVerifiedImportedQuestionRevision } from '../lib/import/imported_question_revision.ts';
import {
  acceptedMigrationQuestionSnapshotHash,
  createAcceptedMigrationQuestionSnapshot,
  type MigrationItemContent,
  migrationItemContentHash,
  type MigrationItemContext,
  migrationItemContextHash,
} from '../lib/import/migration_item_content.ts';
import { createBankDraft, publishBankDraft } from '../lib/services/bank_drafts.ts';
import { deleteDraftSession, getDraftSession, updateDraftSession } from '../lib/services/drafts.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import {
  getQuestionRevision,
  saveImportedQuestionRevisionsInTransaction,
} from '../lib/services/questions.ts';
import { sha256Hex } from '../lib/sha256.ts';
import { saveUpload, type StoredUpload } from '../lib/uploads.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import type { Draft } from '../lib/types/draft.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { saveAssessmentArrangementFixture } from './helpers/assessment_arrangement.ts';
import { requireQaDatabaseUrl } from './helpers/qa_database.ts';
import { createMemoryObjectStorage } from './memory_object_storage.ts';

testCase(
  'feedback: real persistence protects owned assets, stale saves, unfinished drafts and reviewed native reimport',
  async () => {
    requireQaDatabaseUrl(process.env['DATABASE_URL']);
    const storage = createMemoryObjectStorage(), uploads: StoredUpload[] = [];
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const assessment = await createAssessmentDraft(ctx, { title: 'Feedback transaction' });
        const draftId = createDraftSessionId();
        try {
          const upload = await saveUpload(
            ctx,
            new TextEncoder().encode(
              '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="18"><rect width="32" height="18"/></svg>',
            ),
            {
              name: 'feedback.svg',
              type: 'image/svg+xml',
              storage,
              runtime: { bindings: { QFLOW_UPLOAD_BASE: '/uploads' } },
            },
          );
          uploads.push(upload);
          const initial = await getAssessment(ctx, assessment.id);
          if (!initial) expect.unreachable('Expected initial');
          const draft: Draft = {
            type: 'single_select',
            title: 'Feedback question',
            itemLanguage: newAuthoringItemLanguage(),
            bodyHtml: '<p>Choose One</p>',
            choices: [{ id: 'A', text: 'One' }, { id: 'B', text: 'Two' }],
            correctId: 'A',
            maximumScore: 0,
            answerFeedback: {
              correct: {
                text: 'Correct explanation',
                link: { url: 'https://example.org/lesson', label: 'Lesson' },
                media: {
                  kind: 'image',
                  src: upload.url,
                  alt: 'Answer diagram',
                  longDescription: 'Accessible description',
                },
              },
              incorrect: { text: 'Incorrect explanation', link: null, media: null },
            },
          };
          const created = await saveAssessmentQuestion(ctx, assessment.id, {
            _tag: 'Create',
            partId: initial.parts[0].id,
            draft,
          });
          if (!(created.ok)) expect.unreachable('Expected created.ok');
          expect((await getQuestionRevision(ctx, created.value.itemId, 1))?.body.answerFeedback)
            .toStrictEqual(draft.answerFeedback);
          const revise = (changed: Draft, parent = 1) =>
            saveAssessmentQuestion(ctx, assessment.id, {
              _tag: 'Revise',
              placementId: created.value.placementId,
              itemId: created.value.itemId,
              expectedParentRevision: parent,
              draft: { ...changed, itemId: created.value.itemId },
            });
          await withEnrichmentWorkspace(async (other) => {
            const foreign = await saveUpload(other, await storage.readObject(upload.path), {
              name: 'foreign.svg',
              type: 'image/svg+xml',
              storage,
              runtime: { bindings: { QFLOW_UPLOAD_BASE: '/uploads' } },
            });
            try {
              const rejected = await revise({
                ...draft,
                answerFeedback: {
                  correct: {
                    text: 'Attempted foreign file',
                    link: null,
                    media: { kind: 'image', src: foreign.url, alt: 'Foreign', longDescription: '' },
                  },
                  incorrect: null,
                },
              });
              if (rejected.ok) expect.unreachable('Expected !rejected.ok');
              expect(rejected.status).toStrictEqual(422);
              expect(rejected.error.error).toStrictEqual('content_asset_unavailable');
              expect(await getQuestionRevision(ctx, created.value.itemId, 2)).toStrictEqual(null);
            } finally {
              await db.delete(uploadsTable).where(eq(uploadsTable.id, foreign.id));
            }
          });
          const latest = await revise({
            ...draft,
            answerFeedback: {
              ...draft.answerFeedback!,
              incorrect: { text: 'New incorrect explanation', link: null, media: null },
            },
          });
          if (!(latest.ok)) expect.unreachable('Expected latest.ok');
          const stale = await revise({ ...draft, title: 'Stale draft remains with author' });
          if (stale.ok) expect.unreachable('Expected !stale.ok');
          expect(stale.status).toStrictEqual(409);
          const currentRevision = await getQuestionRevision(ctx, created.value.itemId, 2);
          if (!currentRevision) expect.unreachable('Expected currentRevision');
          expect(
            parsePersistedDraft(currentRevision.body, 'single_select').answerFeedback?.incorrect
              ?.text,
          ).toStrictEqual('New incorrect explanation');
          expect(await getQuestionRevision(ctx, created.value.itemId, 3)).toStrictEqual(null);

          expect(
            await createBankDraft(ctx, { id: draftId, collectionId: null, type: 'single_select' }),
          ).toStrictEqual({ ok: true, id: draftId });
          const unfinished = parsePersistedDraft({
            ...draft,
            answerFeedback: {
              correct: { text: '', link: { url: 'still typing', label: '' }, media: null },
              incorrect: null,
            },
          }, 'single_select');
          expect(await updateDraftSession(ctx, draftId, unfinished)).toStrictEqual({ ok: true });
          expect((await getDraftSession(ctx, draftId))?.draft.answerFeedback).toStrictEqual(
            unfinished.answerFeedback,
          );
          expect((await publishBankDraft(ctx, { id: draftId, draft: unfinished })).ok)
            .toStrictEqual(false);
          expect((await getDraftSession(ctx, draftId))?.draft.answerFeedback).toStrictEqual(
            unfinished.answerFeedback,
          );

          const current = await getAssessment(ctx, assessment.id);
          if (!current) expect.unreachable('Expected current');
          await saveAssessmentArrangementFixture(
            ctx,
            assessment.id,
            current.parts.map((part) => ({
              ...part,
              options: { ...part.options, answerFeedbackRelease: 'after-submit' },
            })),
          );
          const configured = await getAssessment(ctx, assessment.id);
          if (!configured) expect.unreachable('Expected configured');
          const packaged = await buildAssessmentPackage({
            assessment: configured,
            auth: ctx,
            targetId: 'qti3-conformant',
            requirements: strictAssessmentExportRequirements(),
            readUploadBytes: (file) => storage.readObject(file.path),
          });
          if (!(packaged.ok)) expect.unreachable('Expected packaged.ok');
          const parsed = await parseQtiPackage(packaged.artifact.bytes);
          expect(parsed.assets.length).toStrictEqual(1);
          const staged = new Map();
          for (const asset of parsed.assets) {
            const saved = await saveUpload(ctx, asset.data, {
              name: asset.path.split('/').at(-1)!,
              type: asset.mime!,
              storage,
              runtime: { bindings: { QFLOW_UPLOAD_BASE: '/uploads' } },
            });
            uploads.push(saved);
            staged.set(assetKey(asset.path), {
              ...saved,
              sourceSha256: await sha256Hex(asset.data),
            });
          }
          const item = parsed.items[0],
            actor = { id: ctx.userId, displayName: 'Reviewer', email: 'reviewer@example.test' },
            reviewedAt = new Date().toISOString();
          const content: MigrationItemContent = {
            sourceName: 'feedback.zip',
            title: item.title,
            itemType: item.draft.type!,
            sourceHref: item.href,
            sourceIdentifier: item.identifier,
            sourceXml: item.xml,
            importedDraft: projectJsonPersistenceObject(item.draft),
            blueprintTargetId: null,
            reviewSuggestions: [],
            warnings: [],
            assets: await Promise.all(
              parsed.assets.map(async (asset) => ({
                sourcePath: asset.path,
                name: asset.path.split('/').at(-1)!,
                mimeType: asset.mime ?? null,
                size: asset.data.length,
                sha256: await sha256Hex(asset.data),
              })),
            ),
          };
          const context: MigrationItemContext = {
            readiness: 'ready',
            sourceArtifact: {
              id: crypto.randomUUID(),
              filename: 'feedback.zip',
              mimeType: 'application/zip',
              size: packaged.artifact.bytes.length,
              sha256: await sha256Hex(packaged.artifact.bytes),
            },
            normalizedSourceSha256: await sha256Hex(new TextEncoder().encode(item.xml)),
            evidence: [],
            extractionUncertainties: [],
            review: { decision: 'accepted', note: null, reviewedBy: actor.id, reviewedAt },
          };
          const contentHash = await migrationItemContentHash(content),
            contextHash = await migrationItemContextHash(context);
          const migrationRunId = crypto.randomUUID(), migrationItemId = crypto.randomUUID();
          const acceptedSnapshot = createAcceptedMigrationQuestionSnapshot({
            contentHash,
            contextHash,
            origin: {
              _tag: 'Imported',
              artifact: context.sourceArtifact,
              migrationRunId,
              migrationItemId,
              href: item.href,
              identifier: item.identifier,
              providedBy: actor,
              assistance: {
                _tag: 'DeterministicImport',
                adapter: { id: 'qti3', label: 'QTI 3', version: '1' },
              },
              evidence: [],
              review: {
                decision: 'accepted',
                reviewer: actor,
                reviewedAt,
                note: null,
                contentHash,
                contextHash,
              },
            },
          });
          const verified = await prepareVerifiedImportedQuestionRevision({
            snapshot: {
              migrationRunId,
              migrationItemId,
              content,
              context,
              acceptedSnapshot,
              acceptedSnapshotHash: await acceptedMigrationQuestionSnapshotHash(acceptedSnapshot),
            },
            assetUploads: staged,
          });
          const [saved] = await db.transaction((tx) =>
            saveImportedQuestionRevisionsInTransaction(tx, ctx, [verified])
          );
          const imported = await getQuestionRevision(ctx, saved.questionId, 1);
          if (!imported) expect.unreachable('Expected imported');
          const importedDraft = parsePersistedDraft(imported.body, 'single_select');
          const media = importedDraft.answerFeedback?.correct?.media;
          if (!(media?.kind === 'image')) expect.unreachable("Expected media?.kind === 'image'");
          expect(media.src).toStrictEqual(uploads[1].url);
          expect(media.alt).toStrictEqual('Answer diagram');
          expect(importedDraft.answerFeedback?.incorrect?.text).toStrictEqual(
            'New incorrect explanation',
          );
          expect(imported.qtiXml.includes(uploads[1].url)).toStrictEqual(true);
          expect(imported.qtiXml.includes('../assets/')).toStrictEqual(false);
        } finally {
          await deleteDraftSession(ctx, draftId);
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
