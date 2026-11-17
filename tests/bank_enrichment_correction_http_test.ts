import { expect, test as testCase } from 'vitest';

import { db, shutdownDb } from '../lib/db.ts';
import { handleEnrichmentAction } from '../lib/http/bank_enrichment.ts';
import { BankEnrichmentJobRead } from '../lib/services/bank_enrichment_job_read.ts';
import { BankEnrichmentScopes } from '../lib/services/bank_enrichment_scope.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { uuidV5 } from '../lib/uuid_v5.ts';
import { invokeHttpRoute, makeHttpRequest } from './helpers/http_route.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import {
  finishMutation,
  mutationBank,
  mutationNow,
  mutationWrites,
} from './helpers/enrichment_mutation_fixture.ts';

testCase(
  'correction and undo HTTP commands dispatch with workflow bindings and no AI configuration',
  async () => {
    try {
      await withEnrichmentWorkspace(async (auth) => {
        const bank = await mutationBank(auth, 2);
        const dispatched: string[] = [];
        const workflow = {
          createBatch(inputs: readonly { readonly id: string }[]) {
            dispatched.push(...inputs.map((input) => input.id));
            return Promise.resolve(
              inputs.map(() => ({ status: () => Promise.resolve({ status: 'queued' }) })),
            );
          },
          get: () => ({ status: () => Promise.resolve({ status: 'queued' }) }),
        };
        const catalog = catalogForLocale('en-US');
        const state = {
          interfaceLocale: 'en-US' as const,
          catalog,
          i18n: createI18n('en-US', catalog),
          runtime: {
            bindings: {
              QFLOW_SOURCE_MIGRATION_WORKFLOW: workflow,
              QFLOW_AI_GENERATION_WORKFLOW: workflow,
              QFLOW_RELEASE_BUILD_WORKFLOW: workflow,
              QFLOW_MIGRATION_COMMIT_WORKFLOW: workflow,
              QFLOW_BANK_ENRICHMENT_WORKFLOW: workflow,
              QFLOW_QUESTION_ORGANIZATION_WORKFLOW: workflow,
              QFLOW_ASSESSMENT_PRINT_WORKFLOW: workflow,
            },
          },
        };
        const post = (jobId: string | null, command: unknown) => {
          const form = new FormData();
          form.set('payload', JSON.stringify(command));
          const request = new Request(
            `http://localhost/items/organize${jobId ? `/${jobId}` : ''}`,
            { ...{ duplex: 'half' }, method: 'POST', body: form },
          );
          return invokeHttpRoute(
            (ctx) => handleEnrichmentAction(ctx, jobId),
            makeHttpRequest(request, { auth, state, params: jobId ? { id: jobId } : {} }),
          );
        };
        const id = crypto.randomUUID();
        const command = {
          action: 'correct',
          operationId: id,
          scope: { _tag: 'Selected', questionIds: [bank.ids[0]] },
          expectedCount: 1,
          versionId: bank.versionId,
          values: {
            subject: null,
            topic: null,
            difficulty: { state: 'assigned', valueIds: ['hard'] },
          },
        };
        const response = await post(null, command);
        expect(response.status, await response.text()).toStrictEqual(202);
        expect(dispatched).toStrictEqual([await uuidV5(id, 'execution')]);
        await finishMutation(id, await uuidV5(id, 'execution'));
        expect((await mutationWrites(auth, id)).length).toStrictEqual(1);
        const repeated = await post(null, command);
        expect(repeated.status, await repeated.text()).toStrictEqual(202);
        expect((await mutationWrites(auth, id)).length).toStrictEqual(1);
        const undo = crypto.randomUUID();
        const undoResponse = await post(id, { action: 'undo', operationId: undo });
        expect(undoResponse.status, await undoResponse.text()).toStrictEqual(202);
        await finishMutation(undo, await uuidV5(undo, 'execution'));
        const status = await new BankEnrichmentJobRead(db, mutationNow).get(auth, undo);
        if (!(status.ok && status.value.kind === 'undo')) {
          expect.unreachable("Expected status.ok && status.value.kind === 'undo'");
        }
        expect(status.value.usage).toStrictEqual(null);
        expect(status.value.changes.questions).toStrictEqual(1);
        const malformed = await post(null, { ...command, unexpected: true });
        expect(malformed.status).toStrictEqual(400);
        await withEnrichmentWorkspace(async (other) => {
          const scopes = new BankEnrichmentScopes(db, mutationNow);
          expect(await scopes.inspect(other, command.scope)).toStrictEqual({
            ok: false,
            code: 'invalid_selection',
          });
        });
      });
    } finally {
      await shutdownDb();
    }
  },
);
