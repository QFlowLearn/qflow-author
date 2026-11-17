import { and, count, eq, ne } from 'drizzle-orm';
import type {
  MigrationReviewFilter,
  MigrationReviewPagination,
} from '../import/migration_review_filter.ts';
import { db } from '../db.ts';
import { migrationCommitJobs, migrationItems } from '../db/schema.ts';
import { getMigrationRun } from '../import/migration_run_queries.ts';
import { loadMigrationImportChecks } from '../import/migration_import_checks.ts';
import { loadMigrationExactRepeats } from '../import/migration_exact_repeats.ts';
import { enqueueMigrationCommit } from '../import/migration_commit_job.ts';
import type { RequestContext } from '../tenants.ts';

/** Read a bounded bank review and durable progress for the server-rendered page. */
export async function getMigrationReviewPage(
  ctx: RequestContext,
  runId: string,
  page: number,
  fullReport: boolean,
  filter: MigrationReviewFilter = 'all',
) {
  const header = await getMigrationRun(ctx, runId, db, { offset: 0, limit: 0 });
  if (!header) return null;
  const paged = header.destination._tag === 'WorkspaceBank' && !fullReport;
  let pagination: MigrationReviewPagination | undefined;
  if (paged) {
    const [blockedCount] = await db.select({ value: count() }).from(migrationItems).where(
      and(
        eq(migrationItems.runId, runId),
        eq(migrationItems.readiness, 'blocked'),
        ne(migrationItems.decision, 'rejected'),
      ),
    );
    const totalItems = header.reviewProgress.total;
    const blocked = blockedCount.value;
    const total = filter === 'blocked' ? blocked : totalItems;
    pagination = {
      page: Math.min(page, Math.max(1, Math.ceil(total / 50))),
      pageSize: 50,
      total,
      totalItems,
      blocked,
      filter,
    };
  }
  const run = await getMigrationRun(
    ctx,
    runId,
    db,
    pagination
      ? { offset: (pagination.page - 1) * 50, limit: 50, blockedOnly: filter === 'blocked' }
      : undefined,
  );
  if (!run) return null;
  const [commitProgress] = await db.select({
    state: migrationCommitJobs.state,
    completed: migrationCommitJobs.completed,
    total: migrationCommitJobs.total,
  }).from(migrationCommitJobs).where(
    and(eq(migrationCommitJobs.id, runId), eq(migrationCommitJobs.tenantId, ctx.tenantId)),
  );
  const exactRepeats = run.destination._tag === 'WorkspaceBank' &&
      (run.execution._tag === 'Analyzed' || run.execution._tag === 'Committed')
    ? await loadMigrationExactRepeats(db, runId, fullReport)
    : undefined;
  const importChecks = exactRepeats
    ? await loadMigrationImportChecks(db, runId, run.summary.globalWarnings ?? [], fullReport)
    : undefined;
  return { run, pagination, commitProgress, exactRepeats, importChecks };
}

/** Enqueue the explicit all-accepted bank selection; assessments retain their own commit service. */
export async function enqueueAcceptedBankMigration(
  ctx: RequestContext,
  runId: string,
  selection: FormDataEntryValue | null,
  approval: boolean,
): Promise<boolean> {
  const run = await getMigrationRun(ctx, runId, db, { offset: 0, limit: 0 });
  if (run?.destination._tag !== 'WorkspaceBank') return false;
  if (selection !== 'all-accepted') throw new Error('Choose the accepted bank selection.');
  const items = await db.select({ id: migrationItems.id }).from(migrationItems).where(
    and(eq(migrationItems.runId, runId), eq(migrationItems.decision, 'accepted')),
  );
  await enqueueMigrationCommit(ctx, runId, items.map((item) => item.id), approval);
  return true;
}
