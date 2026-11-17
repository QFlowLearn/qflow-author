import { and, count, countDistinct, eq, isNotNull, ne, sql } from 'drizzle-orm';
import type { QflowDatabase } from '../db.ts';
import { migrationItems } from '../db/schema.ts';

/** Repeated content is reported without combining question identities or requiring approval. */
export type MigrationExactRepeats = {
  readonly total: number;
  readonly compared: number;
  readonly repeats: number;
  readonly groups: readonly {
    readonly count: number;
    readonly members: readonly { readonly id: string; readonly position: number }[];
  }[];
  readonly limited: boolean;
};

/** Read compact comparison proofs after the caller has authorized access to the run. */
export async function loadMigrationExactRepeats(
  database: Pick<QflowDatabase, 'select'>,
  runId: string,
  fullReport: boolean,
): Promise<MigrationExactRepeats> {
  const scope = and(eq(migrationItems.runId, runId), ne(migrationItems.decision, 'rejected'));
  const [totals] = await database.select({
    total: count(),
    compared: count(migrationItems.exactContentIdentity),
    distinct: countDistinct(migrationItems.exactContentIdentity),
  }).from(migrationItems).where(scope);
  const memberArray =
    sql`array_agg(jsonb_build_object('id', ${migrationItems.id}, 'position', ${migrationItems.position}) ORDER BY ${migrationItems.position})`;
  const query = database.select({
    count: count(),
    members: sql<unknown>`to_jsonb(${fullReport ? memberArray : sql`(${memberArray})[1:6]`})`,
  }).from(migrationItems).where(and(scope, isNotNull(migrationItems.exactContentIdentity)))
    .groupBy(migrationItems.exactContentIdentity)
    .having(sql`count(*) > 1`)
    .orderBy(sql`min(${migrationItems.position})`).$dynamic();
  const rows = await (fullReport ? query : query.limit(21));
  const groups = (fullReport ? rows : rows.slice(0, 20)).map((row) => {
    if (!Array.isArray(row.members)) throw new Error('Invalid exact-repeat members.');
    const members = row.members.map((value: unknown) => {
      if (
        typeof value !== 'object' || value === null ||
        !('id' in value) || typeof value.id !== 'string' ||
        !('position' in value) || typeof value.position !== 'number' ||
        !Number.isSafeInteger(value.position) || value.position < 1
      ) {
        throw new Error('Invalid exact-repeat member.');
      }
      return { id: value.id, position: value.position };
    });
    return { count: row.count, members: fullReport ? members : members.slice(0, 6) };
  });
  return {
    total: totals.total,
    compared: totals.compared,
    repeats: totals.compared - totals.distinct,
    groups,
    limited: !fullReport && rows.length > 20,
  };
}
