import { organizationFiling } from '../db/question_organization_schema.ts';
import { uuidV5 } from '../uuid_v5.ts';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { type BankCollectionCommand, parseBankCollectionCommand } from '../bank_collections.ts';
import { db, type QflowDatabase, type QflowDatabaseTransaction } from '../db.ts';
import { bankCollectionItems, bankCollections, editorialEvents } from '../db/bank_schema.ts';
import { organizationMemberships, tenants, users } from '../db/principal_schema.ts';
import { questions } from '../db/question_schema.ts';
import { hasCapability, parseRole } from '../roles.ts';
import type { RequestContext } from '../tenants.ts';
import { isCanonicalUuid } from '../uuid.ts';

/** Explicit failures for collection mutations; successful retries identify the original collection. */
export type BankCollectionResult =
  | { readonly ok: true; readonly collectionId: string }
  | {
    readonly ok: false;
    readonly code:
      | 'invalid_command'
      | 'forbidden'
      | 'not_found'
      | 'archived'
      | 'invalid_selection'
      | 'operation_conflict'
      | 'already_exists';
  };

/** Atomic, tenant-scoped mutation and receipt, serialized with membership changes and other filing. */
export async function applyBankCollectionCommand(
  ctx: RequestContext,
  operationId: string,
  input: unknown,
  dependencies: { readonly database: QflowDatabase; readonly now: () => Date } = {
    database: db,
    now: () => new Date(),
  },
): Promise<BankCollectionResult> {
  return await dependencies.database.transaction((tx) =>
    applyBankCollectionCommandInTransaction(tx, ctx, operationId, input, dependencies.now())
  );
}

/** Apply a collection command and its receipt inside the caller's atomic transaction. */
export async function applyBankCollectionCommandInTransaction(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  operationId: string,
  input: unknown,
  now: Date,
): Promise<BankCollectionResult> {
  const command = parseBankCollectionCommand(input);
  if (!command || !isCanonicalUuid(operationId)) return { ok: false, code: 'invalid_command' };

  const tenant = await tx.select({ id: tenants.id }).from(tenants).where(
    eq(tenants.id, ctx.tenantId),
  ).for('update');
  if (!tenant.length) return { ok: false, code: 'forbidden' };
  const actor = await tx.select({
    role: organizationMemberships.role,
    displayName: users.displayName,
    email: users.email,
  }).from(organizationMemberships)
    .innerJoin(users, eq(users.id, organizationMemberships.userId))
    .where(
      and(
        eq(organizationMemberships.tenantId, ctx.tenantId),
        eq(organizationMemberships.userId, ctx.userId),
      ),
    );
  const role = parseRole(actor[0]?.role);
  if (!role || !hasCapability(role, 'manage_content')) return { ok: false, code: 'forbidden' };
  const receipt = await tx.select().from(editorialEvents).where(
    and(eq(editorialEvents.tenantId, ctx.tenantId), eq(editorialEvents.operationId, operationId)),
  );
  if (receipt.length) {
    const recorded = parseBankCollectionCommand(receipt[0].command);
    if (!recorded) throw new Error('Invalid persisted collection receipt.');
    return receipt[0].actorUserId === ctx.userId &&
        JSON.stringify(recorded) === JSON.stringify(command)
      ? { ok: true, collectionId: recorded.collectionId }
      : { ok: false, code: 'operation_conflict' };
  }
  const existing = await tx.select().from(bankCollections).where(
    and(eq(bankCollections.tenantId, ctx.tenantId), eq(bankCollections.id, command.collectionId)),
  );
  if (command._tag === 'Create' && existing.length) return { ok: false, code: 'already_exists' };
  if (command._tag !== 'Create' && !existing.length) return { ok: false, code: 'not_found' };
  if (existing[0]?.archivedAt && command._tag !== 'Restore' && command._tag !== 'Archive') {
    return { ok: false, code: 'archived' };
  }

  const result = await mutateCollection(tx, ctx.tenantId, command, now);
  if (!result.ok) return result;
  if (command._tag === 'AddItems' || command._tag === 'RemoveItems') {
    await tx.insert(organizationFiling).values(command.questionIds.map((questionId) => ({
      tenantId: ctx.tenantId,
      collectionId: command.collectionId,
      questionId,
      changeId: operationId,
      origin: 'human',
      state: command._tag === 'AddItems' ? 'present' : 'removed',
    }))).onConflictDoUpdate({
      target: [organizationFiling.collectionId, organizationFiling.questionId],
      set: {
        changeId: operationId,
        origin: 'human',
        state: command._tag === 'AddItems' ? 'present' : 'removed',
      },
    });
  }

  await tx.insert(editorialEvents).values({
    tenantId: ctx.tenantId,
    operationId,
    actorUserId: ctx.userId,
    actorLabel: actor[0].displayName?.trim() || actor[0].email,
    action: command._tag,
    collectionId: command.collectionId,
    command: { ...command },
    createdAt: now,
  });
  return result;
}

