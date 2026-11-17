import { expect, test as testCase } from 'vitest';

import { shutdownDb } from '../lib/db.ts';
import { listSelectableAssessmentExportTargets } from '../lib/export/assessment_export_targets.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { getQuestionRevision } from '../lib/services/questions.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { ZipArchive } from '../lib/zip_archive.ts';
import { validateApiRoute as validateEndpoint } from '../lib/http/routes/assessment_api/validate.ts';
import { packageApiRoute as packageRouteEndpoint } from '../lib/http/routes/assessment_api/package.ts';
import { receiptApiRoute as receiptRouteEndpoint } from '../lib/http/routes/assessment_api/receipt.ts';
import { saveAssessmentArrangementFixture } from './helpers/assessment_arrangement.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { assertQuestionOnlyAssessmentFixture } from './helpers/question_only_assessment.ts';
import { createMemoryObjectStorage } from './memory_object_storage.ts';
import { invokeHttpRoute, makeHttpRequest } from './helpers/http_route.ts';

const validate = validateEndpoint.handle;
const packageRoute = packageRouteEndpoint.handle;
const receiptRoute = receiptRouteEndpoint.handle;

testCase(
  'saved part settings produce exact profile losses in durable export receipts without changing source',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const assessment = await createAssessmentDraft(ctx, {
          title: 'Settings receipt acceptance',
        });
        try {
          const initial = await getAssessment(ctx, assessment.id);
          assertQuestionOnlyAssessmentFixture(initial);
          const revisions = [];
          for (const title of ['First settings question', 'Second settings question']) {
            const saved = await saveAssessmentQuestion(ctx, assessment.id, {
              _tag: 'Create',
              partId: initial.parts[0].id,
              draft: {
                type: 'single_select',
                itemLanguage: newAuthoringItemLanguage(),
                title,
                bodyHtml: `<p>${title}: Choose Alpha.</p>`,
                choices: [{ id: 'A', text: 'Alpha' }, { id: 'B', text: 'Beta' }],
                correctId: 'A',
              },
            });
            if (!(saved.ok)) expect.unreachable('Expected saved.ok');
            const revision = await getQuestionRevision(
              ctx,
              saved.value.itemId,
              saved.value.revision,
            );
            if (!revision) expect.unreachable('Expected revision');
            revisions.push(revision);
          }
          const populated = await getAssessment(ctx, assessment.id);
          assertQuestionOnlyAssessmentFixture(populated);
          await saveAssessmentArrangementFixture(ctx, assessment.id, [{
            ...populated.parts[0],
            placements: [populated.parts[0].placements[0]],
            options: {
              navigationMode: 'linear',
              submissionMode: 'simultaneous',
              timeLimits: { minTime: 60, maxTime: 300 },
              instructionsHtml: '<p>Read every question before submitting.</p>',
              feedback: [{
                id: crypto.randomUUID(),
                access: 'atEnd',
                showHide: 'show',
                outcomeIdentifier: 'TEST_FEEDBACK',
                html: '<p>Review after finishing.</p>',
              }],
            },
          }, {
            id: crypto.randomUUID(),
            title: 'Second part',
            placements: [populated.parts[0].placements[1]],
            options: {},
          }]);
          const source = await getAssessment(ctx, assessment.id);
          const storage = createMemoryObjectStorage();
          for (const target of listSelectableAssessmentExportTargets()) {
            const native = target.id === 'qti3-conformant';
            const retainsLimits = [
              'qti21-standard',
              'qti22-standard',
              'blackboard-question-banks',
              'brightspace-course-import',
            ].includes(target.id);
            const expectedCodes = native ? [] : [
              'qflow.export.part_feedback_omitted',
              'qflow.export.part_instructions_omitted',
              ...(retainsLimits ? [] : [
                'qflow.export.part_navigation_omitted',
                'qflow.export.part_structure_omitted',
                'qflow.export.part_submission_omitted',
                'qflow.export.part_time_limits_omitted',
              ]),
            ].sort();
            const url = new URL(`http://local/api/assessments/${assessment.id}/validate`);
            url.searchParams.set('target', target.id);
            // Blackboard intentionally emits a manually scored bank; accept that explicit policy.
            url.searchParams.set(
              'scoring',
              target.id === 'blackboard-question-banks' ? 'manual-accepted' : 'automatic',
            );
            url.searchParams.set('interaction', 'preserve');
            const invoke = (handler: typeof validate, request: Request) =>
              invokeHttpRoute(
                handler,
                makeHttpRequest(request, {
                  params: { id: assessment.id },
                  auth: ctx,
                  state: { storage },
                }),
              );
            const checked = await invoke(validate, new Request(url));
            expect(checked.status, target.id).toStrictEqual(200);
            const body: unknown = await checked.json();
            if (!(body && typeof body === 'object' && 'preflight' in body)) {
              expect.unreachable(
                "Expected body && typeof body === 'object' && 'preflight' in body",
              );
            }
            const preflight = body.preflight;
            if (
              !(preflight && typeof preflight === 'object' && 'preflightId' in preflight &&
                typeof preflight.preflightId === 'string' && 'items' in preflight &&
                Array.isArray(preflight.items) && 'overallOutcome' in preflight &&
                preflight.overallOutcome !== 'blocked' && 'packageDiagnosticCodes' in preflight &&
                Array.isArray(preflight.packageDiagnosticCodes) &&
                'acknowledgementToken' in preflight &&
                (preflight.acknowledgementToken === null ||
                  typeof preflight.acknowledgementToken === 'string'))
            ) {
              expect.unreachable(
                "Expected preflight && typeof preflight === 'object' && 'preflightId' in preflight && typeof preflig",
              );
            }
            expect(partCodes(preflight.packageDiagnosticCodes), target.id).toStrictEqual(
              expectedCodes,
            );
            url.pathname = url.pathname.replace('/validate', '/package');
            url.searchParams.set('preflightId', preflight.preflightId);
            if (preflight.acknowledgementToken !== null) {
              expect((await invoke(packageRoute, new Request(url))).status, target.id)
                .toStrictEqual(409);
              url.searchParams.set('acknowledgement', preflight.acknowledgementToken);
            }
            const packaged = await invoke(packageRoute, new Request(url));
            expect(packaged.status, target.id).toStrictEqual(200);
            const bytes = new Uint8Array(await packaged.arrayBuffer());
            const text = target.id === 'moodle'
              ? new TextDecoder().decode(bytes)
              : await archiveXml(bytes);
            expect(text).toContain('First settings question');
            expect(text).toContain('Second settings question');
            expect(text.includes('Read every question before submitting.')).toStrictEqual(native);
            expect(text.includes('Review after finishing.')).toStrictEqual(native);
            if (native) {
              expect(text).toContain('min-time="60"');
              expect(text).toContain('max-time="300"');
            } else {
              expect(text.includes('minTime="60"'), target.id).toStrictEqual(retainsLimits);
              expect(text.includes('maxTime="300"'), target.id).toStrictEqual(retainsLimits);
            }
            const receiptId = packaged.headers.get('x-qflow-export-receipt-id');
            if (!receiptId) expect.unreachable('Expected receiptId');
            const receiptResponse = await invokeHttpRoute(
              receiptRoute,
              makeHttpRequest(new Request(`http://local/receipt/${receiptId}`), {
                params: { id: assessment.id, receiptId },
                auth: ctx,
              }),
            );
            expect(receiptResponse.status).toStrictEqual(200);
            const receipt: unknown = await receiptResponse.json();
            if (
              !(receipt && typeof receipt === 'object' && 'items' in receipt &&
                'preflightId' in receipt && 'packageDiagnosticCodes' in receipt &&
                Array.isArray(receipt.packageDiagnosticCodes))
            ) {
              expect.unreachable(
                "Expected receipt && typeof receipt === 'object' && 'items' in receipt && 'preflightId' in receipt &",
              );
            }
            expect(receipt.preflightId).toStrictEqual(preflight.preflightId);
            expect(receipt.items).toStrictEqual(preflight.items);
            expect(partCodes(receipt.packageDiagnosticCodes), target.id).toStrictEqual(
              expectedCodes,
            );
            expect(await getAssessment(ctx, assessment.id)).toStrictEqual(source);
            for (const revision of revisions) {
              expect(await getQuestionRevision(ctx, revision.questionId, revision.revision))
                .toStrictEqual(revision);
            }
          }
        } finally {
          await deleteAssessment(ctx, assessment.id);
        }
      });
    } finally {
      await shutdownDb();
    }
  },
);

function partCodes(codes: unknown[]): string[] {
  const strings = codes.map((code) => {
    if (!(typeof code === 'string')) expect.unreachable("Expected typeof code === 'string'");
    return code;
  });
  return strings.filter((code) => code.startsWith('qflow.export.part_')).sort();
}

async function archiveXml(bytes: Uint8Array): Promise<string> {
  const archive = await ZipArchive.open(bytes);
  try {
    return (await Promise.all(
      Object.values(archive.files)
        .filter((entry) => !entry.dir && entry.name.endsWith('.xml'))
        .map((entry) => entry.async('string')),
    )).join('\n');
  } finally {
    await archive.close();
  }
}
