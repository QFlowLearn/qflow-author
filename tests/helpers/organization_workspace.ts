import { setOrganizationActivation } from '../../lib/services/question_organization_activation.ts';
import { eq } from 'drizzle-orm';
import { db, type QflowDatabase } from '../../lib/db.ts';
import {
  organizationActivation,
  organizationAttempts,
  organizationFiling,
  organizationItems,
  organizationOrigins,
  organizationRuns,
  organizationSetups,
} from '../../lib/db/question_organization_schema.ts';
import { bankCollectionItems, bankCollections, editorialEvents } from '../../lib/db/bank_schema.ts';
import { BankEnrichmentStore } from '../../lib/services/bank_enrichment_store.ts';
import {
  queueOrganizationInTransaction,
  saveOrganizationSetup,
} from '../../lib/services/question_organization_store.ts';
import { addEnrichmentQuestions, withEnrichmentWorkspace } from './enrichment_workspace.ts';
import { enrichmentDefinitionFixture } from '../bank_enrichment_fixture.ts';
import type { RequestContext } from '../../lib/tenants.ts';

export const organizationNow = () => new Date('2026-09-25T15:00:00Z');
export const organizationConfig = {
  promptVersion: 'question-organization-v1' as const,
  gatewayId: 'organization-test',
  modelVersion: 'clef',
  inputMicrosPerMillion: 240000,
  budgetMicros: 1000000,
};
export async function withOrganizationWorkspace(
  test: (fixture: {
    ctx: RequestContext;
    ids: readonly string[];
    setupId: string;
    versionId: string;
    schemeId: string;
    originId: string;
    destinationId: string;
    runId: string;
    sourceId: string;
    params: { jobId: string; workflowExecutionId: string };
  }) => Promise<void>,
  options: {
    readonly difficulty?: 'none' | 'configured';
    readonly activation?: 'enabled' | 'disabled';
    readonly clef?: boolean;
    readonly count?: number;
    readonly sourceSections?: readonly string[];
    readonly budgetMicros?: number;
    readonly gatewayId?: string;
  } = {},
  database: QflowDatabase = db,
) {
  await withEnrichmentWorkspace(async (ctx) => {
    try {
      const originId = crypto.randomUUID(), destinationId = crypto.randomUUID();
      await database.insert(bankCollections).values(
        [originId, destinationId].map((id, position) => ({
          id,
          tenantId: ctx.tenantId,
          name: `Collection ${position}`,
          description: '',
          position,
          createdAt: organizationNow(),
          updatedAt: organizationNow(),
        })),
      );
      const ids = await addEnrichmentQuestions(ctx, options.count ?? 3, database);
      const sourceId = crypto.randomUUID();
      if (options.sourceSections && options.sourceSections.length !== ids.length) {
        throw new Error('Source sections must match the fixture question count.');
      }
      await database.insert(organizationOrigins).values(
        ids.map((questionId, index) => ({
          questionId,
          tenantId: ctx.tenantId,
          collectionId: originId,
          source: options.sourceSections
            ? { sourceId, sectionKey: options.sourceSections[index] }
            : options.clef
            ? null
            : { sourceId, sectionKey: 'chapter-1' },
        })),
      );
      const schemeId = crypto.randomUUID(),
        versionId = crypto.randomUUID(),
        setupId = crypto.randomUUID();
      const scheme = await new BankEnrichmentStore(database, organizationNow).saveVersion(ctx, {
        id: versionId,
        schemeId,
        expectedVersion: 0,
        definition: {
          ...enrichmentDefinitionFixture(),
          ...(options.difficulty === 'none' ? { difficulty: [] } : {}),
        },
      });
      if (!scheme.ok) throw new Error('Organization fixture vocabulary failed.');
      const setup = await saveOrganizationSetup(database, ctx, {
        id: setupId,
        collectionId: originId,
        expectedVersion: 0,
        policy: {
          versionId,
          classifier: options.clef
            ? {
              kind: 'clef',
              config: {
                ...organizationConfig,
                gatewayId: options.gatewayId ?? organizationConfig.gatewayId,
                budgetMicros: options.budgetMicros ?? organizationConfig.budgetMicros,
              },
            }
            : { kind: 'source_only' },
          filing: [{ topicId: 'cells', collectionId: destinationId }],
          sourceMappings: options.clef
            ? []
            : [{ sourceId, sectionKey: 'chapter-1', topicId: 'cells' }],
        },
      }, organizationNow());
      if (!setup.ok) throw new Error('Organization fixture setup failed.');
      if (options.activation !== 'disabled') {
        const activated = await setOrganizationActivation(database, ctx, {
          collectionId: originId,
          setupId,
          expectedRevision: 0,
          operationId: crypto.randomUUID(),
        }, organizationNow());
        if (!activated.ok) throw new Error('Organization fixture activation failed.');
      }
      const runId = crypto.randomUUID();
      const queued = await database.transaction((tx) =>
        queueOrganizationInTransaction(
          tx,
          ctx,
          { id: runId, setupId, mode: 'apply', questionIds: ids },
          organizationNow(),
        )
      );
      if (!queued.ok) throw new Error('Organization fixture queue failed.');
      const [run] = await database.select().from(organizationRuns).where(
        eq(organizationRuns.id, runId),
      );
      await test({
        ctx,
        ids,
        setupId,
        versionId,
        schemeId,
        originId,
        destinationId,
        runId,
        sourceId,
        params: { jobId: runId, workflowExecutionId: run.executionId },
      });
    } finally {
      for (
        const table of [
          organizationAttempts,
          organizationItems,
          organizationRuns,
          organizationOrigins,
          organizationActivation,
          organizationSetups,
          organizationFiling,
          bankCollectionItems,
          editorialEvents,
          bankCollections,
        ]
      ) {
        await database.delete(table).where(eq(table.tenantId, ctx.tenantId));
      }
    }
  }, database);
}
