import { and, eq, isNull, sql } from 'drizzle-orm';
import type { QflowDatabaseTransaction } from '../db.ts';
import { bankCollections } from '../db/bank_schema.ts';
import { conversionSourceArtifacts, migrationRuns } from '../db/migration_schema.ts';
import { organizationOrigins } from '../db/question_organization_schema.ts';
import { questionRevisions, questions } from '../db/question_schema.ts';
import { parseOrganizationSource } from './question_organization_contract.ts';

/** Read source proposals captured at import; do not infer new groups while loading the bank. */
export async function loadOrganizationSections(tx: QflowDatabaseTransaction, tenantId: string) {
  const section =
    sql`jsonb_to_recordset(${migrationRuns.organizationGroups}) AS section(id text, title text)`;
  const rows = await tx.select({
    collectionId: organizationOrigins.collectionId,
    sourceId: conversionSourceArtifacts.id,
    sectionKey: sql<unknown>`section.id`,
    title: sql<unknown>`section.title`,
    filename: conversionSourceArtifacts.filename,
    count: sql<number>`count(*)`.mapWith(Number),
  }).from(organizationOrigins).innerJoin(
    questions,
    and(eq(questions.id, organizationOrigins.questionId), eq(questions.tenantId, tenantId)),
  ).innerJoin(questionRevisions, eq(questionRevisions.id, questions.latestRevisionId))
    .innerJoin(bankCollections, eq(bankCollections.id, organizationOrigins.collectionId))
    .innerJoin(
      conversionSourceArtifacts,
      and(
        sql`${conversionSourceArtifacts.id}::text = ${organizationOrigins.source}->>'sourceId'`,
        eq(conversionSourceArtifacts.kind, 'original'),
      ),
    ).innerJoin(
      migrationRuns,
      and(
        eq(migrationRuns.id, conversionSourceArtifacts.runId),
        eq(migrationRuns.tenantId, tenantId),
      ),
    ).innerJoin(section, sql`section.id = ${organizationOrigins.source}->>'sectionKey'`)
    .where(and(
      eq(organizationOrigins.tenantId, tenantId),
      eq(questions.lifecycleState, 'active'),
      eq(questionRevisions.draftState, 'published'),
      isNull(bankCollections.archivedAt),
    )).groupBy(
      organizationOrigins.collectionId,
      conversionSourceArtifacts.id,
      sql`section.id`,
      sql`section.title`,
    ).orderBy(organizationOrigins.collectionId, conversionSourceArtifacts.id, sql`section.id`)
    .limit(1001);
  const sections = rows.slice(0, 1000).map((row) => {
    const source = parseOrganizationSource({ sourceId: row.sourceId, sectionKey: row.sectionKey });
    if (!source || typeof row.title !== 'string' || !row.title.trim()) {
      throw new Error('Invalid imported organization section.');
    }
    return {
      ...source,
      collectionId: row.collectionId,
      title: row.title,
      filename: row.filename,
      count: row.count,
    };
  });
  return { sections, limited: rows.length > 1000 };
}
