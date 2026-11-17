import postgres from 'postgres';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { inspectQtiBinaryChoice } from '@longsightgroup/qti3-core';
import type { QflowDatabase, QflowDatabaseTransaction } from '../db.ts';
import {
  assessmentAdaptivePlans,
  assessmentParts,
  assessmentPlacements,
  assessments,
  enrichmentSchemeVersions,
  questionRevisions,
} from '../db/schema.ts';
import type { RequestContext } from '../tenants.ts';
import {
  type AdaptiveAssessmentPlan,
  type AdaptiveBlock,
  type AdaptiveCoverage,
  type AdaptiveLevel,
  type AdaptivePlanCommand,
  adaptivePlanDocument,
  type AdaptivePlanFailure,
  type AdaptivePlanResponse,
  adaptivePoolCounts,
  adaptiveSettingsDocument,
  parseAdaptivePlan,
} from '../assessment_adaptive_plan.ts';
import { sampleQuestions } from '../bank_question_sampling.ts';
import { safeErrorSummary } from '../error_summary.ts';
import { type EnrichmentResult, parseEnrichmentDefinition } from './bank_enrichment_contract.ts';
import { loadCategorizedBankCandidates } from './bank_question_candidates.ts';
import { validBankEnrichmentFilter } from './bank_enrichment_filter_access.ts';
import { hasWorkspaceCapability, lockWorkspace } from './workspace_authorization.ts';

type EligibleQuestion = {
  readonly itemId: string;
  readonly revision: number;
  readonly difficultyId: string;
};

/** Build or inspect a bounded adaptive form from one authorized classification snapshot. */
export class AssessmentAdaptivePlans {
  constructor(
    private readonly database: QflowDatabase,
    private readonly randomIndex: (limit: number) => number,
  ) {}

