import { and, eq } from 'drizzle-orm';

import { UNSPECIFIED_ASSESSMENT_BLUEPRINT } from './assessment_blueprint.ts';
import { db } from './db.ts';
import { assessments } from './db/schema.ts';
import { DEMO_COMPATIBILITY } from './demo_compatibility.ts';
import {
  createDemoPresidentRevisionContent,
  DEMO_PRESIDENT_PARTS,
  DEMO_PRESIDENT_SOURCES,
  DEMO_PRESIDENTS_ASSESSMENT_BRIEF,
  DEMO_PRESIDENTS_DEFAULT_TAGS,
  DEMO_PRESIDENTS_VERSION,
  type DemoPresidentSource,
} from './demo_presidents_catalog.ts';
import {
  attachPreparedQuestionRevisionContext,
  type PreparedQuestionRevision,
  prepareQuestionRevisionFromPrecomputedCompatibility,
} from './question_revision_preparation.ts';
import { saveAssessmentInTransaction } from './services/assessment_records.ts';
import { refreshAuthoredQuestionRevisionsInTransaction } from './services/question_revision_persistence.ts';
import { type RequestContext, resolveUserId } from './tenants.ts';
import { uuidV5 } from './uuid_v5.ts';

type DemoRevisionContent = ReturnType<typeof createDemoPresidentRevisionContent>;
type PreparedDemoContent = {
  readonly source: DemoPresidentSource;
  readonly revision: PreparedQuestionRevision<DemoRevisionContent>;
};

let preparedDemoContent: Promise<readonly PreparedDemoContent[]> | undefined;

/** Ensure the current workspace has the canonical presidents assessment and return its ID. */
export async function ensureDemoPresidents(ctx: RequestContext): Promise<string> {
  const tenantId = ctx.tenantId;
  const assessmentId = await uuidV5(tenantId, 'demo:presidents:assessment');
  const existing = await db.select({ metadata: assessments.metadata }).from(assessments).where(and(
    eq(assessments.id, assessmentId),
    eq(assessments.tenantId, tenantId),
  )).limit(1);
  if (existing[0]?.metadata.demoVersion === DEMO_PRESIDENTS_VERSION) return assessmentId;

  const preparedContent = await prepareDemoContent();
  const preparedSeeds = await Promise.all(preparedContent.map(async (content) => {
    const questionId = await uuidV5(
      tenantId,
      `demo:presidents:question:${content.source.stableKey}`,
    );
    return {
      source: content.source,
      questionId,
      revision: attachPreparedQuestionRevisionContext(content.revision, { questionId }),
    };
  }));
  return await db.transaction(async (tx) => {
    await tx.insert(assessments).values({
      id: assessmentId,
      tenantId,
      slug: assessmentId,
      title: 'US Presidents Sampler',
      status: 'draft',
      createdBy: resolveUserId(ctx),
      targetCount: DEMO_PRESIDENT_SOURCES.length,
      tags: [...DEMO_PRESIDENTS_DEFAULT_TAGS],
      metadata: {},
      blueprint: UNSPECIFIED_ASSESSMENT_BLUEPRINT,
    }).onConflictDoNothing();
    const rows = await tx.select({
      tenantId: assessments.tenantId,
      metadata: assessments.metadata,
    }).from(assessments)
      .where(eq(assessments.id, assessmentId))
      .for('update')
      .limit(1);
    if (!rows.length || rows[0].tenantId !== tenantId) {
      throw new Error('Demo assessment is outside the current workspace.');
    }
    if (rows[0].metadata.demoVersion === DEMO_PRESIDENTS_VERSION) return assessmentId;

    const partsWithIds = await Promise.all(DEMO_PRESIDENT_PARTS.map(async (part) => ({
      part,
      id: await uuidV5(tenantId, `demo:presidents:part:${part.key}`),
    })));
    const partIdByKey = new Map(partsWithIds.map(({ part, id }) => [part.key, id]));
    const placementsByPart = new Map<
      string,
      Array<{ id: string; itemId: string; snapshotRev: number }>
    >();
    for (const { id } of partsWithIds) placementsByPart.set(id, []);

    const savedSeeds = await refreshAuthoredQuestionRevisionsInTransaction(
      tx,
      ctx,
      preparedSeeds.map((seed) => seed.revision),
    );
    const savedByQuestionId = new Map(savedSeeds.map((seed) => [seed.questionId, seed]));
    for (const seed of preparedSeeds) {
      const saved = savedByQuestionId.get(seed.questionId);
      if (!saved) throw new Error('Demo question revision was not persisted.');
      const partId = partIdByKey.get(seed.source.partKey);
      const placements = partId ? placementsByPart.get(partId) : undefined;
      if (!placements) throw new Error(`Unknown demo part ${seed.source.partKey}`);
      placements.push({
        id: crypto.randomUUID(),
        itemId: saved.questionId,
        snapshotRev: saved.revision,
      });
    }

    const parts = DEMO_PRESIDENT_PARTS.map((part) => {
      const id = partIdByKey.get(part.key);
      if (!id) throw new Error(`Demo part ${part.key} has no deterministic identity.`);
      return {
        id,
        title: part.title,
        placements: placementsByPart.get(id) ?? [],
      };
    });

    await saveAssessmentInTransaction(tx, ctx, {
      blueprint: UNSPECIFIED_ASSESSMENT_BLUEPRINT,
      id: assessmentId,
      title: 'US Presidents Sampler',
      brief: DEMO_PRESIDENTS_ASSESSMENT_BRIEF,
      gradeLevel: '6-8',
      targetCount: DEMO_PRESIDENT_SOURCES.length,
      tags: [...DEMO_PRESIDENTS_DEFAULT_TAGS],
      metadata: { demoVersion: DEMO_PRESIDENTS_VERSION, topic: 'presidents' },
      parts,
    });
    return assessmentId;
  });
}

function prepareDemoContent(): Promise<readonly PreparedDemoContent[]> {
  preparedDemoContent ??= Promise.all(DEMO_PRESIDENT_SOURCES.map(prepareDemoSource));
  return preparedDemoContent;
}

async function prepareDemoSource(source: DemoPresidentSource): Promise<PreparedDemoContent> {
  const input = createDemoPresidentRevisionContent(source);
  const precomputed = DEMO_COMPATIBILITY[source.stableKey];
  if (!precomputed) {
    throw new Error(`Demo compatibility is missing for ${source.stableKey}.`);
  }
  return {
    source,
    revision: await prepareQuestionRevisionFromPrecomputedCompatibility(input, precomputed),
  };
}
