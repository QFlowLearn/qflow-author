import { expect, test as testCase } from 'vitest';

import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';
import * as _fs from 'node:fs/promises';
import { assertQuestionOnlyAssessmentFixture } from './helpers/question_only_assessment.ts';

import { eq } from 'drizzle-orm';
import { unzipSync } from 'fflate';
import { parseQtiFixedTestOrdering, prepareQtiFixedTestOrder } from '@longsightgroup/qti3-core';
import type { Page } from 'playwright';
import { db, shutdownDb } from '../lib/db.ts';
import { assessmentDeliveryPublishAttempts, authSessions } from '../lib/db/schema.ts';
import { parseDeliveryPublishResponsePayload } from '../lib/delivery_publish.ts';
import { parseDeliveryPublishAttemptRow } from '../lib/services/delivery_publish_attempt_state.ts';
import { createSession } from '../lib/services/auth_sessions.ts';
import { saveUserSettings } from '../lib/services/user_settings.ts';
import { createInitialUserSettings } from '../lib/settings.ts';
import { getAssessment } from '../lib/services/assessment_records.ts';
import { createAssessmentDraft, deleteAssessment } from './assessment_fixture.ts';
import { saveAssessmentQuestion } from '../lib/services/assessment_question_authoring.ts';
import { assessmentPlacementRemovalService } from '../lib/services/assessment_placement_removal.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { changeQuestionPresentation } from '../lib/question_presentation.ts';
import { parsePersistedDraft } from '../lib/persisted_draft.ts';
import { getQuestionRevision } from '../lib/services/questions.ts';
import { sha256Hex } from '../lib/sha256.ts';
import { type LocalAppBrowser, openLocalAppBrowser } from '../tools/local_app_browser.ts';
import { saveAssessmentArrangementFixture } from './helpers/assessment_arrangement.ts';
import {
  captureBrowserFailure,
  createBrowserEvidenceDirectory,
} from './helpers/browser_evidence.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { openLocalExportStorage } from './helpers/local_export_storage.ts';
import { requireQaDatabaseUrl } from './helpers/qa_database.ts';
import {
  bootstrap,
  harborPost,
  parseAttemptResult,
  readFinalItemGrades,
  readLocalHarborConfig,
  readManifest,
} from './helpers/harbor_delivery.ts';

