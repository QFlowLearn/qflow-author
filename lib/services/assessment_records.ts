import { readAssessmentParts } from './assessment_structure_read.ts';
import { AdaptiveAssessmentMembershipError } from './assessment_membership.ts';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  type AssessmentBlueprint,
  parseAssessmentBlueprint,
  UNSPECIFIED_ASSESSMENT_BLUEPRINT,
} from '../assessment_blueprint.ts';
import { db, type DbReadConnection, type QflowDatabase } from '../db.ts';
import { assessmentQuestionDefaults } from '../db/assessment_question_defaults_schema.ts';
import { readAssessmentQuestionPointDefault } from './assessment_question_defaults.ts';
import { lockWorkspaceAndRequireAuthority } from './workspace_authorization.ts';
import {
  assessmentAdaptivePlans,
  assessmentParts,
  assessmentPlacements,
  assessments,
  users,
} from '../db/schema.ts';
import { type AdaptiveAssessmentPlan, parseAdaptivePlan } from '../assessment_adaptive_plan.ts';
import { type RequestContext, resolveUserId } from '../tenants.ts';
import {
  type AssessmentPart,
  type AssessmentPartInput,
  type AssessmentTransaction,
  replaceAssessmentPartsInTransaction,
} from './assessment_structure.ts';

/** Complete assessment record returned to authoring and export callers. */
export type AssessmentRecord = {
  adaptivePlan?: AdaptiveAssessmentPlan;
  id: string;
  title: string;
  brief?: string | null;
  gradeLevel?: string | null;
  targetCount: number;
  attachmentId?: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  blueprint: AssessmentBlueprint;
  createdAt: string;
  updatedAt: string;
  parts: AssessmentPart[];
};

/** Mutable assessment attributes accepted by record persistence. */
export type AssessmentAttributes = {
  title: string;
  brief?: string | null;
  gradeLevel?: string | null;
  targetCount?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
  attachmentId?: string | null;
  blueprint: AssessmentBlueprint;
};

/** Complete assessment creation command, including optional structure. */
export type AssessmentCreateInput = AssessmentAttributes & {
  id?: string;
  parts?: AssessmentPartInput[];
};

/** List the most recently updated assessments visible to one tenant. */
export async function listAssessments(ctx: RequestContext, limit = 20) {
  const rows = await db.select({
    id: assessments.id,
    title: assessments.title,
    brief: assessments.brief,
    updatedAt: assessments.updatedAt,
    createdAt: assessments.createdAt,
    targetCount: assessments.targetCount,
    status: assessments.status,
    createdBy: assessments.createdBy,
    metadata: assessments.metadata,
    ownerName: users.displayName,
    ownerEmail: users.email,
    partsCount: sql<number>`COUNT(DISTINCT ${assessmentParts.id})::integer`,
    itemsCount: sql<number>`COUNT(${assessmentPlacements.questionId})::integer`,
  })
    .from(assessments)
    .leftJoin(assessmentParts, eq(assessmentParts.assessmentId, assessments.id))
    .leftJoin(assessmentPlacements, eq(assessmentPlacements.assessmentPartId, assessmentParts.id))
    .leftJoin(users, eq(users.id, assessments.createdBy))
    .where(eq(assessments.tenantId, ctx.tenantId))
    .groupBy(assessments.id, users.displayName, users.email)
    .orderBy(desc(assessments.updatedAt))
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    title: row.title ?? 'Untitled Assessment',
    brief: row.brief ?? undefined,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : undefined,
    createdAt: row.createdAt ? row.createdAt.toISOString() : undefined,
    targetCount: row.targetCount ?? 0,
    status: row.status ?? 'draft',
    createdBy: row.createdBy ?? undefined,
    metadata: row.metadata ?? undefined,
    ownerName: row.ownerName ?? undefined,
    ownerEmail: row.ownerEmail ?? undefined,
    partsCount: row.partsCount ?? 0,
    itemsCount: row.itemsCount ?? 0,
  }));
}

/** Create the canonical empty assessment structure for a new draft. */
export async function createAssessmentDraft(
  ctx: RequestContext,
  attrs: Partial<AssessmentAttributes> = {},
) {
  return await saveAssessment(ctx, {
    title: attrs.title ?? 'Untitled Assessment',
    brief: attrs.brief,
    gradeLevel: attrs.gradeLevel,
    targetCount: attrs.targetCount ?? 0,
    tags: attrs.tags,
    metadata: attrs.metadata,
    attachmentId: attrs.attachmentId,
    blueprint: attrs.blueprint ?? UNSPECIFIED_ASSESSMENT_BLUEPRINT,
    parts: [{ title: 'Part 1', placements: [] }],
  });
}

/** Expected public command rejection; rejected commands never write assessment rows. */
export type AssessmentMutationRejection = {
  readonly _tag: 'Rejected';
  readonly code: 'forbidden' | 'assessment_not_found' | 'adaptive_managed';
};

