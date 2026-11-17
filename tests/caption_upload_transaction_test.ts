import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';
import { unzipSync } from 'fflate';
import { db, shutdownDb } from '../lib/db.ts';
import { uploadsTable } from '../lib/db/schema.ts';
import { buildAssessmentPackage } from '../lib/export/assessment_package.ts';
import { strictAssessmentExportRequirements } from '../lib/export/assessment_export_requirements.ts';
import { parseQtiPackage } from '../lib/import/adapters/qti3/parse_package.ts';
import { parseUploadApiError } from '../lib/http/upload_api_contract.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { UPLOAD_POLICIES } from '../lib/upload_policy.ts';
import { getUpload, type StoredUpload } from '../lib/uploads.ts';
import { uploadBankRoute as uploadHandlerEndpoint } from '../lib/http/routes/bank_api/upload.ts';
import { uploadContentBankRoute as downloadHandlerEndpoint } from '../lib/http/routes/bank_api/upload_content.ts';
import { saveAssessmentArrangementFixture } from './helpers/assessment_arrangement.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { requireQaDatabaseUrl } from './helpers/qa_database.ts';
import { createMemoryObjectStorage } from './memory_object_storage.ts';
import {
  type HttpEndpoint,
  invokeHttpMethod,
  invokeHttpRoute,
  makeHttpRequest,
} from './helpers/http_route.ts';

const uploadHandler = uploadHandlerEndpoint.handle;
const downloadHandler = downloadHandlerEndpoint.handle;

