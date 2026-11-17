import { expect, test as testCase } from 'vitest';

import * as _fs from 'node:fs/promises';

import { eq } from 'drizzle-orm';

import { db, shutdownDb } from '../lib/db.ts';
import {
  assessmentExportReceipts,
  assessmentParts,
  assessmentPlacements,
  assessments,
  auditLogs,
  migrationBatches,
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
import { enqueueMigrationBatch } from '../lib/import/migration_enqueue.ts';
import { commitMigrationRun } from '../lib/import/migration_run_commit.ts';
import { getMigrationRun } from '../lib/import/migration_run_queries.ts';
import {
  updateMigrationItems,
  updateMigrationRunBlueprint,
} from '../lib/import/migration_run_review.ts';
import type { ObjectStorage } from '../lib/storage_contract.ts';
import type { RequestContext } from '../lib/tenants.ts';
import { runSourceMigrationWorkflow } from '../lib/workflows/job_workflows.ts';
import { packageApiRoute as packageHandlerEndpoint } from '../lib/http/routes/assessment_api/package.ts';
import { validateApiRoute as validateHandlerEndpoint } from '../lib/http/routes/assessment_api/validate.ts';
import { invokeHttpRoute, makeHttpRequest } from './helpers/http_route.ts';
import { testAssessmentBlueprint } from './assessment_blueprint_fixture.ts';
import { createMemoryObjectStorage } from './memory_object_storage.ts';

const packageHandler = packageHandlerEndpoint.handle;
const validateHandler = validateHandlerEndpoint.handle;

const FIXTURES = new URL('fixtures/import/respondus/', import.meta.url);

testCase('Respondus TXT and DOCX reach review, commit, and destination-bound export', async () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const ctx: RequestContext = { tenantId, userId, role: 'owner' };
  let assessmentId: string | null = null;
  const storage = createMemoryObjectStorage();

  try {
    const email = `respondus-${tenantId.slice(0, 8)}@example.com`;
    await db.insert(tenants).values({
      id: tenantId,
      slug: `respondus-${tenantId.slice(0, 8)}`,
      name: 'Respondus Integration Tenant',
    });
    await db.insert(users).values({ id: userId, email, emailNormalized: email });
    await db.insert(organizationMemberships).values({
      id: crypto.randomUUID(),
      tenantId,
      userId,
      role: 'owner',
    });

    const textBytes = await _fs.readFile(new URL('standard-format.txt', FIXTURES));
    const docxBytes = await _fs.readFile(new URL('word-visible-numbering.docx', FIXTURES));
    const batch = await enqueueMigrationBatch(ctx, {
      idempotencyKey: crypto.randomUUID(),
      destination: { _tag: 'Assessment' as const },
      purpose: 'recover_existing',
      sources: [
        {
          source: { filename: 'standard-format.txt', mime: 'text/plain', bytes: textBytes },
          adapter: { id: 'respondus-standard', version: '1' },
        },
        {
          source: {
            filename: 'word-visible-numbering.docx',
            mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            bytes: docxBytes,
          },
          adapter: { id: 'respondus-standard', version: '1' },
        },
      ],
    }, { storage });
    for (const run of batch.runs) {
      const dispatches = await db.select({ id: workflowDispatches.id }).from(workflowDispatches)
        .where(eq(workflowDispatches.jobId, run.id)).limit(1);
      const workflowExecutionId = dispatches[0]?.id;
      if (!workflowExecutionId) throw new Error('Expected source Workflow execution.');
      const result = await runSourceMigrationWorkflow(
        { jobId: run.id, workflowExecutionId },
        {
          do: (_name, _config, operation) => operation(),
          sleep: () => Promise.resolve(),
        },
        { database: db, storage },
      );
      expect(result._tag).toStrictEqual('Completed');
    }

    const textRun = await getMigrationRun(ctx, batch.runs[0].id);
    const docxRun = await getMigrationRun(ctx, batch.runs[1].id);
    if (!textRun) expect.unreachable('Expected textRun');
    if (!docxRun) expect.unreachable('Expected docxRun');
    expect(textRun.execution._tag).toStrictEqual('Analyzed');
    expect(docxRun.execution._tag).toStrictEqual('Analyzed');
    expect(textRun.adapter.id).toStrictEqual('respondus-standard');
    expect(docxRun.adapter.id).toStrictEqual('respondus-standard');
    expect(textRun.summary.sniff?.confidence).toStrictEqual(0.98);
    expect(docxRun.summary.sniff?.confidence).toStrictEqual(0.98);
    expect(textRun.items.length).toStrictEqual(6);
    expect(docxRun.items.length).toStrictEqual(2);
    expect(textRun.items.every(hasBlockEvidence)).toStrictEqual(true);
    expect(docxRun.items.every(hasBlockEvidence)).toStrictEqual(true);
    expect(
      textRun.artifacts.find((artifact) => artifact.kind === 'normalized')?.document.sourceKind,
    ).toStrictEqual('text');
    expect(
      docxRun.artifacts.find((artifact) => artifact.kind === 'normalized')?.document.sourceKind,
    ).toStrictEqual('docx');

    const itemTypes = Array.from(new Set(docxRun.items.map((item) => item.itemType)));
    await updateMigrationRunBlueprint(
      ctx,
      docxRun.id,
      testAssessmentBlueprint(itemTypes.map((questionType) => ({
        id: `${questionType}-target`,
        questionType,
        count: docxRun.items.filter((item) => item.itemType === questionType).length,
      }))),
    );
    for (const questionType of itemTypes) {
      const current = await getMigrationRun(ctx, docxRun.id);
      if (!current) throw new Error('Respondus conversion disappeared during alignment.');
      const items = current.items.filter((item) => item.itemType === questionType);
      await updateMigrationItems(
        ctx,
        docxRun.id,
        items.map((item) => item.id),
        { kind: 'align_blueprint_target', targetId: `${questionType}-target` },
        Object.fromEntries(items.map((item) => [item.id, {
          contentHash: item.contentHash,
          contextHash: item.contextHash,
          decision: item.decision,
        }])),
      );
    }
    const aligned = await getMigrationRun(ctx, docxRun.id);
    if (!aligned) throw new Error('Respondus conversion disappeared before acceptance.');
    await updateMigrationItems(
      ctx,
      docxRun.id,
      aligned.items.map((item) => item.id),
      { kind: 'accept' },
      Object.fromEntries(aligned.items.map((item) => [item.id, {
        contentHash: item.contentHash,
        contextHash: item.contextHash,
        decision: item.decision,
      }])),
    );
    const accepted = await getMigrationRun(ctx, docxRun.id);
    if (!accepted) expect.unreachable('Expected accepted');
    expect(accepted.items.every((item) => item.decision === 'accepted')).toStrictEqual(true);
    await assignMigrationBatchReviewer(ctx, batch.id, userId);
    await submitMigrationRunForApproval(ctx, docxRun.id);
    await decideMigrationRunApproval(ctx, docxRun.id, { decision: 'approve' });
    const committed = await commitMigrationRun(ctx, docxRun.id, {
      storage,
      approvedItemIds: accepted.items.map((item) => item.id),
      approval: true,
    });
    if (!(committed.destination._tag === 'Assessment')) {
      expect.unreachable("Expected committed.destination._tag === 'Assessment'");
    }
    assessmentId = committed.destination.assessmentId;
    expect(committed.itemResults.length).toStrictEqual(2);
    expect((await getMigrationRun(ctx, docxRun.id))?.execution._tag).toStrictEqual('Committed');

    const canvas = await exportAssessment(ctx, assessmentId, 'canvas-classic', storage);
    expect(canvas.headers.get('content-type')).toStrictEqual('application/zip');
    expect(canvas.headers.get('x-qflow-export-target-contract')).toStrictEqual(
      'canvas-classic-quizzes@1',
    );
    expect(canvas.headers.get('x-qflow-export-warning-codes')).toStrictEqual(null);

    const moodle = await exportAssessment(ctx, assessmentId, 'moodle', storage);
    expect(moodle.headers.get('content-type')).toStrictEqual('application/xml');
    expect(moodle.headers.get('x-qflow-export-target-contract')).toStrictEqual('moodle-xml@1');
    expect((await moodle.text()).includes('<quiz>')).toStrictEqual(true);
  } finally {
    try {
      await db.delete(workflowDispatches).where(eq(workflowDispatches.tenantId, tenantId));
      await db.delete(assessmentExportReceipts).where(
        eq(assessmentExportReceipts.tenantId, tenantId),
      );
      await db.delete(migrationBatches).where(eq(migrationBatches.tenantId, tenantId));
      if (assessmentId) {
        const parts = await db.select({ id: assessmentParts.id })
          .from(assessmentParts)
          .where(eq(assessmentParts.assessmentId, assessmentId));
        for (const part of parts) {
          await db.delete(assessmentPlacements).where(
            eq(assessmentPlacements.assessmentPartId, part.id),
          );
        }
        await db.delete(assessmentParts).where(eq(assessmentParts.assessmentId, assessmentId));
        await db.delete(assessments).where(eq(assessments.id, assessmentId));
      }
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
    } catch (_cause: unknown) {
      // Test cleanup is best effort when the database is unavailable.
    }
    await shutdownDb().catch(() => {});
  }
});

