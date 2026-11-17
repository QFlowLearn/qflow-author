import { and, count, eq, ne, or, sql } from 'drizzle-orm';
import type { QflowDatabase } from '../db.ts';
import { migrationItems } from '../db/schema.ts';
import type { ImportWarning } from './types.ts';
import type { MigrationWarningCode } from './migration_warning_catalog.ts';

/** Existing source diagnostics grouped by the repair an author needs to make. */
const IMPORT_CHECK_GROUPS = {
  answers: [
    'MISSING_CORRECT',
    'MISSING_ORDER',
    'BLACKBOARD_NO_TEXT_ENTRY_ANSWERS',
    'GIFT_NO_ANSWER',
    'CLOZE_EMPTY',
    'DDWTOS_NO_CORRECT',
  ],
  references: ['INVALID_ANSWER_REFERENCE'],
  media: [
    'RESPONDUS_IMAGE_REQUIRES_ASSET',
    'EXAMVIEW_MEDIA_REQUIRES_REBUILD',
    'IMSCC_RESOURCE_MISSING',
    'QTI_METADATA_FILE_MISSING',
  ],
} as const satisfies Readonly<Record<string, readonly MigrationWarningCode[]>>;

/** Counts are questions, not warning occurrences; package findings are kept separate. */
export type MigrationImportChecks = {
  readonly affected: number;
  readonly groups: readonly {
    readonly kind: keyof typeof IMPORT_CHECK_GROUPS;
    readonly count: number;
    readonly packageFindings: number;
    readonly members: readonly { readonly id: string; readonly position: number }[];
  }[];
};

/** Read recorded import findings only after the caller authorizes access to this run. */
export async function loadMigrationImportChecks(
  database: Pick<QflowDatabase, 'select'>,
  runId: string,
  globalWarnings: readonly ImportWarning[],
  fullReport: boolean,
): Promise<MigrationImportChecks> {
  const scope = and(eq(migrationItems.runId, runId), ne(migrationItems.decision, 'rejected'));
  const definitions = (['answers', 'references', 'media'] as const).map((kind) => {
    const codes = IMPORT_CHECK_GROUPS[kind];
    const codeSet: ReadonlySet<MigrationWarningCode> = new Set(codes);
    const condition = sql`exists (
      select 1 from jsonb_array_elements(${migrationItems.warnings}) finding
      where finding->>'code' in (${sql.join(codes.map((code) => sql`${code}`), sql`, `)})
    )`;
    return { kind, codeSet, condition };
  });
  const [total] = await database.select({ value: count() }).from(migrationItems).where(
    and(scope, or(...definitions.map((d) => d.condition))),
  );
  const groups: MigrationImportChecks['groups'][number][] = [];
  for (const definition of definitions) {
    const query = database.select({
      id: migrationItems.id,
      position: migrationItems.position,
      total: sql<number>`count(*) over ()`.mapWith(Number),
    }).from(migrationItems).where(and(scope, definition.condition))
      .orderBy(migrationItems.position).$dynamic();
    const rows = await (fullReport ? query : query.limit(6));
    groups.push({
      kind: definition.kind,
      count: rows[0]?.total ?? 0,
      packageFindings:
        globalWarnings.filter((warning) => definition.codeSet.has(warning.code)).length,
      members: rows.map((row) => ({ id: row.id, position: row.position })),
    });
  }
  return { affected: total.value, groups };
}
