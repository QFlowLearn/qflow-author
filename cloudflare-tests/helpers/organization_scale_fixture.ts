import { expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../lib/db.ts';
import { bankCollectionItems, bankCollections, editorialEvents } from '../../lib/db/bank_schema.ts';
import {
  organizationActivation,
  organizationAttempts,
  organizationFiling,
  organizationItems,
  organizationOrigins,
  organizationRuns,
  organizationSetups,
} from '../../lib/db/question_organization_schema.ts';
import { auditLogs, migrationBatches, workflowDispatches } from '../../lib/db/schema.ts';
import { enqueueMigrationBatch } from '../../lib/import/migration_enqueue.ts';
import { claimMigrationRun } from '../../lib/import/migration_jobs.ts';
import { processClaimedMigrationRun } from '../../lib/import/migration_processor.ts';
import { getMigrationRun } from '../../lib/import/migration_run_queries.ts';
import { updateMigrationItems } from '../../lib/import/migration_run_review.ts';
import { assignMigrationBatchReviewer } from '../../lib/import/migration_batches.ts';
import {
  decideMigrationRunApproval,
  submitMigrationRunForApproval,
} from '../../lib/import/migration_approvals.ts';
import { BankEnrichmentStore } from '../../lib/services/bank_enrichment_store.ts';
import { saveOrganizationSetup } from '../../lib/services/question_organization_store.ts';
import { setOrganizationActivation } from '../../lib/services/question_organization_activation.ts';
import type { ObjectStorage } from '../../lib/storage_contract.ts';
import type { RequestContext } from '../../lib/tenants.ts';
import { enrichmentDefinitionFixture } from '../../tests/bank_enrichment_fixture.ts';
import { withEnrichmentWorkspace } from '../../tests/helpers/enrichment_workspace.ts';

export const scaleQuestionCount = 10000;

/** Synthetic distinct questions keep the durability gate independent of network datasets and AI. */
function sourceXml(): Uint8Array {
  const questions = Array.from({ length: scaleQuestionCount }, (_, index) => `
    <question type="multichoice">
      <name><text>Cell case ${index + 1}</text></name>
      <questiontext format="html"><text>Case ${
    index + 1
  }: which structure contains DNA?</text></questiontext>
      <single>true</single>
      <answer fraction="100"><text>Nucleus</text></answer>
      <answer fraction="0"><text>Cell wall</text></answer>
    </question>`);
  return new TextEncoder().encode(`<?xml version="1.0"?><quiz>
    <question type="category"><category><text>Biology/Cells</text></category></question>
    ${questions.join('\n')}</quiz>`);
}

export async function withOrganizationScaleImport(
  storage: ObjectStorage,
  test: (fixture: {
    ctx: RequestContext;
    originId: string;
    destinationId: string;
    runId: string;
    approvedIds: string[];
  }) => Promise<void>,
) {
  await withEnrichmentWorkspace(async (ctx) => {
    try {
      const originId = crypto.randomUUID(), destinationId = crypto.randomUUID();
      await db.insert(bankCollections).values([originId, destinationId].map((id, position) => ({
        id,
        tenantId: ctx.tenantId,
        name: `Scale collection ${position}`,
        description: '',
        position,
        createdAt: new Date(),
        updatedAt: new Date(),
      })));
      const batch = await enqueueMigrationBatch(ctx, {
        idempotencyKey: crypto.randomUUID(),
        purpose: 'recover_existing',
        destination: { _tag: 'WorkspaceBank', collectionId: originId },
        sources: [{
          source: { filename: 'cells-10000.xml', mime: 'application/xml', bytes: sourceXml() },
          adapter: { id: 'moodle_xml', version: '1' },
        }],
      }, { storage });
      const runId = batch.runs[0].id;
      const [dispatch] = await db.select().from(workflowDispatches).where(
        eq(workflowDispatches.jobId, runId),
      );
      const claim = await claimMigrationRun(runId, dispatch.id);
      if (!claim) throw new Error('Scale source was not claimable');
      expect((await processClaimedMigrationRun(claim, { storage }))._tag).toBe('Success');
      const run = await getMigrationRun(ctx, runId);
      if (!run) throw new Error('Scale source was not persisted');
      expect(run.execution._tag).toBe('Analyzed');
      expect(run.summary.counts.blocked).toBe(0);
      expect(run.items).toHaveLength(scaleQuestionCount);
      expect(run.organizationGroups).toHaveLength(1);
      const original = run.artifacts.find((artifact) => artifact.kind === 'original');
      if (!original) throw new Error('Scale source artifact is missing');
      const versionId = crypto.randomUUID(), setupId = crypto.randomUUID();
      expect(
        (await new BankEnrichmentStore(db, () => new Date()).saveVersion(ctx, {
          id: versionId,
          schemeId: crypto.randomUUID(),
          expectedVersion: 0,
          definition: { ...enrichmentDefinitionFixture(), difficulty: [] },
        })).ok,
      ).toBe(true);
      expect(
        (await saveOrganizationSetup(db, ctx, {
          id: setupId,
          collectionId: originId,
          expectedVersion: 0,
          policy: {
            versionId,
            classifier: { kind: 'source_only' },
            filing: [{ topicId: 'cells', collectionId: destinationId }],
            sourceMappings: [{
              sourceId: original.id,
              sectionKey: run.organizationGroups[0].id,
              topicId: 'cells',
            }],
          },
        }, new Date())).ok,
      ).toBe(true);
      expect(
        (await setOrganizationActivation(db, ctx, {
          collectionId: originId,
          setupId,
          expectedRevision: 0,
          operationId: crypto.randomUUID(),
        }, new Date())).ok,
      ).toBe(true);
      for (let offset = 0; offset < scaleQuestionCount; offset += 100) {
        const page = run.items.slice(offset, offset + 100);
        await updateMigrationItems(
          ctx,
          runId,
          page.map((item) => item.id),
          { kind: 'accept' },
          Object.fromEntries(page.map((item) => [item.id, {
            contentHash: item.contentHash,
            contextHash: item.contextHash,
            decision: item.decision,
          }])),
        );
      }
      await assignMigrationBatchReviewer(ctx, batch.id, ctx.userId);
      await submitMigrationRunForApproval(ctx, runId);
      await decideMigrationRunApproval(ctx, runId, { decision: 'approve' });
      await test({
        ctx,
        originId,
        destinationId,
        runId,
        approvedIds: run.items.map((item) => item.id),
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
          migrationBatches,
          bankCollections,
          auditLogs,
        ]
      ) await db.delete(table).where(eq(table.tenantId, ctx.tenantId));
    }
  });
}
