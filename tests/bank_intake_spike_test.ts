import { expect, test as testCase } from 'vitest';

import * as _fs from 'node:fs/promises';
import { setOrganizationActivation } from '../lib/services/question_organization_activation.ts';
import {
  organizationActivation,
  organizationItems,
  organizationOrigins,
  organizationRuns,
  organizationSetups,
} from '../lib/db/question_organization_schema.ts';
import { enrichmentSchemes, enrichmentSchemeVersions } from '../lib/db/bank_enrichment_schema.ts';
import { BankEnrichmentStore } from '../lib/services/bank_enrichment_store.ts';
import { saveOrganizationSetup } from '../lib/services/question_organization_store.ts';
import { enrichmentDefinitionFixture } from './bank_enrichment_fixture.ts';
import { loadRevisionPublicationEligibility } from '../lib/services/publication_evidence.ts';
import { withZipArchive } from '../lib/zip_archive.ts';
import { writeZip } from '../lib/zip.ts';
import { questionReviewRequests } from '../lib/db/question_schema.ts';
import { loadReviewQueue } from '../lib/services/review_queue.ts';
import { editorialEvents } from '../lib/db/bank_schema.ts';

import { eq, sql } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { bankCollectionItems, bankCollections } from '../lib/db/bank_schema.ts';
import {
  assessments,
  auditLogs,
  migrationBatches,
  migrationRuns,
  organizationMemberships,
  questionRevisions,
  questions,
  tenants,
  users,
  workflowDispatches,
} from '../lib/db/schema.ts';
import { assignMigrationBatchReviewer } from '../lib/import/migration_batches.ts';
import {
  decideMigrationRunApproval,
  submitMigrationRunForApproval,
} from '../lib/import/migration_approvals.ts';
import {
  enqueueMigrationBatch,
  MigrationBatchConflictError,
} from '../lib/import/migration_enqueue.ts';
import { commitMigrationRun } from '../lib/import/migration_run_commit.ts';
import { getMigrationRun } from '../lib/import/migration_run_queries.ts';
import {
  updateMigrationItems,
  updateMigrationRunBlueprint,
} from '../lib/import/migration_run_review.ts';
import { runSourceMigrationWorkflow } from '../lib/workflows/job_workflows.ts';
import { UNSPECIFIED_ASSESSMENT_BLUEPRINT } from '../lib/assessment_blueprint.ts';
import { createMemoryObjectStorage } from './memory_object_storage.ts';
import type { RequestContext } from '../lib/tenants.ts';

