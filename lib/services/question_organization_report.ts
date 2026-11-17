import { and, count, eq, sql } from 'drizzle-orm';
import type { QflowDatabase } from '../db.ts';
import { bankCollections } from '../db/bank_schema.ts';
import { organizationItems, organizationRuns } from '../db/question_organization_schema.ts';
import { safeErrorSummary } from '../error_summary.ts';
import type { RequestContext } from '../tenants.ts';
import { isCanonicalUuid } from '../uuid.ts';
import { canReadEnrichment } from './bank_enrichment_access.ts';
import type { EnrichmentResult } from './bank_enrichment_contract.ts';
import type { OrganizationFailure } from './question_organization_contract.ts';
import { loadOrganizationRun } from './question_organization_read.ts';

/** A run's recorded outcomes, never a claim about the bank's current topic inventory. */
export type OrganizationReport = {
  readonly id: string;
  readonly collection: string;
  readonly vocabulary: string;
  readonly startedAt: Date;
  readonly state: 'completed' | 'failed' | 'cancelled';
  readonly counts: readonly { readonly state: string; readonly count: number }[];
  readonly topics: readonly {
    readonly label: string;
    readonly subject: string;
    readonly source: number;
    readonly clef: number;
    readonly preserved: number;
  }[];
};

/** Authorize and aggregate one settled apply run without loading question text or model receipts. */
export async function readOrganizationReport(
  database: QflowDatabase,
  ctx: RequestContext,
  id: string,
): Promise<EnrichmentResult<OrganizationReport, OrganizationFailure>> {
  if (!isCanonicalUuid(id)) return { ok: false, code: 'invalid_input' };
  try {
    return await database.transaction(async (tx) => {
      if (!await canReadEnrichment(tx, ctx, 'manage_content')) {
        return { ok: false, code: 'forbidden' } as const;
      }
      const [run] = await tx.select().from(organizationRuns).where(
        and(eq(organizationRuns.id, id), eq(organizationRuns.tenantId, ctx.tenantId)),
      );
      if (!run) return { ok: false, code: 'not_found' } as const;
      const state = run.state;
      if (
        run.mode !== 'apply' ||
        (state !== 'completed' && state !== 'failed' && state !== 'cancelled')
      ) {
        return { ok: false, code: 'conflict' } as const;
      }
      const context = await loadOrganizationRun(tx, id, run.executionId, { kind: 'request', ctx });
      if (!context) return { ok: false, code: 'not_found' } as const;
      const [collection] = await tx.select({ name: bankCollections.name }).from(bankCollections)
        .where(
          and(
            eq(bankCollections.id, context.setup.collectionId),
            eq(bankCollections.tenantId, ctx.tenantId),
          ),
        );
      if (!collection) return { ok: false, code: 'not_found' } as const;
      const counts = await tx.select({ state: organizationItems.state, count: count() })
        .from(organizationItems).where(eq(organizationItems.runId, id))
        .groupBy(organizationItems.state).orderBy(organizationItems.state);
      if (
        counts.some((row) =>
          ![
            'pending',
            'processing',
            'received',
            'applied',
            'protected',
            'outdated',
            'unassigned',
            'unsupported',
            'failed',
            'cancelled',
          ].includes(row.state)
        )
      ) {
        throw new Error('Invalid apply report outcome.');
      }
      const kind = sql<string>`${organizationItems.decision}->>'kind'`;
      const topic = sql<string>`CASE WHEN ${kind} = 'clef'
        THEN ${organizationItems.decision}->'receipt'->>'topicId'
        ELSE ${organizationItems.decision}->>'topicId' END`;
      const rows = await tx.select({ topic, kind, count: count() }).from(organizationItems).where(
        and(eq(organizationItems.runId, id), eq(organizationItems.state, 'applied')),
      ).groupBy(topic, kind);
      const topics = context.definition.topics.map((t) => ({
        id: t.id,
        label: t.label,
        subject: context.definition.subjects.find((s) => s.id === t.subjectId)?.label,
        source: 0,
        clef: 0,
        preserved: 0,
      }));
      for (const row of rows) {
        const target = topics.find((t) => t.id === row.topic);
        if (!target || !['source', 'clef', 'preserved'].includes(row.kind)) {
          throw new Error('Invalid applied organization topic.');
        }
        if (row.kind === 'source') target.source += row.count;
        else if (row.kind === 'clef') target.clef += row.count;
        else target.preserved += row.count;
      }
      return {
        ok: true,
        value: {
          id,
          collection: collection.name,
          vocabulary: context.definition.name,
          startedAt: run.createdAt,
          state,
          counts,
          topics: topics.flatMap((topic) => {
            if (!topic.subject) throw new Error('Report topic has no subject.');
            return topic.source + topic.clef + topic.preserved > 0
              ? [{
                label: topic.label,
                subject: topic.subject,
                source: topic.source,
                clef: topic.clef,
                preserved: topic.preserved,
              }]
              : [];
          }),
        },
      } as const;
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  } catch (cause) {
    console.error('Organization report read failed', safeErrorSummary(cause));
    return { ok: false, code: 'storage_failed' };
  }
}
