import { BankEnrichmentAffectedScopes } from './bank_enrichment_affected_scope.ts';
import { parseEnrichmentPreviewChoice } from './bank_enrichment_preview_choice.ts';
import { canonicalJsonStringify } from '../canonical_json.ts';
import { sha256Hex } from '../sha256.ts';
import { parseEnrichmentDimensions } from './bank_enrichment_run_contract.ts';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { QflowDatabase } from '../db.ts';
import type { EnrichmentAIConfig } from '../ai/bank_enrichment_config.ts';
import { enrichmentSchemeVersions } from '../db/bank_enrichment_schema.ts';
import { enrichmentRuns } from '../db/bank_enrichment_job_schema.ts';
import { enrichmentPreviews, enrichmentTasks } from '../db/bank_enrichment_task_schema.ts';
import type { RequestContext } from '../tenants.ts';
import { isCanonicalUuid } from '../uuid.ts';
import { uuidV5 } from '../uuid_v5.ts';
import { authorizeEnrichment } from './bank_enrichment_access.ts';
import {
  type EnrichmentDefinition,
  type EnrichmentResult,
  type EnrichmentSchemeVersion,
  parseEnrichmentDefinition,
} from './bank_enrichment_contract.ts';
import { BankEnrichmentJobs, jobStorageFailure } from './bank_enrichment_jobs.ts';
import type { EnrichmentJobFailure } from './bank_enrichment_job_contract.ts';
import { BankEnrichmentJobRead } from './bank_enrichment_job_read.ts';
import { BankEnrichmentScopes } from './bank_enrichment_scope.ts';
import { BankEnrichmentStore } from './bank_enrichment_store.ts';
import { BankEnrichmentRunStore } from './bank_enrichment_run_store.ts';
import { loadEnrichmentSources } from './bank_enrichment_sources.ts';
import type { EnrichmentQuestion } from './bank_enrichment_input.ts';
import { classificationRequest } from './bank_enrichment_classifier.ts';
import { enrichmentRequestInputBound } from '../ai/bank_enrichment_provider.ts';

/** Setup failures are mapped to actionable, localized messages at the HTTP boundary. */
export type EnrichmentSetupFailure =
  | EnrichmentJobFailure
  | 'empty_scope'
  | 'invalid_selection'
  | 'unsupported_content'
  | 'input_too_large'
  | 'version_conflict'
  | 'empty_affected_scope'
  | 'affected_scope_changed';

/** Coordinates the instructor's preview and start actions using stable operation identities. */
export class BankEnrichmentSetup {
  constructor(private readonly database: QflowDatabase, private readonly now: () => Date) {}

  /** Reused instructor examples may be outside the new sample; load their exact saved revisions. */
  async examples(
    ctx: RequestContext,
    input: unknown,
  ): Promise<EnrichmentResult<readonly EnrichmentQuestion[], EnrichmentSetupFailure>> {
    const definition = parseEnrichmentDefinition(input);
    if (!definition) return { ok: false, code: 'invalid_input' };
    try {
      return await this.database.transaction(async (tx) => {
        if (!await authorizeEnrichment(tx, ctx, 'manage_content')) {
          return { ok: false, code: 'forbidden' } as const;
        }
        const sources = await loadEnrichmentSources(tx, ctx.tenantId, definition.examples);
        const questions: EnrichmentQuestion[] = [];
        for (const source of sources) {
          if (!source.content.ok) return { ok: false, code: 'unsupported_content' } as const;
          questions.push(source.content.value);
        }
        return { ok: true, value: questions } as const;
      });
    } catch (cause: unknown) {
      return jobStorageFailure(cause);
    }
  }

  /** Capture the complete scope once, then queue either a new proposal or a reused scheme preview. */
  async begin(
    ctx: RequestContext,
    operationId: string,
    scope: unknown,
    audience: string,
    baseVersionId: string | null,
    config: EnrichmentAIConfig,
  ): Promise<EnrichmentResult<string, EnrichmentSetupFailure>> {
    if (
      !isCanonicalUuid(operationId) || !audience.trim() || audience.length > 1000 ||
      (baseVersionId !== null && !isCanonicalUuid(baseVersionId))
    ) return { ok: false, code: 'invalid_input' };
    const base = baseVersionId === null
      ? null
      : await new BankEnrichmentStore(this.database, this.now).getVersion(ctx, baseVersionId);
    if (base && !base.ok) return base;
    const definition = base?.ok
      ? { ...base.value.definition, audience: audience.trim(), replacements: [] }
      : null;
    const snapshotId = await uuidV5(operationId, 'scope');
    const captured = await new BankEnrichmentScopes(this.database, this.now).capture(
      ctx,
      snapshotId,
      scope,
    );
    if (!captured.ok) return captured;
    return await new BankEnrichmentJobs(this.database, this.now).queuePreview(
      ctx,
      operationId,
      snapshotId,
      await uuidV5(operationId, 'execution'),
      {
        baseVersionId,
        seed: await uuidV5(operationId, 'sample'),
        audience: audience.trim(),
        definition,
      },
      config,
    );
  }

