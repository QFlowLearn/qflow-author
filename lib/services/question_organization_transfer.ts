import { and, desc, eq, inArray } from 'drizzle-orm';
import type { DbReadConnection, QflowDatabaseTransaction } from '../db.ts';
import {
  enrichmentAssignments,
  enrichmentChanges,
  enrichmentSchemes,
  enrichmentSchemeVersions,
} from '../db/bank_enrichment_schema.ts';
import { canonicalJsonStringify } from '../canonical_json.ts';
import {
  type OrganizationTransfer,
  parseOrganizationTransfer,
  portableDefinition,
} from '../organization_transfer.ts';
import { parseEnrichmentDefinition } from './bank_enrichment_contract.ts';
import { loadEnrichmentChanges } from './bank_enrichment_changes.ts';
import { authorizeEnrichment } from './bank_enrichment_access.ts';
import type { RequestContext } from '../tenants.ts';
import { uuidV5 } from '../uuid_v5.ts';

/** Load only current assignments bound to the exact selected revision; never export stale labels. */
export async function loadOrganizationTransfers(
  database: DbReadConnection,
  tenantId: string,
  refs: readonly { questionId: string; revisionId: string }[],
): Promise<{
  readonly transfers: ReadonlyMap<string, OrganizationTransfer>;
  readonly omittedRevisionIds: readonly string[];
}> {
  const output = new Map<string, OrganizationTransfer>();
  const omittedRevisionIds = new Set<string>();
  for (let offset = 0; offset < refs.length; offset += 20) {
    const batch = refs.slice(offset, offset + 20);
    const rows = await database.select({
      assignment: enrichmentAssignments,
      scheme: enrichmentSchemes,
      version: enrichmentSchemeVersions,
      change: enrichmentChanges,
    })
      .from(enrichmentAssignments)
      .innerJoin(enrichmentChanges, eq(enrichmentChanges.id, enrichmentAssignments.changeId))
      .innerJoin(enrichmentSchemes, eq(enrichmentSchemes.id, enrichmentAssignments.schemeId))
      .innerJoin(
        enrichmentSchemeVersions,
        eq(enrichmentSchemeVersions.id, enrichmentChanges.versionId),
      )
      .where(
        and(
          eq(enrichmentAssignments.tenantId, tenantId),
          inArray(
            enrichmentAssignments.questionId,
            batch.map((r) => r.questionId),
          ),
        ),
      );
    const parsed = new Map<string, Awaited<ReturnType<typeof loadEnrichmentChanges>>>();
    for (const schemeId of new Set(rows.map((r) => r.scheme.id))) {
      parsed.set(
        schemeId,
        await loadEnrichmentChanges(
          database,
          tenantId,
          schemeId,
          rows.filter((r) => r.scheme.id === schemeId).map((r) => r.change.id),
        ),
      );
    }
    for (const ref of batch) {
      const vocabularies = new Map<string, OrganizationTransfer['vocabularies'][number]>();
      const assignments: OrganizationTransfer['assignments'][number][] = [];
      for (const row of rows.filter((r) => r.assignment.questionId === ref.questionId)) {
        const change = parsed.get(row.scheme.id)?.get(row.change.id);
        if (!change) throw new Error('Organization export history is missing.');
        // An undo of absence has no portable assignment. Its local concurrency fence stays local.
        if (change.value === null) continue;
        if (change.revisionId !== ref.revisionId) {
          omittedRevisionIds.add(ref.revisionId);
          continue;
        }
        vocabularies.set(row.version.portableId, {
          schemeId: row.scheme.portableId,
          versionId: row.version.portableId,
          definition: portableDefinition(change.definition),
        });
        assignments.push({
          schemeId: row.scheme.portableId,
          versionId: row.version.portableId,
          dimension: change.dimension,
          value: change.value,
        });
      }
      if (assignments.length) {
        output.set(
          ref.revisionId,
          parseOrganizationTransfer({
            schema: 'qflow.organization.v1',
            vocabularies: [...vocabularies.values()].sort((a, b) =>
              a.versionId.localeCompare(b.versionId)
            ),
            assignments: assignments.sort((a, b) =>
              `${a.schemeId}:${a.dimension}`.localeCompare(`${b.schemeId}:${b.dimension}`)
            ),
          }),
        );
      }
    }
  }
  return { transfers: output, omittedRevisionIds: [...omittedRevisionIds].sort() };
}

