import { expect, test as testCase } from 'vitest';

import { scoreQtiItemServerSide } from '@longsightgroup/qti3-core';
import { shutdownDb } from '../lib/db.ts';
import {
  listSelectableAssessmentExportTargets,
  type SelectableAssessmentExportTargetId,
} from '../lib/export/assessment_export_targets.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { getQuestionRevision } from '../lib/services/questions.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { parseQtiPackage } from '../lib/import/adapters/qti3/parse_package.ts';
import { qti21Adapter } from '../lib/import/adapters/qti21.ts';
import { ZipArchive } from '../lib/zip_archive.ts';
import { validateApiRoute as validateEndpoint } from '../lib/http/routes/assessment_api/validate.ts';
import { packageApiRoute as packageRouteEndpoint } from '../lib/http/routes/assessment_api/package.ts';
import { receiptApiRoute as receiptRouteEndpoint } from '../lib/http/routes/assessment_api/receipt.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { assertQuestionOnlyAssessmentFixture } from './helpers/question_only_assessment.ts';
import { invokeHttpRoute, makeHttpRequest } from './helpers/http_route.ts';
import { createMemoryObjectStorage } from './memory_object_storage.ts';

const validate = validateEndpoint.handle;
const packageRoute = packageRouteEndpoint.handle;
const receiptRoute = receiptRouteEndpoint.handle;

