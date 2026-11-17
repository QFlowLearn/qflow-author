import { and, eq, isNull, sql } from 'drizzle-orm';
import type { QflowDatabase, QflowDatabaseTransaction } from '../db.ts';
import { bankCollections } from '../db/bank_schema.ts';
import { organizationActivation, organizationSetups } from '../db/question_organization_schema.ts';
import { safeErrorSummary } from '../error_summary.ts';
import { isCanonicalUuid } from '../uuid.ts';
import type { RequestContext } from '../tenants.ts';
import { authorizeEnrichment } from './bank_enrichment_access.ts';
import type { EnrichmentResult } from './bank_enrichment_contract.ts';
import type { OrganizationFailure } from './question_organization_contract.ts';

/** Revision checks prevent an old browser tab or a retried request from re-enabling disabled rules. */
export type OrganizationActivationCommand = {
  readonly collectionId: string;
  readonly setupId: string | null;
  readonly operationId: string;
  readonly expectedRevision: number;
};

/** Change only future intake. Saved policies and already queued runs remain immutable. */
export async function setOrganizationActivation(
  database: QflowDatabase,
  ctx: RequestContext,
  input: OrganizationActivationCommand,
  now: Date,
): Promise<EnrichmentResult<number, OrganizationFailure>> {
  try {
    return await database.transaction((tx) =>
      setOrganizationActivationInTransaction(tx, ctx, input, now)
    );
  } catch (cause) {
    console.error('Organization activation failed', safeErrorSummary(cause));
    return { ok: false, code: 'storage_failed' };
  }
}

/** Compose activation with an accepted run in one transaction; no model call occurs here. */
export async function setOrganizationActivationInTransaction(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  input: OrganizationActivationCommand,
  now: Date,
): Promise<EnrichmentResult<number, OrganizationFailure>> {
  if (
    !isCanonicalUuid(input.collectionId) || !isCanonicalUuid(input.operationId) ||
    (input.setupId !== null && !isCanonicalUuid(input.setupId)) ||
    !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 ||
    input.expectedRevision >= 2147483647
  ) {
    return { ok: false, code: 'invalid_input' };
  }
  if (!await authorizeEnrichment(tx, ctx, 'manage_content')) {
    return { ok: false, code: 'forbidden' };
  }
  const [collection] = await tx.select().from(bankCollections).where(and(
    eq(bankCollections.id, input.collectionId),
    eq(bankCollections.tenantId, ctx.tenantId),
    isNull(bankCollections.archivedAt),
  )).for('update');
  if (!collection) return { ok: false, code: 'not_found' };
  if (input.setupId !== null) {
    const [setup] = await tx.select().from(organizationSetups).where(and(
      eq(organizationSetups.id, input.setupId),
      eq(organizationSetups.tenantId, ctx.tenantId),
      eq(organizationSetups.collectionId, collection.id),
    ));
    if (!setup) return { ok: false, code: 'invalid_input' };
  }
  const [current] = await tx.select().from(organizationActivation).where(
    eq(organizationActivation.collectionId, collection.id),
  );
  if (current?.operationId === input.operationId) {
    return current.setupId === input.setupId && current.changedBy === ctx.userId &&
        current.revision === input.expectedRevision + 1
      ? { ok: true, value: current.revision }
      : { ok: false, code: 'conflict' };
  }
  if ((current?.revision ?? 0) !== input.expectedRevision) return { ok: false, code: 'conflict' };
  if (input.setupId !== null) {
    // Explicit activation establishes an origin for older bank questions that do not have one.
    // Existing origin/source identities are never reassigned by filing into another collection.
    await tx.execute(
      sql`INSERT INTO question_organization_origins (tenant_id, question_id, collection_id)
      SELECT tenant_id, question_id, collection_id FROM bank_collection_items
      WHERE tenant_id = ${ctx.tenantId} AND collection_id = ${collection.id}
      ON CONFLICT (question_id) DO NOTHING`,
    );
  }
  const next = {
    setupId: input.setupId,
    revision: input.expectedRevision + 1,
    operationId: input.operationId,
    changedBy: ctx.userId,
    changedAt: now,
  };
  await tx.insert(organizationActivation).values({
    tenantId: ctx.tenantId,
    collectionId: collection.id,
    ...next,
  }).onConflictDoUpdate({ target: organizationActivation.collectionId, set: next });
  return { ok: true, value: next.revision };
}