  async run(
    ctx: RequestContext,
    assessmentId: string,
    command: AdaptivePlanCommand,
  ): Promise<EnrichmentResult<AdaptivePlanResponse, AdaptivePlanFailure>> {
    try {
      return await this.database.transaction(
        async (tx): Promise<EnrichmentResult<AdaptivePlanResponse, AdaptivePlanFailure>> => {
          if (command.kind === 'build' && !await lockWorkspace(tx, ctx.tenantId)) {
            return { ok: false, code: 'forbidden' };
          }
          if (!await hasWorkspaceCapability(ctx, 'manage_content', tx)) {
            return { ok: false, code: 'forbidden' };
          }
          const assessmentQuery = tx.select({ id: assessments.id, status: assessments.status })
            .from(assessments)
            .where(and(eq(assessments.id, assessmentId), eq(assessments.tenantId, ctx.tenantId)));
          const [assessment] = command.kind === 'build'
            ? await assessmentQuery.for('update')
            : await assessmentQuery;
          if (!assessment) {
            return { ok: false, code: 'not_found' };
          }
          if (assessment.status !== 'draft') return { ok: false, code: 'not_draft' };
          const [saved] = await tx.select().from(assessmentAdaptivePlans).where(
            eq(assessmentAdaptivePlans.assessmentId, assessmentId),
          );
          const prior = saved ? parseAdaptivePlan(saved.document) : null;
          if (saved && !prior) throw new Error('Invalid persisted adaptive assessment plan.');
          const digest = command.kind === 'build' ? await commandDigest(command) : '';
          if (command.kind === 'build') {
            if (prior?.buildId === command.buildId) {
              return prior.requestDigest === digest
                ? { ok: true, value: { kind: 'built', plan: prior } }
                : { ok: false, code: 'conflict' };
            }
            if (command.expectedRevision !== (prior?.revision ?? 0)) {
              return { ok: false, code: 'conflict' };
            }
            if (!prior) {
              const existing = await tx.select({ id: assessmentPlacements.id }).from(
                assessmentPlacements,
              )
                .innerJoin(
                  assessmentParts,
                  eq(assessmentParts.id, assessmentPlacements.assessmentPartId),
                )
                .where(eq(assessmentParts.assessmentId, assessmentId)).limit(1);
              if (existing.length) {
                return { ok: false, code: 'not_empty' };
              }
            }
          }
          const { settings } = command;
          const filter = settings.query.enrichment;
          if (!filter || !await validBankEnrichmentFilter(tx, ctx.tenantId, filter)) {
            return { ok: false, code: 'invalid_input' };
          }
          const [version] = await tx.select().from(enrichmentSchemeVersions).where(and(
            eq(enrichmentSchemeVersions.id, settings.versionId),
            eq(enrichmentSchemeVersions.tenantId, ctx.tenantId),
            eq(enrichmentSchemeVersions.schemeId, filter.schemeId),
          ));
          if (!version) return { ok: false, code: 'invalid_input' };
          const definition = parseEnrichmentDefinition(version.definition);
          if (!definition) throw new Error('Invalid category-set version.');
          const levels: AdaptiveLevel[] = [];
          for (const id of settings.levelIds) {
            const level = definition.difficulty.find((entry) => entry.id === id);
            if (!level) return { ok: false, code: 'invalid_input' };
            levels.push({ id: level.id, label: level.label });
          }
          const candidates = await eligibleQuestions(tx, ctx, command);
          const counts = adaptivePoolCounts(settings.questionCount);
          const pools = levels.map((level) =>
            candidates.filter((candidate) => candidate.difficultyId === level.id)
          );
          const coverage: AdaptiveCoverage = {
            audience: definition.audience,
            levels: levels.map((level, index) => ({
              ...level,
              required: counts[index],
              available: pools[index].length,
            })),
          };
          if (command.kind === 'inspect') {
            return { ok: true, value: { kind: 'coverage', coverage } };
          }
          if (coverage.levels.some((level) => level.available < level.required)) {
            return { ok: true, value: { kind: 'shortfall', coverage } };
          }
          const sampled = pools.map((pool, level) =>
            sampleQuestions(pool, counts[level], this.randomIndex)
          );
          const partId = crypto.randomUUID();
          const placements: Array<typeof assessmentPlacements.$inferInsert> = [];
          const blocks: AdaptiveBlock[] = [];
          const offsets = [0, 0, 0];
          for (let group = 0; group < settings.questionCount / 5; group++) {
            for (let level = 0; level <= Math.min(group, 2); level++) {
              const placementIds: string[] = [];
              for (let index = 0; index < 5; index++) {
                const question = sampled[level][offsets[level]++];
                const id = crypto.randomUUID();
                placementIds.push(id);
                placements.push({
                  id,
                  assessmentPartId: partId,
                  questionId: question.itemId,
                  pinnedRevision: question.revision,
                  position: placements.length + 1,
                });
              }
              blocks.push({ group, level, placementIds });
            }
          }
          const plan: AdaptiveAssessmentPlan = {
            revision: (prior?.revision ?? 0) + 1,
            buildId: command.buildId,
            requestDigest: digest,
            partId,
            settings,
            audience: definition.audience,
            levels: [levels[0], levels[1], levels[2]],
            blocks,
          };
          await tx.delete(assessmentParts).where(eq(assessmentParts.assessmentId, assessmentId));
          await tx.insert(assessmentParts).values({
            id: partId,
            assessmentId,
            title: 'Adaptive assessment',
            position: 1,
            options: {},
          });
          await tx.insert(assessmentPlacements).values(placements);
          await tx.insert(assessmentAdaptivePlans).values({
            assessmentId,
            document: adaptivePlanDocument(plan),
          }).onConflictDoUpdate({
            target: assessmentAdaptivePlans.assessmentId,
            set: { document: adaptivePlanDocument(plan), updatedAt: sql`now()` },
          });
          await tx.update(assessments).set({
            targetCount: settings.questionCount,
            updatedAt: sql`now()`,
          }).where(eq(assessments.id, assessmentId));
          return { ok: true, value: { kind: 'built', plan } };
        },
        {
          isolationLevel: 'repeatable read',
          accessMode: command.kind === 'inspect' ? 'read only' : 'read write',
        },
      );
    } catch (cause: unknown) {
      const databaseError = cause instanceof Error && cause.cause ? cause.cause : cause;
      if (
        databaseError instanceof postgres.PostgresError &&
        ['40001', '40P01'].includes(databaseError.code)
      ) return { ok: false, code: 'conflict' };
      console.error('Adaptive assessment construction failed', safeErrorSummary(cause));
      return { ok: false, code: 'storage_failed' };
    }
  }
}

async function eligibleQuestions(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  command: AdaptivePlanCommand,
): Promise<EligibleQuestion[]> {
  const classified =
    (await loadCategorizedBankCandidates(tx, ctx, command.settings.query, 'difficulty'))
      .filter((candidate) =>
        candidate.versionId === command.settings.versionId &&
        command.settings.levelIds.includes(candidate.categoryId)
      );
  const eligible: EligibleQuestion[] = [];
  for (let offset = 0; offset < classified.length; offset += 200) {
    const batch = classified.slice(offset, offset + 200);
    const revisions = await tx.select({
      id: questionRevisions.id,
      revision: questionRevisions.revision,
      xml: questionRevisions.qtiXml,
    }).from(questionRevisions)
      .where(
        and(
          eq(questionRevisions.tenantId, ctx.tenantId),
          inArray(
            questionRevisions.id,
            batch.map((candidate) => candidate.revisionId),
          ),
        ),
      );
    const byId = new Map(revisions.map((revision) => [revision.id, revision]));
    for (const candidate of batch) {
      const revision = byId.get(candidate.revisionId);
      if (!revision) throw new Error('A classified revision is missing.');
      if (inspectQtiBinaryChoice(revision.xml).ok) {
        eligible.push({
          itemId: candidate.itemId,
          revision: revision.revision,
          difficultyId: candidate.categoryId,
        });
      }
    }
  }
  return eligible;
}

async function commandDigest(
  command: Extract<AdaptivePlanCommand, { kind: 'build' }>,
): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      settings: adaptiveSettingsDocument(command.settings),
      expectedRevision: command.expectedRevision,
    }),
  );
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