  /** Refresh the chosen scope; affected selections are recaptured from their frozen root after edits. */
  async preview(
    ctx: RequestContext,
    sourceId: string,
    operationId: string,
    input: unknown,
    inputChoice: unknown,
    config: EnrichmentAIConfig,
  ): Promise<EnrichmentResult<string, EnrichmentSetupFailure>> {
    const definition = parseEnrichmentDefinition(input),
      choice = parseEnrichmentPreviewChoice(inputChoice);
    if (!definition || !choice || !isCanonicalUuid(operationId)) {
      return { ok: false, code: 'invalid_input' };
    }
    const source = await new BankEnrichmentJobRead(this.database, this.now).get(ctx, sourceId);
    if (!source.ok) return source;
    if (
      source.value.kind !== 'preview' || source.value.state !== 'completed' || !source.value.sample
    ) return { ok: false, code: 'invalid_transition' };
    const fit = await this.checkRequest(ctx, definition, source.value.sample.questions);
    if (!fit.ok) return fit;
    const snapshot = await new BankEnrichmentScopes(this.database, this.now).get(
      ctx,
      source.value.snapshotId,
    );
    if (!snapshot.ok) return snapshot;
    let snapshotId = snapshot.value.id;
    let seed = source.value.sample.seed;
    if (choice.selection === 'affected' || snapshot.value.scope._tag === 'Affected') {
      if (!source.value.baseVersionId) return { ok: false, code: 'invalid_input' };
      const affected = await new BankEnrichmentAffectedScopes(this.database, this.now).capture(
        ctx,
        await uuidV5(operationId, 'scope'),
        snapshotId,
        source.value.baseVersionId,
        definition,
      );
      if (!affected.ok) {
        return affected.code === 'empty_scope'
          ? { ok: false, code: 'empty_affected_scope' }
          : affected;
      }
      snapshotId = affected.value.id;
      seed = await uuidV5(operationId, 'sample');
    }
    return await new BankEnrichmentJobs(this.database, this.now).queuePreview(
      ctx,
      operationId,
      snapshotId,
      await uuidV5(operationId, 'execution'),
      {
        baseVersionId: source.value.baseVersionId,
        seed,
        audience: definition.audience,
        definition,
      },
      config,
    );
  }

  /** Repeated submissions save exactly one version and one run, without refreshing captured edits. */
  async start(
    ctx: RequestContext,
    previewId: string,
    input: unknown,
    replacement: 'preserve_manual' | 'replace_captured',
    inputDimensions: unknown,
    config: EnrichmentAIConfig,
  ): Promise<EnrichmentResult<string, EnrichmentSetupFailure>> {
    const definition = parseEnrichmentDefinition(input);
    const dimensions = parseEnrichmentDimensions(inputDimensions);
    if (
      !definition || !dimensions || !isCanonicalUuid(previewId) ||
      (replacement !== 'preserve_manual' && replacement !== 'replace_captured')
    ) return { ok: false, code: 'invalid_input' };
    const preview = await new BankEnrichmentJobRead(this.database, this.now).get(ctx, previewId);
    if (!preview.ok) return preview;
    if (
      preview.value.kind !== 'preview' || preview.value.state !== 'completed' ||
      !preview.value.sample
    ) {
      return { ok: false, code: 'invalid_transition' };
    }
    const snapshot = await new BankEnrichmentScopes(this.database, this.now).get(
      ctx,
      preview.value.snapshotId,
    );
    if (!snapshot.ok) return snapshot;
    if (
      snapshot.value.scope._tag === 'Affected' &&
      snapshot.value.scope.definitionHash !==
        await sha256Hex(new TextEncoder().encode(canonicalJsonStringify(definition)))
    ) {
      return { ok: false, code: 'affected_scope_changed' };
    }
    const fit = await this.checkRequest(ctx, definition, preview.value.sample.questions);
    if (!fit.ok) return fit;
    const baseVersionId = preview.value.baseVersionId;
    const store = new BankEnrichmentStore(this.database, this.now);
    const base = baseVersionId === null ? null : await store.getVersion(ctx, baseVersionId);
    if (base && !base.ok) return base;
    const runId = await uuidV5(previewId, 'run');
    const saved = await store.saveVersion(ctx, {
      id: await uuidV5(previewId, 'version'),
      schemeId: base?.ok ? base.value.schemeId : await uuidV5(previewId, 'scheme'),
      expectedVersion: base?.ok ? base.value.version : 0,
      definition,
    });
    if (!saved.ok) return saved;
    const prepared = await new BankEnrichmentRunStore(this.database, this.now).prepare(ctx, runId, {
      snapshotId: preview.value.snapshotId,
      versionId: saved.value.id,
      dimensions,
      replacement,
    });
    if (!prepared.ok) return prepared;
    return await new BankEnrichmentJobs(this.database, this.now).queueRun(
      ctx,
      runId,
      await uuidV5(runId, 'execution'),
      config,
    );
  }