testCase(
  'all selectable weighted exports retain usable questions and exact scoring disclosures in durable receipts',
  async () => {
    try {
      await withEnrichmentWorkspace(async (ctx) => {
        const assessment = await createAssessmentDraft(ctx, {
          title: 'Weighted export acceptance',
        });
        try {
          const initial = await getAssessment(ctx, assessment.id);
          assertQuestionOnlyAssessmentFixture(initial);
          const revisions = [];
          for (const type of ['single_select', 'multi_select'] as const) {
            const saved = await saveAssessmentQuestion(ctx, assessment.id, {
              _tag: 'Create',
              partId: initial.parts[0].id,
              draft: {
                type,
                itemLanguage: newAuthoringItemLanguage(),
                title: type === 'single_select'
                  ? 'Three point question'
                  : 'Partial credit question',
                bodyHtml: '<p>Choose Alpha.</p>',
                choices: [
                  { id: 'A', text: 'Alpha' },
                  { id: 'B', text: 'Beta' },
                  { id: 'C', text: 'Gamma' },
                ],
                maximumScore: type === 'single_select' ? 3 : 2.5,
                ...(type === 'single_select'
                  ? { correctId: 'A' }
                  : { correctIds: ['A', 'B'], responseMode: 'partial' }),
              },
            });
            if (!(saved.ok)) expect.unreachable('Expected saved.ok');
            const revision = await getQuestionRevision(
              ctx,
              saved.value.itemId,
              saved.value.revision,
            );
            if (!(revision?.qtiXml)) expect.unreachable('Expected revision?.qtiXml');
            revisions.push(revision);
          }
          const source = await getAssessment(ctx, assessment.id);
          const storage = createMemoryObjectStorage();
          for (const target of listSelectableAssessmentExportTargets()) {
            let scoring = 'automatic';
            const url = new URL(`http://local/api/assessments/${assessment.id}/validate`);
            url.searchParams.set('target', target.id);
            url.searchParams.set('scoring', scoring);
            url.searchParams.set('interaction', 'preserve');
            const preflightResponse = () =>
              invokeHttpRoute(
                validate,
                makeHttpRequest(new Request(url), {
                  params: { id: assessment.id },
                  auth: ctx,
                  state: { storage },
                }),
              );
            let preflight = await readPreflight(await preflightResponse());
            const scoringLoss = expectedScoringLoss(target.id);
            if (scoringLoss !== null) {
              expect(preflight.overallOutcome).toStrictEqual('blocked');
              expect(JSON.stringify(preflight.items)).toContain(scoringLoss);
              if (target.id === 'blackboard-question-banks') {
                expect(JSON.stringify(preflight.items)).toContain(
                  'qflow.requirement.automatic_scoring_lost',
                );
                scoring = 'manual-accepted';
                url.searchParams.set('scoring', scoring);
              }
              url.searchParams.set('interaction', 'fallback-accepted');
              preflight = await readPreflight(await preflightResponse());
            }
            if (!(preflight.overallOutcome !== 'blocked')) expect.unreachable(target.id);
            const packageUrl = new URL(url);
            packageUrl.pathname = packageUrl.pathname.replace('/validate', '/package');
            packageUrl.searchParams.set('preflightId', preflight.preflightId);
            if (preflight.acknowledgementToken !== null) {
              const unacknowledged = await invokeHttpRoute(
                packageRoute,
                makeHttpRequest(new Request(packageUrl), {
                  params: { id: assessment.id },
                  auth: ctx,
                  state: { storage },
                }),
              );
              expect(unacknowledged.status, target.id).toStrictEqual(409);
              packageUrl.searchParams.set('acknowledgement', preflight.acknowledgementToken);
            }
            const packaged = await invokeHttpRoute(
              packageRoute,
              makeHttpRequest(new Request(packageUrl), {
                params: { id: assessment.id },
                auth: ctx,
                state: { storage },
              }),
            );
            expect(packaged.status, target.id).toStrictEqual(200);
            const bytes = new Uint8Array(await packaged.arrayBuffer());
            if (!(bytes.length > 0)) expect.unreachable('Expected bytes.length > 0');
            const receiptId = packaged.headers.get('x-qflow-export-receipt-id');
            if (!receiptId) expect.unreachable('Expected receiptId');
            const receiptResponse = await invokeHttpRoute(
              receiptRoute,
              makeHttpRequest(
                new Request(`http://local/api/assessments/${assessment.id}/receipts/${receiptId}`),
                {
                  params: { id: assessment.id, receiptId },
                  auth: ctx,
                },
              ),
            );
            expect(receiptResponse.status).toStrictEqual(200);
            const receipt: unknown = await receiptResponse.json();
            if (
              !(receipt && typeof receipt === 'object' && 'items' in receipt &&
                'preflightId' in receipt)
            ) {
              expect.unreachable(
                "Expected receipt && typeof receipt === 'object' && 'items' in receipt && 'preflightId' in receipt",
              );
            }
            expect(receipt.preflightId).toStrictEqual(preflight.preflightId);
            expect(receipt.items).toStrictEqual(preflight.items);
            if (scoringLoss !== null) {
              expect(JSON.stringify(receipt.items)).toContain(scoringLoss);
            }
            let text: string;
            if (target.id === 'moodle') text = new TextDecoder().decode(bytes);
            else {
              const archive = await ZipArchive.open(bytes);
              try {
                text = (await Promise.all(
                  Object.values(archive.files)
                    .filter((entry) => !entry.dir && entry.name.endsWith('.xml'))
                    .map((entry) => entry.async('string')),
                )).join('\n');
              } finally {
                await archive.close();
              }
            }
            expect(text).toContain('Three point question');
            expect(text).toContain('Partial credit question');
            if (target.id === 'canvas-classic' || target.id === 'canvas-new-quizzes') {
              expect(text).toContain(
                '<fieldlabel>points_possible</fieldlabel><fieldentry>3</fieldentry>',
              );
              expect(text).toContain(
                '<fieldlabel>points_possible</fieldlabel><fieldentry>2.5</fieldentry>',
              );
              expect(text).toContain('<points_possible>5.5</points_possible>');
            }
            if (target.id === 'moodle') {
              expect(text).toContain('<defaultgrade>3</defaultgrade>');
              expect(text).toContain('<defaultgrade>2.5</defaultgrade>');
            }
            if (scoringLoss === null) {
              const imported = target.id === 'qti3-conformant'
                ? await parseQtiPackage(bytes)
                : await qti21Adapter.parse({
                  filename: 'weighted.zip',
                  mime: 'application/zip',
                  bytes,
                });
              expect(imported.items.length).toStrictEqual(2);
              for (const item of imported.items) {
                const multiple = item.title === 'Partial credit question';
                if (!(multiple || item.title === 'Three point question')) {
                  expect.unreachable("Expected multiple || item.title === 'Three point question'");
                }
                expect(item.draft.maximumScore).toStrictEqual(multiple ? 2.5 : 3);
                const cases = multiple
                  ? [
                    [['A'], 1.25],
                    [['A', 'C'], 1.25],
                    [['A', 'B'], 2.5],
                    [['A', 'B', 'C'], 2.5],
                    [[
                      'C',
                    ], 0],
                  ] as const
                  : [['A', 3], ['B', 0], [null, 0]] as const;
                for (const [response, expected] of cases) {
                  const scored = scoreQtiItemServerSide({
                    itemXml: item.xml,
                    trustedResponses: {
                      RESPONSE: typeof response === 'object' && response !== null
                        ? [...response]
                        : response,
                    },
                  });
                  if (!(scored.ok)) expect.unreachable(target.id);
                  expect(scored.score, `${target.id}/${item.title}`).toStrictEqual(expected);
                }
              }
            }
            expect(await getAssessment(ctx, assessment.id)).toStrictEqual(source);
            for (const revision of revisions) {
              expect(await getQuestionRevision(ctx, revision.questionId, revision.revision))
                .toStrictEqual(revision);
            }
          }
          for (const [index, revision] of revisions.entries()) {
            if (!(revision.qtiXml)) expect.unreachable('Expected revision.qtiXml');
            const scored = scoreQtiItemServerSide({
              itemXml: revision.qtiXml,
              trustedResponses: { RESPONSE: index === 0 ? 'A' : ['A'] },
            });
            if (!(scored.ok)) expect.unreachable('Expected scored.ok');
            expect(scored.score).toStrictEqual(index === 0 ? 3 : 1.25);
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

function expectedScoringLoss(target: SelectableAssessmentExportTargetId): string | null {
  switch (target) {
    case 'canvas-classic':
    case 'canvas-new-quizzes':
      return 'profile.canvas.scoring.choice_rebuilt';
    case 'moodle':
      return 'profile.moodle.xml.scoring.choice_rebuilt';
    case 'qti12-standard':
      return 'profile.qti12.scoring.choice_rebuilt';
    case 'blackboard-question-banks':
      return 'profile.blackboard.response_processing.omitted';
    case 'qti3-conformant':
    case 'qti21-standard':
    case 'qti22-standard':
    case 'brightspace-course-import':
      return null;
  }
}

async function readPreflight(response: Response) {
  expect(response.status).toStrictEqual(200);
  const body: unknown = await response.json();
  if (!(body && typeof body === 'object' && 'preflight' in body)) {
    expect.unreachable("Expected body && typeof body === 'object' && 'preflight' in body");
  }
  const value = body.preflight;
  if (
    !(value && typeof value === 'object' && 'items' in value && Array.isArray(value.items) &&
      'overallOutcome' in value && typeof value.overallOutcome === 'string' &&
      'preflightId' in value && typeof value.preflightId === 'string' &&
      'acknowledgementToken' in value &&
      (value.acknowledgementToken === null || typeof value.acknowledgementToken === 'string'))
  ) {
    expect.unreachable(
      "Expected value && typeof value === 'object' && 'items' in value && Array.isArray(value.items) && 'o",
    );
  }
  return {
    items: value.items,
    overallOutcome: value.overallOutcome,
    preflightId: value.preflightId,
    acknowledgementToken: value.acknowledgementToken,
  };
}
