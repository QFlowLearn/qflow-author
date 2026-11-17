import { and, eq, inArray } from 'drizzle-orm';
import type { DbReadConnection } from '../db.ts';
import {
  enrichmentAssignments,
  enrichmentChanges,
  enrichmentSchemeVersions,
} from '../db/bank_enrichment_schema.ts';
import { isCanonicalUuid } from '../uuid.ts';
import {
  type EnrichmentDefinition,
  type EnrichmentDimension,
  parseEnrichmentDefinition,
} from './bank_enrichment_contract.ts';
import { parseEnrichmentChangeValue } from './bank_enrichment_change_contract.ts';
import type { CurrentEnrichmentValue } from './bank_enrichment_apply_policy.ts';

/** A parsed ledger entry retains the source, vocabulary and predecessor needed by compensation. */
export type EnrichmentStoredChange = CurrentEnrichmentValue & {
  readonly questionId: string;
  readonly revisionId: string;
  readonly versionId: string;
  readonly dimension: EnrichmentDimension;
  readonly operationId: string;
  readonly previousChangeId: string | null;
};
/** All dimensions have an explicit current token or no prior change. */
export type EnrichmentCurrentChanges = Readonly<
  Record<EnrichmentDimension, EnrichmentStoredChange | null>
>;

/** Load referenced ledger entries once per producing version; references come from authorized DB records. */
export async function loadEnrichmentChanges(
  database: DbReadConnection,
  tenantId: string,
  schemeId: string,
  ids: readonly string[],
): Promise<ReadonlyMap<string, EnrichmentStoredChange>> {
  const unique = [...new Set(ids)];
  if (unique.length > 120 || unique.some((id) => !isCanonicalUuid(id))) {
    throw new Error('Invalid enrichment change selection.');
  }
  if (!unique.length) return new Map();
  const rows = await database.select().from(enrichmentChanges).where(
    and(
      eq(enrichmentChanges.tenantId, tenantId),
      eq(enrichmentChanges.schemeId, schemeId),
      inArray(enrichmentChanges.id, unique),
    ),
  );
  if (rows.length !== unique.length) throw new Error('Missing enrichment history reference.');
  const versions = await database.select().from(enrichmentSchemeVersions).where(
    and(
      eq(enrichmentSchemeVersions.tenantId, tenantId),
      eq(enrichmentSchemeVersions.schemeId, schemeId),
      inArray(enrichmentSchemeVersions.id, [...new Set(rows.map((row) => row.versionId))]),
    ),
  );
  const definitions = new Map<string, EnrichmentDefinition>();
  for (const version of versions) {
    const definition = parseEnrichmentDefinition(version.definition);
    if (!definition) throw new Error('Invalid enrichment history vocabulary.');
    definitions.set(version.id, definition);
  }
  const changes = new Map<string, EnrichmentStoredChange>();
  for (const row of rows) {
    const definition = definitions.get(row.versionId),
      dimension = row.dimension,
      origin = row.origin;
    if (
      !definition ||
      (dimension !== 'subject' && dimension !== 'topic' && dimension !== 'difficulty') ||
      (origin !== 'ai' && origin !== 'human' && origin !== 'undo' && origin !== 'source') ||
      ![row.id, row.questionId, row.revisionId, row.versionId, row.operationId].every(
        isCanonicalUuid,
      ) || row.previousChangeId !== null && !isCanonicalUuid(row.previousChangeId)
    ) throw new Error('Invalid enrichment history identity.');
    const value = parseEnrichmentChangeValue(row.value, dimension, definition);
    if (
      !value || value.state === 'absent' && (origin !== 'undo' || row.previousChangeId === null)
    ) throw new Error('Invalid enrichment history value.');
    changes.set(row.id, {
      changeId: row.id,
      questionId: row.questionId,
      revisionId: row.revisionId,
      versionId: row.versionId,
      dimension,
      operationId: row.operationId,
      previousChangeId: row.previousChangeId,
      definition,
      origin,
      value: value.state === 'absent' ? null : value,
    });
  }
  return changes;
}

/** Current pointers remain present even when an undo restored absence. */
export async function loadCurrentEnrichmentChanges(
  database: DbReadConnection,
  tenantId: string,
  schemeId: string,
  questionIds: readonly string[],
): Promise<ReadonlyMap<string, EnrichmentCurrentChanges>> {
  if (
    !questionIds.length || questionIds.length > 20 ||
    questionIds.some((id) => !isCanonicalUuid(id)) ||
    new Set(questionIds).size !== questionIds.length
  ) throw new Error('Invalid current enrichment selection.');
  const assignments = await database.select().from(enrichmentAssignments).where(
    and(
      eq(enrichmentAssignments.tenantId, tenantId),
      eq(enrichmentAssignments.schemeId, schemeId),
      inArray(enrichmentAssignments.questionId, questionIds),
    ),
  );
  const records = await loadEnrichmentChanges(
    database,
    tenantId,
    schemeId,
    assignments.map((a) => a.changeId),
  );
  const current = new Map<string, Record<EnrichmentDimension, EnrichmentStoredChange | null>>(
    questionIds.map((id) => [id, { subject: null, topic: null, difficulty: null }]),
  );
  for (const assignment of assignments) {
    const row = records.get(assignment.changeId), values = current.get(assignment.questionId);
    if (
      !row || !values || row.questionId !== assignment.questionId ||
      row.dimension !== assignment.dimension
    ) throw new Error('Invalid current enrichment pointer.');
    values[row.dimension] = row;
  }
  return current;
}