/** Requires an explicitly configured local Harbor Worker with isolated D1/R2/DO state. */
testCase('real QFlow publish preserves pinned points and shared learner order in local Harbor', {
  skip: process.env['QFLOW_HARBOR_INTEGRATION_TESTS'] !== '1',
}, async function () {
  const databaseUrl = requireQaDatabaseUrl(process.env['DATABASE_URL']);
  const harbor = readLocalHarborConfig();
  const evidence = await createBrowserEvidenceDirectory();
  const storage = await openLocalExportStorage();
  let app: LocalAppBrowser | undefined;
  try {
    await withEnrichmentWorkspace(async (ctx) => {
      await saveUserSettings(ctx.userId, createInitialUserSettings('en-US'));
      const assessment = await createAssessmentDraft(ctx, {
        title: 'Real shuffled QFlow delivery',
      });
      try {
        const initial = await getAssessment(ctx, assessment.id);
        assertQuestionOnlyAssessmentFixture(initial);
        const maxima = [3.125, 2.5, 0, 1, 3];
        const questions = [];
        const prompts = new Map<string, string>();
        const draft = (title: string, maximumScore: number) => ({
          type: 'single_select' as const,
          title,
          itemLanguage: newAuthoringItemLanguage(),
          bodyHtml: '',
          promptHtml: `<p>${title}: Choose Paris.</p>`,
          maximumScore,
          choices: [{ id: 'A', text: 'Paris' }, { id: 'B', text: 'Berlin' }],
          correctId: 'A',
        });
        // Question saves share the assessment lock and must be sequential.
        for (const [index, maximum] of maxima.entries()) {
          const authored = index === 1
            ? {
              type: 'multi_select' as const,
              title: `Question ${index + 1}`,
              itemLanguage: newAuthoringItemLanguage(),
              bodyHtml: `<p>Question ${index + 1}: Choose Paris and Berlin.</p>`,
              maximumScore: maximum,
              promptHtml: 'Choose all that apply.',
              choices: [
                { id: 'A', text: 'Paris' },
                { id: 'B', text: 'Berlin' },
                { id: 'C', text: 'Lima' },
              ],
              correctIds: ['A', 'B'],
              responseMode: 'partial' as const,
            }
            : draft(`Question ${index + 1}`, maximum);
          const saved = await saveAssessmentQuestion(ctx, assessment.id, {
            _tag: 'Create',
            partId: initial.parts[0].id,
            draft: authored,
          });
          if (!(saved.ok)) expect.unreachable(JSON.stringify(saved));
          questions.push(saved.value);
          prompts.set(
            authored.title,
            index === 1
              ? `${authored.title}: Choose Paris and Berlin.`
              : `${authored.title}: Choose Paris.`,
          );
        }
        const presentation = changeQuestionPresentation(draft('Question 4', maxima[3]));
        if (!(presentation.ok)) expect.unreachable('Expected presentation.ok');
        const converted = await saveAssessmentQuestion(ctx, assessment.id, {
          _tag: 'Revise',
          expectedParentRevision: questions[3].revision,
          itemId: questions[3].itemId,
          placementId: questions[3].placementId,
          draft: presentation.draft,
        });
        if (!(converted.ok)) expect.unreachable('Expected converted.ok');
        expect(converted.value.itemId).toStrictEqual(questions[3].itemId);
        expect(converted.value.placementId).toStrictEqual(questions[3].placementId);
        expect(converted.value.revision).toStrictEqual(2);
        const dropdownRevision = await getQuestionRevision(ctx, questions[3].itemId, 2);
        if (!dropdownRevision) expect.unreachable('Expected dropdownRevision');
        const dropdown = parsePersistedDraft(dropdownRevision.body, 'inline_choice');
        expect(dropdown.maximumScore).toStrictEqual(1);
        expect(dropdown.inlineChoices?.[0].correctId).toStrictEqual('A');
        const revised = await saveAssessmentQuestion(ctx, assessment.id, {
          _tag: 'Revise',
          expectedParentRevision: questions[0].revision,
          placementId: questions[0].placementId,
          itemId: questions[0].itemId,
          draft: draft('Changed latest question', 9.5),
        });
        if (!(revised.ok)) expect.unreachable('Expected revised.ok');
        const authored = await getAssessment(ctx, assessment.id);
        assertQuestionOnlyAssessmentFixture(authored);
        await saveAssessmentArrangementFixture(ctx, assessment.id, [{
          ...authored.parts[0],
          options: { shuffleQuestions: true, timeLimits: { maxTime: 600 } },
          placements: authored.parts[0].placements.map((p, index) => ({
            ...p,
            snapshotRev: index === 3 ? 2 : 1,
            fixed: index === 0,
          })),
        }]);
        const before = await getAssessment(ctx, assessment.id);
        assertQuestionOnlyAssessmentFixture(before);
        app = await openLocalAppBrowser({
          endpoint: {
            _tag: 'ManagedLocalApp',
            portRange: { first: 5460, lastExclusive: 5461 },
            environment: {
              ...builtWorkerBrowserEnvironment,
              DATABASE_URL: databaseUrl,
              ...storage.environment,
              QFLOW_DELIVERY_PUBLISH_URL: `${harbor.origin}/internal/qflow/publish`,
              QFLOW_DELIVERY_CAPABILITY_URL: `${harbor.origin}/internal/qflow/capability`,
              QFLOW_DELIVERY_STATE_URL: `${harbor.origin}/internal/qflow/state`,
              QFLOW_DELIVERY_SSO_LAUNCH_URL: `${harbor.origin}/internal/qflow/handoff`,
              QFLOW_DELIVERY_SIGNING_SECRET: harbor.signingSecret,
              QFLOW_RUNNER_KEY: harbor.runnerKey,
            },
          },
          headless: true,
        });
        // The opt-in endpoint is restricted to loopback and uses a test-owned TLS certificate.
        const context: import('playwright').BrowserContext = await app.newContext({
          authSession: await createSession(ctx),
          browser: { ignoreHTTPSErrors: true },
        });
        const request = context.request;
        const linked = await request.post(`${harbor.origin}/internal/admin/qflow-tenants`, {
          headers: { 'x-harbor-admin-key': harbor.adminKey },
          data: {
            qflowTenantId: ctx.tenantId,
            tenantId: harbor.tenantId,
            entitlementStatus: 'active',
          },
        });
        expect(linked.status(), await linked.text()).toStrictEqual(200);
        const qflowOrigin = app.baseUrl;
        const base = `${qflowOrigin}/api/assessments/${assessment.id}`;
        const reviewed = await request.get(
          `${base}/validate?target=qti3-conformant&scoring=automatic&interaction=preserve`,
        );
        expect(reviewed.status(), await reviewed.text()).toStrictEqual(200);
        const review = parseReview(await reviewed.json());
        const publish = async () => {
          const response = await request.post(`${base}/publish/delivery`, {
            headers: { Origin: qflowOrigin },
            ...(review.acknowledgement === null ? {} : { data: review }),
          });
          expect(response.status(), await response.text()).toStrictEqual(200);
          const raw: unknown = await response.json();
          if (
            !(raw && typeof raw === 'object' && 'publishId' in raw &&
              typeof raw.publishId === 'string')
          ) {
            expect.unreachable(
              "Expected raw && typeof raw === 'object' && 'publishId' in raw && typeof raw.publishId === 'string'",
            );
          }
          const parsed = parseDeliveryPublishResponsePayload(raw, raw.publishId, harbor.origin);
          if (!parsed) expect.unreachable('Expected parsed');
          return parsed;
        };
        const published = await publish();
        expect(await publish()).toStrictEqual(published);
        const rows = await db.select().from(assessmentDeliveryPublishAttempts).where(
          eq(assessmentDeliveryPublishAttempts.tenantId, ctx.tenantId),
        );
        expect(rows.length).toStrictEqual(1);
        const attempt = parseDeliveryPublishAttemptRow(rows[0]);
        expect(attempt.phase).toStrictEqual('published');
        const packageResponse = await request.get(attempt.request.packageUrl, {
          headers: { 'x-runner-key': harbor.runnerKey },
        });
        expect(packageResponse.status()).toStrictEqual(200);
        const bytes = new Uint8Array(await packageResponse.body());
        const hash = await sha256Hex(bytes);
        expect(hash).toStrictEqual(published.version.sourcePackageSha256);
        const archive = unzipSync(bytes);
        const testXmls = Object.values(archive).map((value) => new TextDecoder().decode(value))
          .filter((value) => /<qti-assessment-test\b/.test(value));
        expect(testXmls.length).toStrictEqual(1);
        const definition = parseQtiFixedTestOrdering(testXmls[0]);
        if (!(definition.ok)) expect.unreachable('Expected definition.ok');
        expect(definition.value.sections.length).toStrictEqual(1);
        const section = definition.value.sections[0];
        expect(section.shuffle).toStrictEqual(true);
        expect(section.items.map((item) => item.fixed === true)).toStrictEqual([
          true,
          false,
          false,
          false,
          false,
        ]);
        const issued = await harborPost(request, harbor, '/internal/access-codes', {
          assessmentVersionId: published.version.assessmentVersionId,
          code: `ORDER-${crypto.randomUUID()}`,
        });
        if (
          !(issued && typeof issued === 'object' && 'accessCode' in issued &&
            typeof issued.accessCode === 'string')
        ) {
          expect.unreachable(
            "Expected issued && typeof issued === 'object' && 'accessCode' in issued && typeof issued.accessCode",
          );
        }
        const accessCode = issued.accessCode;
        const observed = new Set<string>();
        const responseCases = [
          {
            name: 'full',
            single: 'A',
            multiple: ['A', 'B'],
            total: 9.625,
            itemScores: [3.125, 2.5, 0, 1, 3],
          },
          {
            name: 'partial',
            single: 'A',
            multiple: ['A'],
            total: 8.375,
            itemScores: [3.125, 1.25, 0, 1, 3],
          },
          {
            name: 'wrong-multiple',
            single: 'A',
            multiple: ['C'],
            total: 7.125,
            itemScores: [3.125, 0, 0, 1, 3],
          },
          {
            name: 'wrong-all',
            single: 'B',
            multiple: ['C'],
            total: 0,
            itemScores: [0, 0, 0, 0, 0],
          },
          {
            name: 'unanswered',
            single: null,
            multiple: null,
            total: 0,
            itemScores: [0, 0, 0, 0, 0],
          },
          {
            name: 'all-options',
            single: 'A',
            multiple: ['A', 'B', 'C'],
            total: 9.625,
            itemScores: [3.125, 2.5, 0, 1, 3],
          },
        ];
        for (const responseCase of responseCases) {
          const actorId = crypto.randomUUID();
          const first = await bootstrap(request, harbor, accessCode, actorId, 'first-session');
          const manifest = await readManifest(request, harbor.origin, first.attemptId);
          const expected = prepareQtiFixedTestOrder(definition.value, {
            kind: 'new',
            seed: first.attemptId,
          });
          if (!(expected.ok)) expect.unreachable('Expected expected.ok');
          const idsByRef = new Map(section.items.map((reference) => {
            const binding = Object.values(manifest.items).find((item) =>
              item.itemHref === reference.href
            );
            if (!binding) expect.unreachable('Expected binding');
            return [reference.identifier, binding.id];
          }));
          const expectedOrder = expected.value.sections.flatMap((s) =>
            s.itemRefs.map((ref) => {
              const id = idsByRef.get(ref);
              if (!id) expect.unreachable('Expected id');
              return id;
            })
          );
          expect(manifest.itemOrder).toStrictEqual(expectedOrder);
          expect(manifest.currentItemId).toStrictEqual(expectedOrder[0]);
          expect(first.currentItemRef.itemId).toStrictEqual(expectedOrder[0]);
          expect(manifest.items[expectedOrder[0]].title).toStrictEqual('Question 1');
          for (const [position, reference] of section.items.entries()) {
            const id = idsByRef.get(reference.identifier);
            if (!id) expect.unreachable('Expected id');
            expect(manifest.items[id].maxScore).toStrictEqual(maxima[position]);
          }
          expect(Object.values(manifest.items).reduce((sum, item) => sum + item.maxScore, 0))
            .toStrictEqual(9.625);
          observed.add(expectedOrder.join(','));
          const next = manifest.items[expectedOrder[1]];
          await harborPost(request, harbor, `/api/attempts/${first.attemptId}/events`, {
            attemptId: first.attemptId,
            eventId: 'navigate',
            idempotencyKey: 'navigate',
            sequenceNumber: 1,
            clientTimestamp: new Date().toISOString(),
            clientSessionId: 'first-session',
            itemRef: first.currentItemRef,
            type: 'navigation.requested',
            payload: { targetItemRef: { itemId: next.id, itemHref: next.itemHref } },
          });
          const resumed = await bootstrap(
            request,
            harbor,
            accessCode,
            actorId,
            'resumed-session',
          );
          expect(resumed.attemptId).toStrictEqual(first.attemptId);
          expect(resumed.currentItemRef.itemId).toStrictEqual(next.id);
          expect((await readManifest(request, harbor.origin, first.attemptId)).itemOrder)
            .toStrictEqual(expectedOrder);
          // A shortened inventory and privileged outcomes must not change server scoring.
          await harborPost(request, harbor, `/api/attempts/${first.attemptId}/events`, {
            attemptId: first.attemptId,
            eventId: 'submit',
            idempotencyKey: 'submit',
            sequenceNumber: 2,
            clientTimestamp: new Date().toISOString(),
            clientSessionId: 'resumed-session',
            itemRef: resumed.currentItemRef,
            type: 'submit.requested',
            payload: {
              submissionMaterialization: {
                itemOrder: [next.id],
                testState: null,
                partStates: {},
                sectionStates: {},
                items: Object.fromEntries(
                  Object.values(manifest.items).map((item) => [item.id, {
                    itemId: item.id,
                    itemIdentifier: item.id,
                    itemTitle: item.title,
                    capturedAt: null,
                    responseVariables: responseCase.single === null ? [] : [{
                      identifier: 'RESPONSE',
                      value: item.title === 'Question 2'
                        ? responseCase.multiple
                        : responseCase.single,
                    }],
                    outcomeVariables: [{ identifier: 'SCORE', value: 999 }],
                    validationMessages: [],
                  }]),
                ),
              },
            },
          });
          for (let poll = 0; poll < 30; poll++) {
            const response = await request.get(`${harbor.origin}/api/instructor/results-ops`);
            expect(response.status()).toStrictEqual(200);
            const result = parseAttemptResult(await response.json(), first.attemptId);
            if (result?.status === 'complete') {
              expect(result, responseCase.name).toStrictEqual({
                status: 'complete',
                totalScore: responseCase.total,
                maxScore: 9.625,
              });
              const grades = await readFinalItemGrades(request, harbor.origin, first.attemptId);
              expect(grades.length).toStrictEqual(5);
              for (const [index, reference] of section.items.entries()) {
                const grade = grades.find((item) => item.id === idsByRef.get(reference.identifier));
                if (!grade) expect.unreachable('Expected grade');
                expect(grade.title).toStrictEqual(`Question ${index + 1}`);
                expect(grade.maxScore).toStrictEqual(maxima[index]);
                expect(grade.score, responseCase.name).toStrictEqual(
                  responseCase.itemScores[index],
                );
              }
              expect(grades.reduce((sum, item) => sum + item.score, 0)).toStrictEqual(
                responseCase.total,
              );
              break;
            }
            if (!(poll < 29)) {
              expect.unreachable('Actual queued scoring did not finalize within 30 seconds.');
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
        if (!(observed.size > 1)) {
          expect.unreachable('Fresh attempts must demonstrate different shared permutations.');
        }
        for (const width of [1280, 390]) {
          const learner: import('playwright').BrowserContext = await app.newContext({
            browser: { ignoreHTTPSErrors: true, viewport: { width, height: 900 } },
          });
          const page: import('playwright').Page = await learner.newPage();
          try {
            if (!(published.links?.previewUrl)) {
              expect.unreachable('Expected published.links?.previewUrl');
            }
            await page.goto(published.links.previewUrl);
            await waitForText(page, '[data-testid="current-item-position"]', 'Question 1 of 5');
            const attemptId = await page.getByTestId('attempt-id').textContent();
            if (!attemptId) expect.unreachable('Expected attemptId');
            const manifest = await readManifest(request, harbor.origin, attemptId);
            for (const [position, id] of manifest.itemOrder.entries()) {
              await waitForText(page, '[data-testid="current-item-id"]', id);
              const expectedPrompt = prompts.get(manifest.items[id].title);
              if (!expectedPrompt) expect.unreachable('Expected expectedPrompt');
              const questionPrompt = page.getByText(
                expectedPrompt,
                {
                  exact: true,
                },
              );
              await questionPrompt.waitFor({ state: 'visible' });
              expect(await questionPrompt.count()).toStrictEqual(1);
              if (manifest.items[id].title === 'Question 4') {
                await page.locator('.qti3-inline-choice-trigger').click();
                await page.getByRole('option', { name: 'Paris', exact: true }).click();
                await waitForText(page, '.qti3-inline-choice-trigger', 'Paris');
                const [saved] = await Promise.all([
                  page.waitForResponse((response) => {
                    if (
                      response.url() !== `${harbor.origin}/api/attempts/${attemptId}/events` ||
                      response.request().method() !== 'POST'
                    ) return false;
                    const command: unknown = response.request().postDataJSON();
                    return command !== null && typeof command === 'object' &&
                      'type' in command && command.type === 'response.changed';
                  }),
                  page.getByTestId('save-response-button').click(),
                ]);
                if (!(saved.ok())) expect.unreachable('Expected saved.ok()');
                const receipt: unknown = await saved.json();
                if (
                  !(receipt !== null && typeof receipt === 'object' &&
                    'outcome' in receipt && receipt.outcome === 'accepted' &&
                    'attemptId' in receipt && receipt.attemptId === attemptId)
                ) {
                  expect.unreachable(
                    "Expected receipt !== null && typeof receipt === 'object' && 'outcome' in receipt && receipt.outcome",
                  );
                }
                await page.reload();
                await waitForText(page, '[data-testid="current-item-id"]', id);
                await waitForText(page, '.qti3-inline-choice-trigger', 'Paris');
              }
              if (position === 0) {
                await page.screenshot({
                  path: evidence.path(`harbor-fixed-pin-${width}.png`),
                  fullPage: true,
                });
              }
              if (position === 1) {
                await page.reload();
                await waitForText(page, '[data-testid="attempt-id"]', attemptId);
                await waitForText(page, '[data-testid="current-item-id"]', id);
              }
              if (position < 4) await page.getByTestId('next-item-button').click();
            }
            expect(await page.getByTestId('next-item-button').isDisabled()).toStrictEqual(true);
            await page.screenshot({
              path: evidence.path(`harbor-order-${width}.png`),
              fullPage: true,
            });
          } catch (cause: unknown) {
            await captureBrowserFailure(page, evidence, `harbor-order-${width}`);
            throw cause;
          } finally {
            await learner.close();
          }
        }
        expect((await getAssessment(ctx, assessment.id))?.parts).toStrictEqual(before.parts);
        const replayed = await request.get(attempt.request.packageUrl, {
          headers: { 'x-runner-key': harbor.runnerKey },
        });
        expect(replayed.status()).toStrictEqual(200);
        expect(new Uint8Array(await replayed.body())).toStrictEqual(bytes);
        // Saved placement Undo must not change the bank source or an already delivered edition.
        const recoveryAttempt = await bootstrap(
          request,
          harbor,
          accessCode,
          crypto.randomUUID(),
          'placement-recovery-session',
        );
        const publishedView = await readManifest(
          request,
          harbor.origin,
          recoveryAttempt.attemptId,
        );
        const protectedPlacement = before.parts[0].placements[0];
        if (!(protectedPlacement.snapshotRev !== null)) {
          expect.unreachable('Expected protectedPlacement.snapshotRev !== null');
        }
        const retainedSource = await getQuestionRevision(
          ctx,
          protectedPlacement.itemId,
          protectedPlacement.snapshotRev,
        );
        if (!retainedSource) expect.unreachable('Expected retainedSource');
        const removed = await assessmentPlacementRemovalService.remove(
          ctx,
          assessment.id,
          protectedPlacement.id,
          { removalId: crypto.randomUUID(), expectedRevision: protectedPlacement.snapshotRev },
        );
        if (!(removed.ok)) expect.unreachable('Expected removed.ok');
        expect(removed.value.fixed).toStrictEqual(true);
        expect((await getAssessment(ctx, assessment.id))?.targetCount).toStrictEqual(4);
        expect(
          await getQuestionRevision(
            ctx,
            protectedPlacement.itemId,
            protectedPlacement.snapshotRev,
          ),
        ).toStrictEqual(retainedSource);
        expect(await readManifest(request, harbor.origin, recoveryAttempt.attemptId)).toStrictEqual(
          publishedView,
        );
        const removedReplay = await request.get(attempt.request.packageUrl, {
          headers: { 'x-runner-key': harbor.runnerKey },
        });
        expect(removedReplay.status()).toStrictEqual(200);
        expect(new Uint8Array(await removedReplay.body())).toStrictEqual(bytes);
        const restored = await assessmentPlacementRemovalService.restore(
          ctx,
          assessment.id,
          removed.value.id,
        );
        if (!(restored.ok)) expect.unreachable('Expected restored.ok');
        expect(
          await assessmentPlacementRemovalService.restore(ctx, assessment.id, removed.value.id),
        ).toStrictEqual(restored);
        expect((await getAssessment(ctx, assessment.id))?.parts).toStrictEqual(before.parts);
        expect((await getAssessment(ctx, assessment.id))?.targetCount).toStrictEqual(5);
        expect(
          await getQuestionRevision(
            ctx,
            protectedPlacement.itemId,
            protectedPlacement.snapshotRev,
          ),
        ).toStrictEqual(retainedSource);
        expect(await readManifest(request, harbor.origin, recoveryAttempt.attemptId)).toStrictEqual(
          publishedView,
        );
        // QFlow supports multiple authored parts. Harbor's current limit must remain explicit;
        // neither publication nor replay may flatten the source or change the first version.
        await saveAssessmentArrangementFixture(ctx, assessment.id, [{
          ...before.parts[0],
          placements: before.parts[0].placements.slice(0, 2),
        }, {
          id: crypto.randomUUID(),
          title: 'Separate second part',
          options: { shuffleQuestions: true },
          placements: before.parts[0].placements.slice(2),
        }]);
        const multiPart = await getAssessment(ctx, assessment.id);
        assertQuestionOnlyAssessmentFixture(multiPart);
        const multiReviewResponse = await request.get(
          `${base}/validate?target=qti3-conformant&scoring=automatic&interaction=preserve`,
        );
        expect(multiReviewResponse.status()).toStrictEqual(200);
        const multiReview = parseReview(await multiReviewResponse.json());
        const refused = await request.post(`${base}/publish/delivery`, {
          headers: { Origin: qflowOrigin },
          ...(multiReview.acknowledgement === null ? {} : { data: multiReview }),
        });
        expect(refused.status(), await refused.text()).toStrictEqual(422);
        const refusal: unknown = await refused.json();
        if (!(refusal && typeof refusal === 'object' && 'message' in refusal)) {
          expect.unreachable(
            "Expected refusal && typeof refusal === 'object' && 'message' in refusal",
          );
        }
        expect(refusal.message).toStrictEqual('Harbor delivery requires exactly one test part.');
        expect((await getAssessment(ctx, assessment.id))?.parts).toStrictEqual(multiPart.parts);
        const frozenReplay = await request.get(attempt.request.packageUrl, {
          headers: { 'x-runner-key': harbor.runnerKey },
        });
        expect(frozenReplay.status()).toStrictEqual(200);
        expect(new Uint8Array(await frozenReplay.body())).toStrictEqual(bytes);
        if (!(storage.requests.some((r) => r.method === 'PUT'))) {
          expect.unreachable("Expected storage.requests.some((r) => r.method === 'PUT')");
        }
        if (!(storage.requests.filter((r) => r.method === 'GET').length >= 3)) {
          expect.unreachable(
            "Expected storage.requests.filter((r) => r.method === 'GET').length >= 3",
          );
        }
        await _fs.writeFile(
          evidence.path('integration-receipt.json'),
          JSON.stringify(
            {
              assessmentId: assessment.id,
              version: published.version,
              sourceHash: hash,
              permutations: [...observed],
              pinnedRevision: 1,
              maximum: 9.625,
              responseCases,
              convertedPresentationRevision: 2,
              placementRecovery: {
                placementId: protectedPlacement.id,
                revision: protectedPlacement.snapshotRev,
                fixed: true,
                removedCount: 4,
                restoredCount: 5,
                publishedPackageHash: hash,
              },
              widths: [1280, 390],
              multiPartRefusal: refusal.message,
            },
            null,
            2,
          ),
          'utf8',
        );
        await context.close();
      } finally {
        await app?.close();
        app = undefined;
        await db.delete(authSessions).where(eq(authSessions.tenantId, ctx.tenantId));
        await deleteAssessment(ctx, assessment.id);
      }
    });
  } finally {
    await app?.close();
    await storage.close();
    await shutdownDb();
  }
});

function parseReview(value: unknown) {
  if (!(value && typeof value === 'object' && 'preflight' in value)) {
    expect.unreachable("Expected value && typeof value === 'object' && 'preflight' in value");
  }
  const p = value.preflight;
  if (!(p && typeof p === 'object' && 'preflightId' in p && 'acknowledgementToken' in p)) {
    expect.unreachable(
      "Expected p && typeof p === 'object' && 'preflightId' in p && 'acknowledgementToken' in p",
    );
  }
  if (!(typeof p.preflightId === 'string' && /^[\da-f]{64}$/.test(p.preflightId))) {
    expect.unreachable(
      "Expected typeof p.preflightId === 'string' && /^[\\da-f]{64}$/.test(p.preflightId)",
    );
  }
  if (!(p.acknowledgementToken === null || typeof p.acknowledgementToken === 'string')) {
    expect.unreachable(
      "Expected p.acknowledgementToken === null || typeof p.acknowledgementToken === 'string'",
    );
  }
  return { preflightId: p.preflightId, acknowledgement: p.acknowledgementToken };
}

async function waitForText(page: Page, selector: string, text: string) {
  await page.waitForFunction(({ selector, text }) => {
    const node = document.querySelector(selector);
    return node?.textContent?.trim() === text;
  }, { selector, text });
  expect((await page.locator(selector).textContent())?.trim()).toStrictEqual(text);
}