/** Lists workspace collections in stable navigation order; archived collections are opt-in. */
export async function listBankCollections(
  ctx: RequestContext,
  includeArchived = false,
  database: QflowDatabase = db,
) {
  const membership = await database.select({ role: organizationMemberships.role }).from(
    organizationMemberships,
  )
    .where(
      and(
        eq(organizationMemberships.tenantId, ctx.tenantId),
        eq(organizationMemberships.userId, ctx.userId),
      ),
    );
  const role = parseRole(membership[0]?.role);
  if (!role || !hasCapability(role, 'view_content')) {
    return { ok: false, code: 'forbidden' } as const;
  }
  const collections = await database.select().from(bankCollections).where(
    and(
      eq(bankCollections.tenantId, ctx.tenantId),
      includeArchived ? undefined : isNull(bankCollections.archivedAt),
    ),
  )
    .orderBy(asc(bankCollections.position), asc(bankCollections.id));
  return { ok: true, collections } as const;
}

async function mutateCollection(
  tx: QflowDatabaseTransaction,
  tenantId: string,
  command: BankCollectionCommand,
  now: Date,
): Promise<BankCollectionResult> {
  const where = and(
    eq(bankCollections.tenantId, tenantId),
    eq(bankCollections.id, command.collectionId),
  );
  switch (command._tag) {
    case 'Create': {
      const created = await tx.insert(bankCollections).values({
        id: command.collectionId,
        tenantId,
        name: command.name,
        description: command.description,
        position: command.position,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing().returning({ id: bankCollections.id });
      if (!created.length) return { ok: false, code: 'already_exists' };
      break;
    }
    case 'Update':
      await tx.update(bankCollections).set({
        name: command.name,
        description: command.description,
        position: command.position,
        updatedAt: now,
      }).where(where);
      break;
    case 'Archive':
    case 'Restore':
      await tx.update(bankCollections).set({
        archivedAt: command._tag === 'Archive' ? now : null,
        updatedAt: now,
      }).where(where);
      break;
    case 'AddItems':
    case 'RemoveItems':
    case 'ReorderItems': {
      const selected = await tx.select({ id: questions.id }).from(questions).where(
        and(eq(questions.tenantId, tenantId), inArray(questions.id, [...command.questionIds])),
      ).orderBy(questions.id).for('key share');
      if (selected.length !== command.questionIds.length) {
        return { ok: false, code: 'invalid_selection' };
      }
      const scope = and(
        eq(bankCollectionItems.tenantId, tenantId),
        eq(bankCollectionItems.collectionId, command.collectionId),
      );
      const current = await tx.select().from(bankCollectionItems).where(scope).orderBy(
        bankCollectionItems.position,
        bankCollectionItems.questionId,
      );
      if (command._tag === 'ReorderItems') {
        // Require the complete current set, so concurrent additions cannot silently disappear.
        if (
          current.length !== command.questionIds.length ||
          current.some((row) => !command.questionIds.includes(row.questionId))
        ) return { ok: false, code: 'invalid_selection' };
        for (const [position, questionId] of command.questionIds.entries()) {
          await tx.update(bankCollectionItems).set({ position }).where(
            and(scope, eq(bankCollectionItems.questionId, questionId)),
          );
        }
      } else if (command._tag === 'RemoveItems') {
        await tx.delete(bankCollectionItems).where(
          and(scope, inArray(bankCollectionItems.questionId, [...command.questionIds])),
        );
      } else {
        const filed = new Set(current.map((row) => row.questionId));
        const added = command.questionIds.filter((id) => !filed.has(id));
        const start = (current.at(-1)?.position ?? -1) + 1;
        if (start + added.length > 2147483647) return { ok: false, code: 'invalid_selection' };
        if (added.length) {
          await tx.insert(bankCollectionItems).values(
            added.map((questionId, index) => ({
              tenantId,
              collectionId: command.collectionId,
              questionId,
              position: start + index,
            })),
          );
        }
      }
      await tx.update(bankCollections).set({ updatedAt: now }).where(where);
      break;
    }
  }
  return { ok: true, collectionId: command.collectionId };
}

/** A filing failure aborts the enclosing publication transaction before boundary translation. */
export class BankFilingFailure extends Error {
  constructor(readonly code: Exclude<BankCollectionResult, { readonly ok: true }>['code']) {
    super('Question filing could not be completed.');
  }
}

/** File published questions through the collection command owner, including bounded retry receipts. */
export async function filePublishedBankQuestionsInTransaction(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  collectionId: string,
  questionIds: readonly string[],
  now: Date,
): Promise<void> {
  for (let offset = 0; offset < questionIds.length; offset += 500) {
    const selected = questionIds.slice(offset, offset + 500);
    const operationId = await uuidV5(collectionId, `publication-filing:${selected.join(',')}`);
    const result = await applyBankCollectionCommandInTransaction(tx, ctx, operationId, {
      _tag: 'AddItems',
      collectionId,
      questionIds: selected,
    }, now);
    if (!result.ok) throw new BankFilingFailure(result.code);
  }
}
