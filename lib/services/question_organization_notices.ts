import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb, type QflowDatabase, type QflowDatabaseTransaction } from '../db.ts';
import type { RuntimeSource } from '../runtime.ts';
import {
  organizationNotices,
  organizationRuns,
  organizationSetups,
} from '../db/question_organization_schema.ts';
import { bankCollections } from '../db/bank_schema.ts';
import type { RequestContext } from '../tenants.ts';
import { safeErrorSummary } from '../error_summary.ts';
import {
  type OrganizationNoticeAck,
  type OrganizationNoticeSnapshot,
  parseOrganizationNoticeSnapshot,
} from '../organization_notices.ts';
import type { EnrichmentResult } from './bank_enrichment_contract.ts';
import { authorizeEnrichment, canReadEnrichment } from './bank_enrichment_access.ts';

type NoticeFailure = 'forbidden' | 'not_found' | 'conflict' | 'storage_failed';

/** Commit the notice with the terminal run transition; replay cannot create another notice. */
export async function recordOrganizationNotice(tx: QflowDatabaseTransaction, run: {
  readonly id: string;
  readonly executionId: string;
  readonly tenantId: string;
  readonly mode: 'preview' | 'apply';
}): Promise<void> {
  if (run.mode !== 'apply') return;
  await tx.insert(organizationNotices).values({
    runId: run.id,
    executionId: run.executionId,
    tenantId: run.tenantId,
  }).onConflictDoNothing();
}

/** List only the current actor's durable completions, excluding resumed or undone executions. */
export async function readOrganizationNotices(
  database: QflowDatabase,
  ctx: RequestContext,
): Promise<EnrichmentResult<OrganizationNoticeSnapshot, NoticeFailure>> {
  try {
    return await database.transaction(async (tx) => {
      if (!await canReadEnrichment(tx, ctx, 'manage_content')) {
        return { ok: false, code: 'forbidden' } as const;
      }
      const rows = await tx.select({
        runId: organizationRuns.id,
        executionId: organizationRuns.executionId,
        collection: bankCollections.name,
        state: organizationRuns.state,
        total: sql<number>`count(*) over ()`.mapWith(Number),
      }).from(organizationNotices)
        .innerJoin(
          organizationRuns,
          and(
            eq(organizationRuns.id, organizationNotices.runId),
            eq(organizationRuns.tenantId, organizationNotices.tenantId),
          ),
        )
        .innerJoin(organizationSetups, eq(organizationSetups.id, organizationRuns.setupId))
        .innerJoin(bankCollections, eq(bankCollections.id, organizationSetups.collectionId))
        .where(
          and(
            eq(organizationNotices.tenantId, ctx.tenantId),
            eq(organizationRuns.executionBy, ctx.userId),
            eq(organizationNotices.executionId, organizationRuns.executionId),
            eq(organizationRuns.mode, 'apply'),
            inArray(organizationRuns.state, ['completed', 'failed']),
            isNull(organizationNotices.readAt),
          ),
        )
        .orderBy(desc(organizationNotices.createdAt), organizationNotices.executionId).limit(5);
      const value = parseOrganizationNoticeSnapshot({
        total: rows[0]?.total ?? 0,
        notices: rows.map(({ total: _total, ...notice }) => notice),
      });
      if (!value) throw new Error('Invalid stored organization notice.');
      return { ok: true, value } as const;
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  } catch (cause) {
    console.error('Organization notices read failed', safeErrorSummary(cause));
    return { ok: false, code: 'storage_failed' };
  }
}

/** Reading or dismissing a notice never acknowledges a newer execution of the same run. */
export async function acknowledgeOrganizationNotice(
  database: QflowDatabase,
  ctx: RequestContext,
  command: OrganizationNoticeAck,
): Promise<EnrichmentResult<true, NoticeFailure>> {
  try {
    return await database.transaction(async (tx) => {
      if (!await authorizeEnrichment(tx, ctx, 'manage_content')) {
        return { ok: false, code: 'forbidden' } as const;
      }
      const [run] = await tx.select().from(organizationRuns).where(
        and(
          eq(organizationRuns.id, command.runId),
          eq(organizationRuns.tenantId, ctx.tenantId),
          eq(organizationRuns.executionBy, ctx.userId),
        ),
      ).for('update');
      if (!run) return { ok: false, code: 'not_found' } as const;
      if (
        run.executionId !== command.executionId || run.mode !== 'apply' ||
        !['completed', 'failed'].includes(run.state)
      ) return { ok: false, code: 'conflict' } as const;
      const rows = await tx.update(organizationNotices).set({
        readAt: sql`coalesce(${organizationNotices.readAt}, now())`,
      })
        .where(
          and(
            eq(organizationNotices.runId, run.id),
            eq(organizationNotices.tenantId, ctx.tenantId),
            eq(organizationNotices.executionId, command.executionId),
          ),
        )
        .returning({ id: organizationNotices.executionId });
      return rows.length
        ? { ok: true, value: true } as const
        : { ok: false, code: 'not_found' } as const;
    });
  } catch (cause) {
    console.error('Organization notice acknowledgement failed', safeErrorSummary(cause));
    return { ok: false, code: 'storage_failed' };
  }
}

/** Resolve request-owned persistence once for the HTTP notice actions. */
export function organizationNoticeActions(runtime: RuntimeSource) {
  const database = getDb(runtime);
  return {
    read: (auth: RequestContext) => readOrganizationNotices(database, auth),
    acknowledge: (auth: RequestContext, command: OrganizationNoticeAck) =>
      acknowledgeOrganizationNotice(database, auth, command),
  };
}
