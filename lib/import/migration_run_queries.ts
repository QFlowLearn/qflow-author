import { organizationMemberships } from '../db/principal_schema.ts';
import { hasCapability, parseRole } from '../roles.ts';
import { and, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';

import { db, type QflowDatabase } from '../db.ts';
import {
  conversionSourceArtifacts,
  migrationBatches,
  migrationItems,
  migrationRuns,
  users,
} from '../db/schema.ts';
import { type RequestContext, type WorkerContext } from '../tenants.ts';
import { buildReviewProgress } from './migration_analysis.ts';
import { mapArtifactRow, mapItemRow, mapRunRow, mapRunSummaryRow } from './migration_run_store.ts';
import type {
  MigrationReviewProgress,
  MigrationRunListItem,
  MigrationRunRecord,
} from './migration_types.ts';

/** List lightweight migration summaries for the current tenant. */
export async function listMigrationRuns(ctx: RequestContext): Promise<MigrationRunListItem[]> {
  const rows = await db.select({
    run: migrationRuns,
    purpose: migrationBatches.purpose,
    createdBy: migrationBatches.createdBy,
    creatorEmail: users.email,
    creatorName: users.displayName,
  }).from(migrationRuns)
    .innerJoin(migrationBatches, eq(migrationBatches.id, migrationRuns.batchId))
    .leftJoin(users, eq(users.id, migrationBatches.createdBy))
    .where(eq(migrationRuns.tenantId, ctx.tenantId))
    .orderBy(desc(migrationRuns.createdAt))
    .limit(100);
  const runIds = rows.map((row) => row.run.id);
  const reviewProgressByRun = new Map<string, MigrationReviewProgress>();
  if (runIds.length) {
    const reviewRows = await db.select({
      runId: migrationItems.runId,
      total: count(migrationItems.id),
      pending: sql<
        number
      >`coalesce(sum(case when ${migrationItems.decision} = 'pending' then 1 else 0 end), 0)`
        .mapWith(Number),
      accepted: sql<
        number
      >`coalesce(sum(case when ${migrationItems.decision} = 'accepted' then 1 else 0 end), 0)`
        .mapWith(Number),
      rejected: sql<
        number
      >`coalesce(sum(case when ${migrationItems.decision} = 'rejected' then 1 else 0 end), 0)`
        .mapWith(Number),
    }).from(migrationItems)
      .where(inArray(migrationItems.runId, runIds))
      .groupBy(migrationItems.runId);
    for (const row of reviewRows) {
      reviewProgressByRun.set(row.runId, {
        total: Number(row.total),
        pending: Number(row.pending),
        accepted: Number(row.accepted),
        rejected: Number(row.rejected),
      });
    }
  }
  return rows.map((row) => ({
    ...mapRunSummaryRow(
      row.run,
      { purpose: row.purpose, createdBy: row.createdBy },
      {
        creatorEmail: row.creatorEmail,
        creatorName: row.creatorName,
      },
    ),
    reviewProgress: reviewProgressByRun.get(row.run.id) ?? buildReviewProgress([]),
  }));
}

/** Load one full migration run with review items and source artifacts. */
export async function getMigrationRun(
  ctx: RequestContext | WorkerContext,
  id: string,
  database: Pick<QflowDatabase, 'select'> = db,
  selection?:
    | { readonly offset: number; readonly limit: number; readonly blockedOnly?: boolean }
    | {
      readonly itemIds: readonly string[];
    },
): Promise<MigrationRunRecord | null> {
  const rows = await database.select({
    run: migrationRuns,
    purpose: migrationBatches.purpose,
    createdBy: migrationBatches.createdBy,
    creatorEmail: users.email,
    creatorName: users.displayName,
  }).from(migrationRuns)
    .innerJoin(migrationBatches, eq(migrationBatches.id, migrationRuns.batchId))
    .leftJoin(users, eq(users.id, migrationBatches.createdBy))
    .where(and(eq(migrationRuns.id, id), eq(migrationRuns.tenantId, ctx.tenantId)))
    .limit(1);
  if (!rows.length) return null;
  if (rows[0].run.destination === 'WorkspaceBank') {
    const [member] = await database.select({ role: organizationMemberships.role }).from(
      organizationMemberships,
    )
      .where(
        and(
          eq(organizationMemberships.tenantId, ctx.tenantId),
          eq(organizationMemberships.userId, ctx.userId),
        ),
      );
    const role = parseRole(member?.role);
    if (!role || !hasCapability(role, 'view_content')) return null;
  }
  const itemQuery = database.select().from(migrationItems)
    .where(
      and(
        eq(migrationItems.runId, id),
        selection && 'blockedOnly' in selection && selection.blockedOnly
          ? and(eq(migrationItems.readiness, 'blocked'), ne(migrationItems.decision, 'rejected'))
          : undefined,
        selection && 'itemIds' in selection
          ? inArray(migrationItems.id, [...selection.itemIds])
          : undefined,
        ['analyzed', 'committed'].includes(rows[0].run.status) ? undefined : sql`false`,
      ),
    ).orderBy(migrationItems.position).$dynamic();
  const itemRows =
    await (selection && 'offset' in selection
      ? itemQuery.limit(selection.limit).offset(selection.offset)
      : itemQuery);
  const progressRows = await database.select({ decision: migrationItems.decision, total: count() })
    .from(migrationItems).where(eq(migrationItems.runId, id)).groupBy(migrationItems.decision);
  const progress = buildReviewProgress([]);
  for (const row of progressRows) {
    progress.total += row.total;
    if (row.decision === 'accepted') progress.accepted += row.total;
    else if (row.decision === 'rejected') progress.rejected += row.total;
    else progress.pending += row.total;
  }
  const items = itemRows.map(mapItemRow);
  const artifactRows = await database.select().from(conversionSourceArtifacts)
    .where(eq(conversionSourceArtifacts.runId, id))
    .orderBy(conversionSourceArtifacts.createdAt);
  return mapRunRow(
    rows[0].run,
    { purpose: rows[0].purpose, createdBy: rows[0].createdBy },
    items,
    progress,
    artifactRows.map(mapArtifactRow),
    {
      creatorEmail: rows[0].creatorEmail,
      creatorName: rows[0].creatorName,
    },
  );
}