  /** Bounded saved vocabularies and recent work make setup recoverable after leaving the page. */
  async home(
    ctx: RequestContext,
  ): Promise<
    EnrichmentResult<
      {
        readonly schemes: readonly EnrichmentSchemeVersion[];
        readonly recent: readonly {
          readonly id: string;
          readonly kind: 'preview' | 'classify' | 'correct' | 'undo';
          readonly createdAt: string;
        }[];
      },
      EnrichmentSetupFailure
    >
  > {
    try {
      return await this.database.transaction(async (tx) => {
        if (!await authorizeEnrichment(tx, ctx, 'manage_content')) {
          return { ok: false, code: 'forbidden' } as const;
        }
        const rows = await tx.select().from(enrichmentSchemeVersions).where(
          and(
            eq(enrichmentSchemeVersions.tenantId, ctx.tenantId),
            sql`NOT EXISTS (SELECT 1 FROM bank_enrichment_scheme_versions newer WHERE newer.scheme_id = ${enrichmentSchemeVersions.schemeId} AND newer.version > ${enrichmentSchemeVersions.version})`,
          ),
        ).orderBy(desc(enrichmentSchemeVersions.createdAt)).limit(100);
        const schemes: EnrichmentSchemeVersion[] = [];
        for (const row of rows) {
          const definition = parseEnrichmentDefinition(row.definition);
          if (!definition) throw new Error('Invalid saved enrichment scheme.');
          schemes.push({ id: row.id, schemeId: row.schemeId, version: row.version, definition });
        }
        const createdAt = sql<
          Date
        >`CASE WHEN ${enrichmentTasks.kind} = 'preview' THEN ${enrichmentPreviews.createdAt} ELSE ${enrichmentRuns.createdAt} END`
          .mapWith(enrichmentRuns.createdAt);
        const tasks = await tx.select({
          id: enrichmentTasks.id,
          kind: enrichmentTasks.kind,
          createdAt,
        })
          .from(enrichmentTasks)
          .leftJoin(
            enrichmentPreviews,
            and(
              eq(enrichmentPreviews.id, enrichmentTasks.id),
              eq(enrichmentPreviews.tenantId, enrichmentTasks.tenantId),
            ),
          )
          .leftJoin(
            enrichmentRuns,
            and(
              eq(enrichmentRuns.id, enrichmentTasks.id),
              eq(enrichmentRuns.tenantId, enrichmentTasks.tenantId),
            ),
          )
          .where(eq(enrichmentTasks.tenantId, ctx.tenantId)).orderBy(desc(createdAt)).limit(5);
        const recent: {
          id: string;
          kind: 'preview' | 'classify' | 'correct' | 'undo';
          createdAt: string;
        }[] = [];
        for (const task of tasks) {
          if (
            (task.kind !== 'preview' && task.kind !== 'classify' && task.kind !== 'correct' &&
              task.kind !== 'undo') || !(task.createdAt instanceof Date)
          ) {
            throw new Error('Invalid enrichment task kind or date.');
          }
          recent.push({ id: task.id, kind: task.kind, createdAt: task.createdAt.toISOString() });
        }
        return { ok: true, value: { schemes, recent } } as const;
      });
    } catch (cause: unknown) {
      return jobStorageFailure(cause);
    }
  }

  /** Reject edits that exceed the actual preview request bound while the instructor can still edit. */
  private async checkRequest(
    ctx: RequestContext,
    definition: EnrichmentDefinition,
    questions: readonly EnrichmentQuestion[],
  ): Promise<EnrichmentResult<void, EnrichmentSetupFailure>> {
    const examples = await this.examples(ctx, definition);
    if (!examples.ok) return examples;
    const request = classificationRequest(definition, questions.slice(0, 20), examples.value);
    if (!request) return { ok: false, code: 'invalid_input' };
    return enrichmentRequestInputBound(request) === null
      ? { ok: false, code: 'input_too_large' }
      : { ok: true, value: undefined };
  }
}