for (const itemCount of [2, 200]) {
  testCase(
    `owned ${itemCount}-item bank intake preserves approval, rollback and replay without review assignments`,
    async () => {
      if (!(/test/.test(new URL(process.env['DATABASE_URL'] ?? '').pathname))) {
        expect.unreachable('Use an isolated test database.');
      }
      const tenantId = crypto.randomUUID();
      const userId = crypto.randomUUID();
      const collectionId = crypto.randomUUID();
      const ctx: RequestContext = { tenantId, userId, role: 'owner' };
      const storage = createMemoryObjectStorage();
      try {
        await db.insert(tenants).values({ id: tenantId, slug: tenantId, name: 'Bank spike' });
        await db.insert(users).values({
          id: userId,
          email: `${userId}@example.test`,
          emailNormalized: `${userId}@example.test`,
        });
        await db.insert(organizationMemberships).values({
          id: crypto.randomUUID(),
          tenantId,
          userId,
          role: 'owner',
        });
        await db.insert(bankCollections).values({
          id: collectionId,
          tenantId,
          name: 'Owned questions',
          description: '',
          position: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        // The larger import proves configured organization is captured by the real commit path.
        if (itemCount === 200) {
          const versionId = crypto.randomUUID(), setupId = crypto.randomUUID();
          if (
            !((await new BankEnrichmentStore(db, () => new Date()).saveVersion(ctx, {
              id: versionId,
              schemeId: crypto.randomUUID(),
              expectedVersion: 0,
              definition: enrichmentDefinitionFixture(),
            })).ok)
          ) {
            expect.unreachable(
              'Expected (await new BankEnrichmentStore(db, () => new Date()).saveVersion(ctx, { id: versionId, sch',
            );
          }
          if (
            !((await saveOrganizationSetup(db, ctx, {
              id: setupId,
              collectionId,
              expectedVersion: 0,
              policy: {
                versionId,
                classifier: { kind: 'source_only' },
                filing: [],
                sourceMappings: [],
              },
            }, new Date())).ok)
          ) {
            expect.unreachable(
              'Expected (await saveOrganizationSetup(db, ctx, { id: setupId, collectionId, expectedVersion: 0, pol',
            );
          }
        }
        if (itemCount === 200) {
          const [setup] = await db.select().from(organizationSetups).where(
            eq(organizationSetups.collectionId, collectionId),
          );
          if (
            !((await setOrganizationActivation(db, ctx, {
              collectionId,
              setupId: setup.id,
              operationId: crypto.randomUUID(),
              expectedRevision: 0,
            }, new Date())).ok)
          ) {
            expect.unreachable(
              'Expected (await setOrganizationActivation(db, ctx, { collectionId, setupId: setup.id, operationId: ',
            );
          }
        }
        const command = {
          idempotencyKey: crypto.randomUUID(),
          destination: { _tag: 'WorkspaceBank' as const, collectionId },
          purpose: 'recover_existing' as const,
          sources: [{
            source: {
              filename: 'word-visible-numbering.docx',
              mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              bytes: await ownedDocument(itemCount),
            },
            adapter: { id: 'respondus-standard', version: '1' },
          }],
        };
        await expect(
          Promise.resolve().then(() =>
            enqueueMigrationBatch(ctx, {
              ...command,
              destination: { _tag: 'WorkspaceBank', collectionId: crypto.randomUUID() },
            }, { storage })
          ),
        ).rejects.toSatisfy((caught: unknown) =>
          caught instanceof Error && caught.message.includes('unavailable')
        );
        const batch = await enqueueMigrationBatch(ctx, command, { storage });
        expect((await enqueueMigrationBatch(ctx, command, { storage })).id).toStrictEqual(batch.id);
        await expect(
          Promise.resolve().then(() =>
            enqueueMigrationBatch(ctx, { ...command, destination: { _tag: 'Assessment' } }, {
              storage,
            })
          ),
        ).rejects.toBeInstanceOf(MigrationBatchConflictError);
        const runId = batch.runs[0].id;
        const [dispatch] = await db.select({ id: workflowDispatches.id }).from(workflowDispatches)
          .where(eq(workflowDispatches.jobId, runId));
        expect(
          (await runSourceMigrationWorkflow({ jobId: runId, workflowExecutionId: dispatch.id }, {
            do: (_name, _config, operation) => operation(),
            sleep: () => Promise.resolve(),
          }, { database: db, storage }))._tag,
        ).toStrictEqual('Completed');
        const analyzed = await getMigrationRun(ctx, runId);
        if (!analyzed) expect.unreachable('Expected analyzed');
        expect(analyzed.destination).toStrictEqual(command.destination);
        expect(analyzed.items.length).toStrictEqual(itemCount);
        expect(analyzed.items.every((item) => item.blueprintTargetId === null)).toStrictEqual(true);
        const [stored] = await db.select({ blueprint: migrationRuns.blueprint }).from(migrationRuns)
          .where(eq(migrationRuns.id, runId));
        expect(stored.blueprint).toStrictEqual(null);
        await expect(
          Promise.resolve().then(() =>
            updateMigrationRunBlueprint(ctx, runId, UNSPECIFIED_ASSESSMENT_BLUEPRINT)
          ),
        ).rejects.toSatisfy((caught: unknown) =>
          caught instanceof Error && caught.message.includes('do not use assessment blueprints')
        );
        await updateMigrationItems(
          ctx,
          runId,
          analyzed.items.map((item) => item.id),
          { kind: 'accept' },
          Object.fromEntries(analyzed.items.map((item) => [item.id, {
            contentHash: item.contentHash,
            contextHash: item.contextHash,
            decision: item.decision,
          }])),
        );
        const options = {
          storage,
          approvedItemIds: analyzed.items.map((item) => item.id),
          approval: true,
        };
        await expect(Promise.resolve().then(() => commitMigrationRun(ctx, runId, options))).rejects
          .toSatisfy((caught: unknown) =>
            caught instanceof Error && caught.message.includes('reviewer must approve')
          );
        await assignMigrationBatchReviewer(ctx, batch.id, userId);
        await submitMigrationRunForApproval(ctx, runId);
        await decideMigrationRunApproval(ctx, runId, { decision: 'approve' });

        await db.execute(
          sql`CREATE FUNCTION fail_bank_spike_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'bank spike rollback'; END; $$`,
        );
        await db.execute(
          sql`CREATE TRIGGER fail_bank_spike_commit BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.action = 'migration_committed') EXECUTE FUNCTION fail_bank_spike_commit()`,
        );
        await expect(Promise.resolve().then(() => commitMigrationRun(ctx, runId, options))).rejects
          .toBeInstanceOf(Error);
        await db.execute(sql`DROP TRIGGER fail_bank_spike_commit ON audit_logs`);
        await db.execute(sql`DROP FUNCTION fail_bank_spike_commit()`);
        expect(await db.select().from(questions).where(eq(questions.tenantId, tenantId)))
          .toStrictEqual([]);
        expect(
          await db.select().from(bankCollectionItems).where(
            eq(bankCollectionItems.tenantId, tenantId),
          ),
        ).toStrictEqual([]);
        expect((await getMigrationRun(ctx, runId))?.execution._tag).toStrictEqual('Analyzed');
        expect(
          await db.select().from(organizationRuns).where(eq(organizationRuns.tenantId, tenantId)),
        ).toStrictEqual([]);
        expect(
          await db.select().from(editorialEvents).where(eq(editorialEvents.tenantId, tenantId)),
        ).toStrictEqual([]);

        const [first, concurrent] = await Promise.all([
          commitMigrationRun(ctx, runId, options),
          commitMigrationRun(ctx, runId, options),
        ]);
        expect(first).toStrictEqual(concurrent);
        const receipts = await db.select().from(editorialEvents).where(
          eq(editorialEvents.tenantId, tenantId),
        );
        expect(receipts.length).toStrictEqual(1);
        expect(receipts[0].action).toStrictEqual('AddItems');
        expect(await commitMigrationRun(ctx, runId, options)).toStrictEqual(first);
        expect(first.destination).toStrictEqual(command.destination);
        expect(first.itemResults.length).toStrictEqual(itemCount);
        const origins = await db.select().from(organizationOrigins).where(
          eq(organizationOrigins.tenantId, tenantId),
        );
        const artifact = analyzed.artifacts.find((a) => a.kind === 'original');
        if (!artifact) expect.unreachable('Expected artifact');
        expect(origins.length).toStrictEqual(itemCount);
        for (const origin of origins) {
          expect(origin.source, 'Synchronous bank commit must preserve the original source section')
            .toStrictEqual({ sourceId: artifact.id, sectionKey: 'respondus-file' });
        }
        const organization = await db.select().from(organizationRuns).where(
          eq(organizationRuns.tenantId, tenantId),
        );
        expect(organization.length).toStrictEqual(itemCount === 200 ? 1 : 0);
        if (itemCount === 200) {
          expect(organization[0].state).toStrictEqual('queued');
          expect(
            (await db.select().from(organizationItems).where(
              eq(organizationItems.runId, organization[0].id),
            )).length,
          ).toStrictEqual(itemCount);
          const pending = await db.select().from(workflowDispatches).where(
            eq(workflowDispatches.jobId, organization[0].id),
          );
          expect(pending.map((row) => [row.kind, row.state])).toStrictEqual([[
            'question_organization',
            'pending',
          ]]);
        }

        expect(await db.select().from(assessments).where(eq(assessments.tenantId, tenantId)))
          .toStrictEqual([]);
        const revisions = await db.select().from(questionRevisions).where(
          eq(questionRevisions.tenantId, tenantId),
        );
        expect(revisions.length).toStrictEqual(itemCount);
        const eligibility = await loadRevisionPublicationEligibility(
          db,
          ctx,
          revisions.map((row) => row.id),
        );
        if (!(eligibility.ok)) expect.unreachable('Expected eligibility.ok');
        expect(eligibility.revisions.length).toStrictEqual(itemCount);
        if (
          !(eligibility.revisions.every((row) =>
            row.kind === 'attestation_required' && row.intake?.migrationRunId === runId
          ))
        ) {
          expect.unreachable(
            "Expected eligibility.revisions.every((row) => row.kind === 'attestation_required' && row.intake?.mi",
          );
        }
        expect(
          await db.select().from(questionReviewRequests).where(
            eq(questionReviewRequests.tenantId, tenantId),
          ),
        ).toStrictEqual([]);
        expect((await loadReviewQueue(ctx, { view: 'open', before: null }))?.rows).toStrictEqual(
          [],
        );
        const committed = await getMigrationRun(ctx, runId);
        if (!committed) expect.unreachable('Expected committed');
        expect(committed.artifacts).toStrictEqual(analyzed.artifacts);
        expect(committed.items.map((item) => [item.id, item.sourceIdentifier, item.sourceHref]))
          .toStrictEqual(
            analyzed.items.map((item) => [item.id, item.sourceIdentifier, item.sourceHref]),
          );
        expect(
          (await db.select().from(bankCollectionItems).where(
            eq(bankCollectionItems.tenantId, tenantId),
          )).map((item) => item.questionId).sort(),
        ).toStrictEqual(first.itemResults.map((item) => item.questionId).sort());
        await db.delete(organizationMemberships).where(eq(organizationMemberships.userId, userId));
        expect(await getMigrationRun(ctx, runId)).toStrictEqual(null);
        await expect(Promise.resolve().then(() => commitMigrationRun(ctx, runId, options))).rejects
          .toSatisfy((caught: unknown) =>
            caught instanceof Error && caught.message.includes('not found')
          );
        await expect(Promise.resolve().then(() => enqueueMigrationBatch(ctx, command, { storage })))
          .rejects.toSatisfy((caught: unknown) =>
            caught instanceof Error && caught.message.includes('unavailable')
          );
      } finally {
        await db.execute(sql`DROP TRIGGER IF EXISTS fail_bank_spike_commit ON audit_logs`);
        await db.execute(sql`DROP FUNCTION IF EXISTS fail_bank_spike_commit()`);
        await db.delete(workflowDispatches).where(eq(workflowDispatches.tenantId, tenantId));
        await db.delete(migrationBatches).where(eq(migrationBatches.tenantId, tenantId));
        await db.delete(bankCollectionItems).where(eq(bankCollectionItems.tenantId, tenantId));
        await db.delete(editorialEvents).where(eq(editorialEvents.tenantId, tenantId));
        await db.delete(organizationItems).where(eq(organizationItems.tenantId, tenantId));
        await db.delete(organizationRuns).where(eq(organizationRuns.tenantId, tenantId));
        await db.delete(organizationActivation).where(
          eq(organizationActivation.tenantId, tenantId),
        );
        await db.delete(organizationSetups).where(eq(organizationSetups.tenantId, tenantId));
        await db.delete(enrichmentSchemeVersions).where(
          eq(enrichmentSchemeVersions.tenantId, tenantId),
        );
        await db.delete(enrichmentSchemes).where(eq(enrichmentSchemes.tenantId, tenantId));
        await db.delete(bankCollections).where(eq(bankCollections.tenantId, tenantId));
        await db.update(questions).set({ latestRevisionId: null }).where(
          eq(questions.tenantId, tenantId),
        );
        await db.delete(questionRevisions).where(eq(questionRevisions.tenantId, tenantId));
        await db.delete(questions).where(eq(questions.tenantId, tenantId));
        await db.delete(auditLogs).where(eq(auditLogs.tenantId, tenantId));
        await db.delete(organizationMemberships).where(
          eq(organizationMemberships.tenantId, tenantId),
        );
        await db.delete(users).where(eq(users.id, userId));
        await db.delete(tenants).where(eq(tenants.id, tenantId));
        await shutdownDb();
      }
    },
  );
}
/** Expand an owned Word fixture into numbered questions through its actual import adapter. */
async function ownedDocument(count: number): Promise<Uint8Array> {
  const bytes = await _fs.readFile(
    new URL('fixtures/import/respondus/word-visible-numbering.docx', import.meta.url),
  );
  if (count === 2) return bytes;
  return await withZipArchive(bytes, undefined, async (archive) => {
    const entries = [];
    for (const entry of Object.values(archive.files)) {
      if (entry.dir) continue;
      let data = await entry.async('uint8array');
      if (entry.name === 'word/document.xml') {
        const paragraphs = Array.from(
          { length: count },
          (
            _,
            index,
          ) => [
            `Title: Owned question ${index + 1}`,
            `${index + 1}. Which protocol carries web pages?`,
            '*a. HTTP',
            'b. SMTP',
            'c. SSH',
          ],
        )
          .flat().map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('');
        const xml = new TextDecoder().decode(data).replace(
          /<w:body>[\s\S]*<w:sectPr/,
          '<w:body>' + paragraphs + '<w:sectPr',
        );
        data = new TextEncoder().encode(xml);
      }
      entries.push({ name: entry.name, data });
    }
    return await writeZip(entries);
  });
}