/** Public save outcome after persisted workspace authority is verified. */
export type AssessmentSaveResult =
  | { readonly _tag: 'Saved'; readonly id: string }
  | AssessmentMutationRejection;

class AssessmentNotFoundError extends Error {}

/** Persist an assessment atomically after locking and rereading current membership. */
export async function saveAssessment(
  ctx: RequestContext,
  input: AssessmentCreateInput,
): Promise<AssessmentSaveResult> {
  try {
    return await db.transaction(async (tx): Promise<AssessmentSaveResult> => {
      if (!await lockWorkspaceAndRequireAuthority(tx, ctx, { capability: 'manage_content' })) {
        return { _tag: 'Rejected', code: 'forbidden' };
      }
      const saved = await saveAssessmentInTransaction(tx, ctx, input);
      return { _tag: 'Saved', id: saved.id };
    });
  } catch (cause: unknown) {
    if (cause instanceof AssessmentNotFoundError) {
      return { _tag: 'Rejected', code: 'assessment_not_found' };
    }
    if (cause instanceof AdaptiveAssessmentMembershipError) {
      return { _tag: 'Rejected', code: 'adaptive_managed' };
    }
    throw cause;
  }
}

/** Persist inside an orchestration transaction that already holds workspace authority. */
export async function saveAssessmentInTransaction(
  tx: AssessmentTransaction,
  ctx: RequestContext,
  input: AssessmentCreateInput,
) {
  const id = input.id ?? crypto.randomUUID();
  const existing = await tx.select({ tenantId: assessments.tenantId })
    .from(assessments)
    .where(eq(assessments.id, id))
    .for('update')
    .limit(1);
  if (existing.length && existing[0].tenantId !== ctx.tenantId) {
    throw new AssessmentNotFoundError('Assessment not found');
  }
  const [adaptive] = existing.length
    ? await tx.select().from(assessmentAdaptivePlans).where(
      eq(assessmentAdaptivePlans.assessmentId, id),
    )
    : [];
  const adaptivePlan = adaptive ? parseAdaptivePlan(adaptive.document) : null;
  if (adaptive && !adaptivePlan) throw new Error('Invalid persisted adaptive assessment plan.');
  if (
    adaptivePlan && input.targetCount !== undefined &&
    input.targetCount !== adaptivePlan.settings.questionCount
  ) throw new AdaptiveAssessmentMembershipError();
  const now = new Date();
  const tags = normalizeTags(input.tags);
  const blueprint = parseAssessmentBlueprint(input.blueprint);
  if (existing.length) {
    await tx.update(assessments).set({
      title: input.title ?? 'Untitled Assessment',
      brief: input.brief ?? null,
      gradeLevel: input.gradeLevel ?? null,
      targetCount: adaptivePlan?.settings.questionCount ?? input.targetCount ?? 0,
      tags,
      metadata: input.metadata ?? {},
      blueprint,
      attachmentId: input.attachmentId ?? null,
      updatedAt: sql`now()`,
    }).where(and(eq(assessments.id, id), eq(assessments.tenantId, ctx.tenantId)));
  } else {
    await tx.insert(assessments).values({
      id,
      tenantId: ctx.tenantId,
      slug: id,
      title: input.title ?? 'Untitled Assessment',
      status: 'draft',
      createdBy: resolveUserId(ctx),
      brief: input.brief ?? null,
      gradeLevel: input.gradeLevel ?? null,
      targetCount: input.targetCount ?? 0,
      tags,
      metadata: input.metadata ?? {},
      blueprint,
      attachmentId: input.attachmentId ?? null,
      createdAt: now,
      updatedAt: now,
    });
  }
  if (input.parts !== undefined) {
    await replaceAssessmentPartsInTransaction(tx, ctx, id, input.parts);
  }
  return { id };
}

/** Load one complete tenant-owned assessment record and ordered structure. */
export async function getAssessment(
  ctx: RequestContext,
  id: string,
  database: DbReadConnection = db,
): Promise<AssessmentRecord | null> {
  const meta = await database.select({
    id: assessments.id,
    title: assessments.title,
    brief: assessments.brief,
    gradeLevel: assessments.gradeLevel,
    targetCount: assessments.targetCount,
    attachmentId: assessments.attachmentId,
    tags: assessments.tags,
    metadata: assessments.metadata,
    blueprint: assessments.blueprint,
    createdAt: assessments.createdAt,
    updatedAt: assessments.updatedAt,
  })
    .from(assessments)
    .where(and(eq(assessments.id, id), eq(assessments.tenantId, ctx.tenantId)))
    .limit(1);
  const row = meta[0];
  if (!row) return null;
  const [savedPlan] = await database.select().from(assessmentAdaptivePlans).where(
    eq(assessmentAdaptivePlans.assessmentId, id),
  );
  const adaptivePlan = savedPlan ? parseAdaptivePlan(savedPlan.document) : null;
  if (savedPlan && !adaptivePlan) throw new Error('Invalid persisted adaptive assessment plan.');

  const parts = await readAssessmentParts(database, id);
  return {
    id: row.id,
    title: row.title ?? 'Untitled Assessment',
    brief: row.brief,
    ...(adaptivePlan ? { adaptivePlan } : {}),
    gradeLevel: row.gradeLevel,
    targetCount: row.targetCount ?? 0,
    attachmentId: row.attachmentId ?? undefined,
    tags: Array.isArray(row.tags) ? row.tags : [],
    metadata: typeof row.metadata === 'object' && row.metadata ? row.metadata : {},
    blueprint: parseAssessmentBlueprint(row.blueprint),
    createdAt: row.createdAt ? row.createdAt.toISOString() : new Date(0).toISOString(),
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : new Date(0).toISOString(),
    parts,
  };
}