async function exportAssessment(
  auth: RequestContext,
  assessmentId: string,
  target: 'canvas-classic' | 'moodle',
  storage: ObjectStorage,
): Promise<Response> {
  const validateUrl = exportUrl(assessmentId, 'validate', target);
  const validateResponse = await invokeHttpRoute(
    validateHandler,
    makeHttpRequest(new Request(validateUrl), {
      params: { id: assessmentId },
      auth,
      state: { storage },
    }),
  );
  expect(validateResponse.status).toStrictEqual(200);
  const validatePayload: unknown = await validateResponse.json();
  const preflight = requireRecord(requireRecord(validatePayload).preflight);
  expect(preflight.overallOutcome).toStrictEqual('preserved');
  expect(preflight.warningCodes).toStrictEqual([]);
  expect(preflight.acknowledgementToken).toStrictEqual(null);
  expect(preflight.packageDiagnosticCodes).toStrictEqual([
    'product_import_evidence.not_recorded',
    'profile_release_evidence.not_recorded',
  ]);

  const packageUrl = exportUrl(assessmentId, 'package', target);
  packageUrl.searchParams.set('preflightId', requireString(preflight.preflightId));
  const packageResponse = await invokeHttpRoute(
    packageHandler,
    makeHttpRequest(new Request(packageUrl), {
      params: { id: assessmentId },
      auth,
      state: { storage },
    }),
  );
  expect(packageResponse.status).toStrictEqual(200);
  if (!(packageResponse.headers.get('x-qflow-export-receipt-id'))) {
    expect.unreachable("Expected packageResponse.headers.get('x-qflow-export-receipt-id')");
  }
  return packageResponse;
}

function exportUrl(
  assessmentId: string,
  route: 'validate' | 'package',
  target: 'canvas-classic' | 'moodle',
): URL {
  const url = new URL(`http://local/api/assessments/${assessmentId}/${route}`);
  url.searchParams.set('target', target);
  url.searchParams.set('scoring', 'automatic');
  url.searchParams.set('interaction', 'preserve');
  return url;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!(isRecord(value))) expect.unreachable('Expected isRecord(value)');
  return value;
}

function requireString(value: unknown): string {
  if (!(typeof value === 'string')) expect.unreachable("Expected typeof value === 'string'");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasBlockEvidence(item: {
  readonly evidence: ReadonlyArray<{ readonly kind: string; readonly artifactHash: string }>;
}): boolean {
  return item.evidence.some((entry) =>
    entry.kind === 'block' && /^[0-9a-f]{64}$/.test(entry.artifactHash)
  );
}
