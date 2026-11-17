import {
  hasWorkspaceCapability,
  lockWorkspaceAndRequireAuthority,
} from './workspace_authorization.ts';
import { and, eq } from 'drizzle-orm';
import { bankCollections } from '../db/bank_schema.ts';
import { db, type DbReadConnection } from '../db.ts';
import type { RequestContext } from '../tenants.ts';
import type { QuestionTransaction } from './questions.ts';

/** Serialize bank intake with membership and collection mutations, then check the current actor. */
export async function authorizeBankIntakeInTransaction(
  tx: QuestionTransaction,
  ctx: RequestContext,
  collectionId: string | null,
): Promise<boolean> {
  if (!await lockWorkspaceAndRequireAuthority(tx, ctx, { capability: 'manage_content' })) {
    return false;
  }
  return await bankCollectionAcceptsIntake(tx, ctx, collectionId);
}

/** Check a bank entry destination for display; mutations must authorize again under their lock. */
export async function canStartBankIntake(
  ctx: RequestContext,
  collectionId: string | null,
  database: DbReadConnection = db,
): Promise<boolean> {
  return await hasWorkspaceCapability(ctx, 'manage_content', database) &&
    await bankCollectionAcceptsIntake(database, ctx, collectionId);
}

/** Check only the bank destination after the caller establishes current content authorization. */
export async function bankCollectionAcceptsIntake(
  tx: DbReadConnection,
  ctx: RequestContext,
  collectionId: string | null,
): Promise<boolean> {
  if (collectionId === null) return true;
  const [collection] = await tx.select({ archivedAt: bankCollections.archivedAt }).from(
    bankCollections,
  )
    .where(and(eq(bankCollections.tenantId, ctx.tenantId), eq(bankCollections.id, collectionId)));
  return collection !== undefined && collection.archivedAt === null;
}