/** Resolve the tenant that owns an assessment without exposing its record. */
export async function getAssessmentTenantId(id: string): Promise<string | null> {
  const rows = await db.select({ tenantId: assessments.tenantId })
    .from(assessments)
    .where(eq(assessments.id, id))
    .limit(1);
  return rows[0]?.tenantId ?? null;
}

/** Delete outcome after checking persisted workspace authority. */
export type AssessmentDeleteResult =
  | { readonly _tag: 'Deleted' }
  | { readonly _tag: 'Rejected'; readonly code: 'forbidden' | 'assessment_not_found' };

/** Delete one tenant-owned assessment under the workspace authorization lock. */
export async function deleteAssessment(
  ctx: RequestContext,
  id: string,
): Promise<AssessmentDeleteResult> {
  return await db.transaction(async (tx) => {
    if (!await lockWorkspaceAndRequireAuthority(tx, ctx, { capability: 'manage_content' })) {
      return { _tag: 'Rejected', code: 'forbidden' };
    }
    const deleted = await tx.delete(assessments).where(
      and(eq(assessments.id, id), eq(assessments.tenantId, ctx.tenantId)),
    ).returning({ id: assessments.id });
    return deleted.length
      ? { _tag: 'Deleted' }
      : { _tag: 'Rejected', code: 'assessment_not_found' };
  });
}

/** Duplicate one complete assessment through the canonical save path. */
export type AssessmentDuplicateResult =
  | { readonly _tag: 'Duplicated'; readonly id: string }
  | {
    readonly _tag: 'Rejected';
    readonly code: 'forbidden' | 'assessment_not_found' | 'adaptive_managed';
  };

/** Copy the locked source and its shared new-question policy in one transaction. */
export async function duplicateAssessment(
  ctx: RequestContext,
  sourceId: string,
  database: QflowDatabase = db,
): Promise<AssessmentDuplicateResult> {
  return await database.transaction(async (tx) => {
    if (!await lockWorkspaceAndRequireAuthority(tx, ctx, { capability: 'manage_content' })) {
      return { _tag: 'Rejected', code: 'forbidden' };
    }
    const [locked] = await tx.select({ id: assessments.id }).from(assessments).where(and(
      eq(assessments.id, sourceId),
      eq(assessments.tenantId, ctx.tenantId),
    )).for('update');
    if (!locked) return { _tag: 'Rejected', code: 'assessment_not_found' };
    const source = await getAssessment(ctx, sourceId, tx);
    if (!source) throw new Error('Locked assessment disappeared.');
    if (source.adaptivePlan) return { _tag: 'Rejected', code: 'adaptive_managed' };
    const newId = crypto.randomUUID();
    const pointDefault = await readAssessmentQuestionPointDefault(ctx, sourceId, tx);
    if (pointDefault._tag !== 'Found') throw new Error('Locked assessment disappeared.');
    await saveAssessmentInTransaction(tx, ctx, {
      id: newId,
      title: `${source.title} (Copy)`,
      brief: source.brief ?? null,
      gradeLevel: source.gradeLevel ?? null,
      targetCount: source.targetCount,
      tags: source.tags,
      metadata: source.metadata,
      blueprint: source.blueprint,
      attachmentId: source.attachmentId ?? null,
      parts: source.parts.map((part) => ({
        title: part.title,
        options: part.options,
        placements: part.placements.map((placement) =>
          'content' in placement ? { content: placement.content, fixed: true as const } : ({
            itemId: placement.itemId,
            snapshotRev: placement.snapshotRev,
            blueprintTargetId: placement.blueprintTargetId,
            fixed: placement.fixed,
          })
        ),
      })),
    });
    if (pointDefault.value !== null) {
      await tx.insert(assessmentQuestionDefaults).values({
        assessmentId: newId,
        maximumScore: pointDefault.value,
      });
    }
    return { _tag: 'Duplicated', id: newId };
  });
}

function normalizeTags(tags?: string[] | null): string[] {
  if (!Array.isArray(tags)) return [];
  return Array.from(new Set(tags.map((tag) => String(tag).trim()).filter((tag) => tag.length > 0)));
}