testCase(
  'caption upload HTTP boundary preserves owned WebVTT through download and native packages',
  async () => {
    requireQaDatabaseUrl(process.env['DATABASE_URL']);
    const storage = createMemoryObjectStorage();
    const bytes = new TextEncoder().encode(
      '\uFEFFWEBVTT Lecture\r\n\r\n00:00.000 --> 00:01.500\r\n<v Speaker>Olá, 你好 👋</v>\r\n',
    );
    try {
      await withEnrichmentWorkspace(async (auth) => {
        const assessment = await createAssessmentDraft(auth, {
          title: 'Caption package acceptance',
        });
        try {
          const post = (file: File) => {
            const form = new FormData();
            form.set('file', file);
            return invokeHttpRoute(
              uploadHandler,
              makeHttpRequest(
                new Request('http://local/api/uploads', {
                  ...{ duplex: 'half' },
                  method: 'POST',
                  body: form,
                }),
                {
                  auth,
                  state: { storage, runtime: { bindings: { QFLOW_UPLOAD_BASE: '/uploads' } } },
                },
              ),
            );
          };
          const created = await post(new File([bytes], 'lecture.vtt', { type: 'text/plain' }));
          expect(created.status).toStrictEqual(201);
          const payload: unknown = await created.json();
          if (
            !(payload && typeof payload === 'object' && 'id' in payload &&
              typeof payload.id === 'string')
          ) {
            expect.unreachable(
              "Expected payload && typeof payload === 'object' && 'id' in payload && typeof payload.id === 'string",
            );
          }
          const lookup = await getUpload(auth, payload.id);
          if (!(lookup.status === 'ok')) expect.unreachable("Expected lookup.status === 'ok'");
          const upload = lookup.upload;
          expect(payload).toStrictEqual({
            id: upload.id,
            name: 'lecture.vtt',
            type: 'text/vtt',
            size: bytes.length,
            url: `/uploads/${upload.id}`,
            createdAt: upload.createdAt,
          });
          expect(await storage.readObject(upload.path)).toStrictEqual(bytes);
          const download = (ctx: typeof auth) =>
            invokeHttpMethod(
              // SAFETY: this route declares a GET method map; Fresh's definition retains a handler union.
              downloadHandler as HttpEndpoint,
              'GET',
              makeHttpRequest(
                new Request(`http://local${upload.url}`),
                { params: { id: upload.id }, auth: ctx, state: { storage } },
              ),
            );
          const response = await download(auth);
          expect(response.status).toStrictEqual(200);
          expect(response.headers.get('content-type')).toStrictEqual('text/vtt');
          expect(response.headers.get('content-length')).toStrictEqual(String(bytes.length));
          expect(response.headers.get('cache-control') ?? '').toContain('private, no-store');
          expect(new Uint8Array(await response.arrayBuffer())).toStrictEqual(bytes);
          await withEnrichmentWorkspace(async (other) => {
            expect((await download(other)).status).toStrictEqual(403);
            expect((await getUpload(other, upload.id)).status).toStrictEqual('forbidden');
          });

          const before = await db.select().from(uploadsTable).where(
            eq(uploadsTable.tenantId, auth.tenantId),
          );
          const oversized = new Uint8Array(UPLOAD_POLICIES.captions.maxBytes + 1).fill(32);
          oversized.set(new TextEncoder().encode('WEBVTT\n\n'));
          for (
            const [file, status, error] of [
              [new File([oversized], 'too-large.vtt'), 400, {
                error: true,
                code: 'kind_too_large',
                params: { kind: 'captions', maxMebibytes: 1 },
              }],
              [new File(['WEBVTT\r\n'], 'bad.vtt', { type: 'text/vtt' }), 415, {
                error: true,
                code: 'content_unsupported',
              }],
              [new File([bytes], 'spoof.mp4', { type: 'video/mp4' }), 415, {
                error: true,
                code: 'content_type_mismatch',
              }],
            ] as const
          ) {
            const rejected = await post(file);
            expect(rejected.status).toStrictEqual(status);
            expect(parseUploadApiError(await rejected.json())).toStrictEqual(error);
            expect(
              await db.select().from(uploadsTable).where(eq(uploadsTable.tenantId, auth.tenantId)),
            ).toStrictEqual(before);
            expect(await storage.readObject(upload.path)).toStrictEqual(bytes);
          }

          const initial = await getAssessment(auth, assessment.id);
          if (!initial) expect.unreachable('Expected initial');
          const saved = await saveAssessmentQuestion(auth, assessment.id, {
            _tag: 'Create',
            partId: initial.parts[0].id,
            draft: {
              type: 'single_select',
              title: 'Read the lecture captions',
              itemLanguage: newAuthoringItemLanguage(),
              bodyHtml: '<p>Which greeting appears?</p>',
              choices: [{ id: 'A', text: 'Olá' }, { id: 'B', text: 'Goodbye' }],
              correctId: 'A',
            },
          });
          if (!(saved.ok)) expect.unreachable('Expected saved.ok');
          const current = await getAssessment(auth, assessment.id);
          if (!current) expect.unreachable('Expected current');
          await saveAssessmentArrangementFixture(auth, assessment.id, [{
            ...current.parts[0],
            options: {
              instructionsHtml: `<p><a href="${upload.url}">Download lecture captions</a></p>`,
            },
          }]);
          const arranged = await getAssessment(auth, assessment.id);
          if (!arranged) expect.unreachable('Expected arranged');
          const built = await buildAssessmentPackage({
            assessment: arranged,
            auth,
            targetId: 'qti3-conformant',
            requirements: strictAssessmentExportRequirements(),
            readUploadBytes: (asset: StoredUpload) => storage.readObject(asset.path),
          });
          if (!(built.ok)) expect.unreachable(built.ok ? '' : built.body.error);
          const entries = unzipSync(built.artifact.bytes);
          const assetPath = `assets/${upload.id}-lecture.vtt`;
          expect(entries[assetPath]).toStrictEqual(bytes);
          expect(new TextDecoder().decode(entries['assessment.xml'])).toContain(
            `href="${assetPath}"`,
          );
          expect(new TextDecoder().decode(entries['imsmanifest.xml'])).toContain(
            'identifierref="asset-1"',
          );
          const imported = await parseQtiPackage(built.artifact.bytes);
          expect(imported.assets.length).toStrictEqual(1);
          expect(imported.assets[0].data).toStrictEqual(bytes);
          expect(imported.assets[0].mime).toStrictEqual('text/vtt');
          expect(imported.parts[0].options?.instructionsHtml ?? '').toContain(
            `href="${assetPath}"`,
          );
        } finally {
          await deleteAssessment(auth, assessment.id);
          const uploads = await db.select().from(uploadsTable).where(
            eq(uploadsTable.tenantId, auth.tenantId),
          );
          await db.delete(uploadsTable).where(eq(uploadsTable.tenantId, auth.tenantId));
          for (const upload of uploads) await storage.deleteObject(upload.path);
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);
