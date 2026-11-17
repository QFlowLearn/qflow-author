import { eq } from 'drizzle-orm';
import { db, type QflowDatabase } from '../../lib/db.ts';
import {
  enrichmentBatches,
  enrichmentRunItems,
  enrichmentRuns,
} from '../../lib/db/bank_enrichment_job_schema.ts';
import { enrichmentPreviews, enrichmentTasks } from '../../lib/db/bank_enrichment_task_schema.ts';
import { workflowDispatches } from '../../lib/db/workflow_canvas_schema.ts';
import {
  enrichmentBudgets,
  enrichmentUsageAttempts,
} from '../../lib/db/bank_enrichment_usage_schema.ts';
import {
  enrichmentAssignments,
  enrichmentChanges,
  enrichmentSchemes,
  enrichmentSchemeVersions,
  enrichmentSnapshotItems,
  enrichmentSnapshots,
} from '../../lib/db/bank_enrichment_schema.ts';
import { organizationMemberships, tenants, users } from '../../lib/db/principal_schema.ts';
import { questionRevisions, questions } from '../../lib/db/question_schema.ts';
import type { RequestContext } from '../../lib/tenants.ts';
import { prepareDriverDraftForBuild } from '../../lib/types/buildable_driver_draft.ts';
import { newAuthoringItemLanguage } from '../../lib/types/item_language.ts';
import { exportQti3AssessmentItemXml } from '../../lib/types/qti3_authoring.ts';
import { TYPE_DRIVERS } from '../../lib/types/registry.ts';
import { prepareQuestionRevision } from '../../lib/question_revision_preparation.ts';
import { saveQuestionRevisionInTransaction } from '../../lib/services/questions.ts';

/** Explicit local PostgreSQL fixture; cleanup contains only this newly created tenant. */
export async function withEnrichmentWorkspace(
  test: (ctx: RequestContext) => Promise<void>,
  database: QflowDatabase = db,
): Promise<void> {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const ctx: RequestContext = { tenantId, userId, role: 'owner' };
  try {
    await database.insert(tenants).values({
      id: tenantId,
      slug: tenantId,
      name: 'Enrichment analysis test',
    });
    await database.insert(users).values({
      id: userId,
      email: `${userId}@example.com`,
      emailNormalized: `${userId}@example.com`,
    });
    await database.insert(organizationMemberships).values({
      id: crypto.randomUUID(),
      tenantId,
      userId,
      role: 'owner',
    });
    await test(ctx);
  } finally {
    await database.delete(workflowDispatches).where(eq(workflowDispatches.tenantId, tenantId));
    await database.delete(enrichmentPreviews).where(eq(enrichmentPreviews.tenantId, tenantId));
    await database.delete(enrichmentTasks).where(eq(enrichmentTasks.tenantId, tenantId));
    await database.delete(enrichmentBatches).where(eq(enrichmentBatches.tenantId, tenantId));
    await database.delete(enrichmentRunItems).where(eq(enrichmentRunItems.tenantId, tenantId));
    await database.delete(enrichmentRuns).where(eq(enrichmentRuns.tenantId, tenantId));
    await database.delete(enrichmentAssignments).where(
      eq(enrichmentAssignments.tenantId, tenantId),
    );
    await database.delete(enrichmentChanges).where(eq(enrichmentChanges.tenantId, tenantId));
    await database.delete(enrichmentSchemeVersions).where(
      eq(enrichmentSchemeVersions.tenantId, tenantId),
    );
    await database.delete(enrichmentSchemes).where(eq(enrichmentSchemes.tenantId, tenantId));
    await database.delete(enrichmentUsageAttempts).where(
      eq(enrichmentUsageAttempts.tenantId, tenantId),
    );
    await database.delete(enrichmentBudgets).where(eq(enrichmentBudgets.tenantId, tenantId));
    await database.delete(enrichmentSnapshotItems).where(
      eq(enrichmentSnapshotItems.tenantId, tenantId),
    );
    await database.delete(enrichmentSnapshots).where(eq(enrichmentSnapshots.tenantId, tenantId));
    await database.update(questions).set({ latestRevisionId: null }).where(
      eq(questions.tenantId, tenantId),
    );
    await database.delete(questionRevisions).where(eq(questionRevisions.tenantId, tenantId));
    await database.delete(questions).where(eq(questions.tenantId, tenantId));
    await database.delete(organizationMemberships).where(
      eq(organizationMemberships.tenantId, tenantId),
    );
    await database.delete(tenants).where(eq(tenants.id, tenantId));
    await database.delete(users).where(eq(users.id, userId));
  }
}

/** Save real published revisions using the normal authoring boundary and QTI writer. */
export async function addEnrichmentQuestions(
  ctx: RequestContext,
  count: number,
  database: QflowDatabase = db,
  options: { readonly distinctContent: boolean } = { distinctContent: false },
): Promise<readonly string[]> {
  const ids: string[] = [];
  const batch = crypto.randomUUID();
  for (let index = 0; index < count; index++) {
    const questionId = crypto.randomUUID();
    const draft = {
      ...TYPE_DRIVERS.single_select.defaults(),
      itemLanguage: newAuthoringItemLanguage(),
      title: `Cell question ${index}`,
      promptHtml: `<p>Which structure contains DNA?</p>${
        options.distinctContent ? `<p>Case ${batch}-${index}.</p>` : ''
      }${index % 3 === 0 ? '<p>Consider the cell. </p>'.repeat(100) : ''}`,
      choices: [{ id: 'a', text: 'Nucleus' }, { id: 'b', text: 'Membrane' }],
      correctId: 'a',
    };
    const qtiXml = exportQti3AssessmentItemXml(
      'single_select',
      prepareDriverDraftForBuild('single_select', draft),
      { identifier: `enrichment-${index}` },
    );
    const prepared = await prepareQuestionRevision({
      questionId,
      title: draft.title,
      body: { ...draft, type: 'single_select' },
      tags: ['source-science'],
      provenance: { _tag: 'Authored' as const },
      qtiXml,
      draftState: 'published' as const,
    });
    await database.transaction((tx) => saveQuestionRevisionInTransaction(tx, ctx, prepared));
    ids.push(questionId);
  }
  return ids;
}
