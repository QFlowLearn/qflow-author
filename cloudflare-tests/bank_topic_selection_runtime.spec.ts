import { createAssessmentDraft } from '../tests/assessment_fixture.ts';
import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { getDb } from '../lib/db.ts';
import { authSessions, userSettingsTable } from '../lib/db/schema.ts';
import { runWithRequestRuntime } from '../lib/server/request_runtime_context.ts';
import { saveUserSettings } from '../lib/services/user_settings.ts';
import { createInitialUserSettings } from '../lib/settings.ts';
import { createSession } from '../lib/services/auth_sessions.ts';
import { deleteAssessment, getAssessment } from '../lib/services/assessment_records.ts';
import { BankEnrichmentStore } from '../lib/services/bank_enrichment_store.ts';
import { enrichmentDefinitionFixture } from '../tests/bank_enrichment_fixture.ts';
import {
  addEnrichmentQuestions,
  withEnrichmentWorkspace,
} from '../tests/helpers/enrichment_workspace.ts';
import { assignOverviewFixture } from '../tests/helpers/enrichment_overview_fixture.ts';
import { parseBankProposalCommand } from '../lib/bank_question_proposal.ts';
import { parseBankProposalResponse } from '../lib/bank_question_proposal_response.ts';
import { parseBankSelectionResult } from '../lib/assessment_bank_selection.ts';

it('serves topic-only distinct proposals and retry-safe atomic adds through Worker HTTP and Hyperdrive', async () => {
  const bindings = { QFLOW_DB: Reflect.get(env, 'QFLOW_DB') };
  await runWithRequestRuntime({ bindings }, async () => {
    const database = getDb({ bindings });
    await withEnrichmentWorkspace(async (ctx) => {
      const assessment = await createAssessmentDraft(ctx, { title: 'Workerd topic quiz' });
      try {
        const ids = await addEnrichmentQuestions(ctx, 6, database);
        const schemeId = crypto.randomUUID(), versionId = crypto.randomUUID();
        expect(
          (await new BankEnrichmentStore(database, () => new Date()).saveVersion(ctx, {
            id: versionId,
            schemeId,
            expectedVersion: 0,
            definition: enrichmentDefinitionFixture(),
          })).ok,
        ).toBe(true);
        await assignOverviewFixture(ctx, schemeId, versionId, ids, {
          subject: { state: 'assigned', valueIds: ['life'] },
          topic: { state: 'assigned', valueIds: ['cells'] },
          difficulty: { state: 'unassigned', reason: 'insufficient_context' },
        });
        await saveUserSettings(ctx.userId, createInitialUserSettings('en-US'));
        const session = await createSession({ userId: ctx.userId, tenantId: ctx.tenantId });
        const post = (path: string, body: unknown) =>
          SELF.fetch(`https://qflow.example${path}`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              origin: 'https://qflow.example',
              cookie: `qflow_session=${session.token}`,
            },
            body: JSON.stringify(body),
          });
        const input = {
          kind: 'draw',
          mode: 'topic',
          selection: `scheme=${schemeId}`,
          versionId,
          excludedQuestions: [],
          counts: [{ categoryId: 'cells', count: 2 }],
        };
        const parsed = parseBankProposalCommand(input);
        if (!parsed) throw new Error('Invalid test command.');
        const response = await post(`/api/assessments/${assessment.id}/question-proposals`, input);
        expect(response.status).toBe(200);
        const proposal = parseBankProposalResponse(await response.json(), parsed);
        if (proposal?.kind !== 'proposal') throw new Error('Expected a distinct topic proposal.');
        expect(proposal.items.length).toBe(2);
        expect(proposal.version.levels.find((l) => l.id === 'cells')?.available).toBe(2);
        const saved = await getAssessment(ctx, assessment.id);
        if (!saved) throw new Error('Missing test assessment.');
        const command = {
          partId: saved.parts[0].id,
          items: proposal.items.map((item) => ({
            placementId: crypto.randomUUID(),
            itemId: item.question.id,
            revision: item.question.latestRev,
            proposal: {
              mode: 'topic',
              selection: input.selection,
              versionId,
              categoryId: item.categoryId,
            },
          })),
        };
        for (let attempt = 0; attempt < 2; attempt++) {
          const add = await post(`/api/assessments/${assessment.id}/placements`, command);
          expect(add.status).toBe(201);
          expect(parseBankSelectionResult(await add.json(), command)?.items.length).toBe(2);
        }
        expect((await getAssessment(ctx, assessment.id))?.targetCount).toBe(2);
        const after = await post(`/api/assessments/${assessment.id}/question-proposals`, input);
        const shortage = parseBankProposalResponse(await after.json(), parsed);
        expect(shortage?.kind).toBe('shortfall');
        if (shortage?.kind === 'shortfall') expect(shortage.available).toBe(0);
      } finally {
        await deleteAssessment(ctx, assessment.id);
        await database.delete(userSettingsTable).where(eq(userSettingsTable.userId, ctx.userId));
        await database.delete(authSessions).where(eq(authSessions.userId, ctx.userId));
      }
    }, database);
  });
});