/** Consume approved source assignments before automatic intake captures its baseline. */
export async function importOrganizationTransfers(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  items: readonly { questionId: string; revisionId: string; transfer: OrganizationTransfer }[],
  now: Date,
): Promise<void> {
  if (!items.length) return;
  if (!await authorizeEnrichment(tx, ctx, 'manage_content')) {
    throw new Error('Organization import is forbidden.');
  }
  const catalog = new Map<
    string,
    { schemeId: string; versionId: string; portableSchemeId: string; definition: string }
  >();
  for (const item of items) {
    for (const vocabulary of item.transfer.vocabularies) {
      const definition = canonicalJsonStringify(vocabulary.definition);
      const cached = catalog.get(vocabulary.versionId);
      if (cached) {
        if (cached.definition !== definition || cached.portableSchemeId !== vocabulary.schemeId) {
          throw new Error('Conflicting portable vocabulary.');
        }
        continue;
      }
      let [scheme] = await tx.select().from(enrichmentSchemes).where(
        and(
          eq(enrichmentSchemes.tenantId, ctx.tenantId),
          eq(enrichmentSchemes.portableId, vocabulary.schemeId),
        ),
      );
      if (!scheme) {
        [scheme] = await tx.insert(enrichmentSchemes).values({
          id: await uuidV5(ctx.tenantId, `organization-scheme:${vocabulary.schemeId}`),
          portableId: vocabulary.schemeId,
          tenantId: ctx.tenantId,
          createdBy: ctx.userId,
          createdAt: now,
        }).returning();
      }
      let [version] = await tx.select().from(enrichmentSchemeVersions).where(
        and(
          eq(enrichmentSchemeVersions.tenantId, ctx.tenantId),
          eq(enrichmentSchemeVersions.portableId, vocabulary.versionId),
        ),
      );
      if (version) {
        const stored = parseEnrichmentDefinition(version.definition);
        if (
          version.schemeId !== scheme.id || !stored ||
          canonicalJsonStringify(portableDefinition(stored)) !== definition
        ) throw new Error('Conflicting portable vocabulary.');
      } else {
        const [latest] = await tx.select().from(enrichmentSchemeVersions).where(
          eq(enrichmentSchemeVersions.schemeId, scheme.id),
        ).orderBy(desc(enrichmentSchemeVersions.version)).limit(1);
        [version] = await tx.insert(enrichmentSchemeVersions).values({
          id: await uuidV5(ctx.tenantId, `organization-version:${vocabulary.versionId}`),
          portableId: vocabulary.versionId,
          schemeId: scheme.id,
          tenantId: ctx.tenantId,
          version: (latest?.version ?? 0) + 1,
          definition: vocabulary.definition,
          createdBy: ctx.userId,
          createdAt: now,
        }).returning();
      }
      catalog.set(vocabulary.versionId, {
        schemeId: scheme.id,
        versionId: version.id,
        portableSchemeId: vocabulary.schemeId,
        definition,
      });
    }
    for (const assignment of item.transfer.assignments) {
      const vocabulary = catalog.get(assignment.versionId);
      if (!vocabulary) throw new Error('Missing imported vocabulary.');
      const id = await uuidV5(
        item.revisionId,
        `import-organization:${vocabulary.schemeId}:${assignment.dimension}`,
      );
      await tx.insert(enrichmentChanges).values({
        id,
        tenantId: ctx.tenantId,
        questionId: item.questionId,
        revisionId: item.revisionId,
        schemeId: vocabulary.schemeId,
        versionId: vocabulary.versionId,
        dimension: assignment.dimension,
        value: assignment.value,
        origin: 'source',
        operationId: item.revisionId,
        previousChangeId: null,
        createdBy: ctx.userId,
        createdAt: now,
      });
      await tx.insert(enrichmentAssignments).values({
        tenantId: ctx.tenantId,
        schemeId: vocabulary.schemeId,
        questionId: item.questionId,
        dimension: assignment.dimension,
        changeId: id,
      });
    }
  }
}
