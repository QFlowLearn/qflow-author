import { and, desc, eq, isNull } from 'drizzle-orm';
import type { QflowDatabaseTransaction } from '../db.ts';
import { bankCollections } from '../db/bank_schema.ts';
import { organizationActivation, organizationSetups } from '../db/question_organization_schema.ts';
import type { EnrichmentDefinition } from './bank_enrichment_contract.ts';
import { parseOrganizationSetup } from './question_organization_contract.ts';
import { uuidV5 } from '../uuid_v5.ts';

/** Advance only unchanged saved policies; future intake learns without queuing a bank rerun. */
export async function advanceOrganizationTeaching(
  tx: QflowDatabaseTransaction,
  operation: { readonly id: string; readonly tenantId: string; readonly createdBy: string },
  previousVersionId: string,
  versionId: string,
  definition: EnrichmentDefinition,
  now: Date,
): Promise<void> {
  const setups = await tx.select({ setup: organizationSetups }).from(organizationSetups)
    .innerJoin(bankCollections, eq(bankCollections.id, organizationSetups.collectionId))
    .where(
      and(
        eq(organizationSetups.tenantId, operation.tenantId),
        eq(organizationSetups.versionId, previousVersionId),
        isNull(bankCollections.archivedAt),
      ),
    )
    .orderBy(organizationSetups.collectionId);
  // Tenant authority is locked by the owning mutation; writes are serialized with setup/activation edits.
  for (const { setup } of setups) {
    const [latest] = await tx.select({ id: organizationSetups.id }).from(organizationSetups)
      .where(eq(organizationSetups.collectionId, setup.collectionId)).orderBy(
        desc(organizationSetups.version),
      ).limit(1);
    if (latest.id !== setup.id) continue;
    const policy = parseOrganizationSetup(setup.policy, definition);
    if (!policy) throw new Error('Invalid teaching setup.');
    const id = await uuidV5(operation.id, `teaching-setup:${setup.id}`);
    await tx.insert(organizationSetups).values({
      id,
      tenantId: operation.tenantId,
      collectionId: setup.collectionId,
      version: setup.version + 1,
      versionId,
      policy: { ...policy, versionId },
      createdBy: operation.createdBy,
      createdAt: now,
    });
    const [activation] = await tx.select().from(organizationActivation).where(
      eq(organizationActivation.collectionId, setup.collectionId),
    );
    if (activation?.setupId !== setup.id) continue;
    await tx.update(organizationActivation).set({
      setupId: id,
      revision: activation.revision + 1,
      operationId: await uuidV5(operation.id, `teaching-activation:${setup.collectionId}`),
      changedBy: operation.createdBy,
      changedAt: now,
    }).where(
      and(
        eq(organizationActivation.collectionId, setup.collectionId),
        eq(organizationActivation.revision, activation.revision),
      ),
    );
  }
}
