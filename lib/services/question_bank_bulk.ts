import { applyBankCollectionCommand } from './bank_collections.ts';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db.ts';
import { organizationMemberships, questions } from '../db/schema.ts';
import { hasCapability } from '../roles.ts';
import { type RequestContext, resolveUserId } from '../tenants.ts';
import { isCanonicalUuid } from '../uuid.ts';
import { recordAuditEventInTransaction } from './audit_logs.ts';
import { normalizeQuestionBankTags } from './question_bank_tags.ts';

export type QuestionBankBulkCommand =
  | {
    readonly _tag: 'AddToCollection';
    readonly questionIds: readonly string[];
    readonly collectionId: string;
    readonly operationId: string;
  }
  | {
    readonly _tag: 'RemoveFromCollection';
    readonly questionIds: readonly string[];
    readonly collectionId: string;
    readonly operationId: string;
  }
  | {
    readonly _tag: 'AddTags';
    readonly questionIds: readonly string[];
    readonly tags: readonly string[];
  }
  | {
    readonly _tag: 'RemoveTags';
    readonly questionIds: readonly string[];
    readonly tags: readonly string[];
  }
  | { readonly _tag: 'Archive'; readonly questionIds: readonly string[] }
  | { readonly _tag: 'Restore'; readonly questionIds: readonly string[] }
  | {
    readonly _tag: 'TransferOwnership';
    readonly questionIds: readonly string[];
    readonly ownerUserId: string;
  };

/** Stable result contract for item-bank bulk presentation. */
export type QuestionBankBulkResult =
  | { readonly ok: true; readonly changed: number }
  | {
    readonly ok: false;
    readonly code:
      | 'forbidden'
      | 'invalid_selection'
      | 'invalid_state'
      | 'owner_not_member'
      | 'collection_rejected';
    readonly message: string;
  };

/** Applies one all-or-nothing, tenant-scoped bank command and records its actor and targets. */
export async function applyQuestionBankBulkCommand(
  ctx: RequestContext,
  command: QuestionBankBulkCommand,
): Promise<QuestionBankBulkResult> {
  if (!hasCapability(ctx.role, 'manage_content')) {
    return { ok: false, code: 'forbidden', message: 'You cannot change item-bank content.' };
  }
  const ids = [...new Set(command.questionIds)];
  if (!ids.length || ids.length > 100 || ids.some((id) => !isCanonicalUuid(id))) {
    return { ok: false, code: 'invalid_selection', message: 'Select between 1 and 100 items.' };
  }
  if (command._tag === 'AddToCollection' || command._tag === 'RemoveFromCollection') {
    const result = await applyBankCollectionCommand(ctx, command.operationId, {
      _tag: command._tag === 'AddToCollection' ? 'AddItems' : 'RemoveItems',
      collectionId: command.collectionId,
      questionIds: ids,
    });
    return result.ok ? { ok: true, changed: ids.length } : {
      ok: false,
      code: result.code === 'forbidden' ? 'forbidden' : 'collection_rejected',
      message: 'Choose an active collection and available questions, then refresh and try again.',
    };
  }
  if (command._tag === 'TransferOwnership' && !isCanonicalUuid(command.ownerUserId)) {
    return { ok: false, code: 'owner_not_member', message: 'Choose a current workspace member.' };
  }
  if (command._tag === 'AddTags' || command._tag === 'RemoveTags') {
    const commandTags = normalizeQuestionBankTags(command.tags);
    if (
      !commandTags.length || commandTags.length > 20 ||
      commandTags.some((tag) => tag.length > 80)
    ) {
      return {
        ok: false,
        code: 'invalid_selection',
        message: 'Enter between 1 and 20 tags, with no tag longer than 80 characters.',
      };
    }
  }
  return await db.transaction(async (tx) => {
    const rows = await tx.select({
      id: questions.id,
      tags: questions.tags,
      lifecycle: questions.lifecycleState,
    }).from(questions).where(and(
      eq(questions.tenantId, ctx.tenantId),
      inArray(questions.id, ids),
    )).for('update');
    if (rows.length !== ids.length) {
      return {
        ok: false,
        code: 'invalid_selection',
        message: 'One or more selected items are unavailable.',
      };
    }
    const actor = resolveUserId(ctx);
    const now = new Date();
    if (command._tag === 'Archive' || command._tag === 'Restore') {
      const expected = command._tag === 'Archive' ? 'active' : 'archived';
      if (rows.some((row) => row.lifecycle !== expected)) {
        return {
          ok: false,
          code: 'invalid_state',
          message: command._tag === 'Archive'
            ? 'Only active items can be archived.'
            : 'Only archived items can be restored.',
        };
      }
      await tx.update(questions).set(
        command._tag === 'Archive'
          ? { lifecycleState: 'archived', archivedAt: now, archivedBy: actor, updatedAt: now }
          : { lifecycleState: 'active', archivedAt: null, archivedBy: null, updatedAt: now },
      )
        .where(and(eq(questions.tenantId, ctx.tenantId), inArray(questions.id, ids)));
    } else if (command._tag === 'TransferOwnership') {
      const membership = await tx.select({ id: organizationMemberships.id })
        .from(organizationMemberships)
        .where(and(
          eq(organizationMemberships.tenantId, ctx.tenantId),
          eq(organizationMemberships.userId, command.ownerUserId),
        )).limit(1);
      if (!membership.length) {
        return {
          ok: false,
          code: 'owner_not_member',
          message: 'Choose a current workspace member.',
        };
      }
      await tx.update(questions).set({ ownerUserId: command.ownerUserId, updatedAt: now })
        .where(and(eq(questions.tenantId, ctx.tenantId), inArray(questions.id, ids)));
    } else {
      const tags = normalizeQuestionBankTags(command.tags);
      const updates = rows.map((row) => {
        const current = normalizeQuestionBankTags(row.tags);
        const next = command._tag === 'AddTags'
          ? normalizeQuestionBankTags([...current, ...tags])
          : current.filter((tag) => !tags.includes(tag));
        return { id: row.id, tags: next };
      });
      if (updates.some((update) => update.tags.length > 20)) {
        return {
          ok: false,
          code: 'invalid_selection',
          message: 'An item cannot have more than 20 tags.',
        };
      }
      for (const update of updates) {
        await tx.update(questions).set({ tags: update.tags, updatedAt: now }).where(and(
          eq(questions.id, update.id),
          eq(questions.tenantId, ctx.tenantId),
        ));
      }
    }
    await recordAuditEventInTransaction(tx, {
      tenantId: ctx.tenantId,
      actorUserId: actor,
      action: `question_bank.${bulkAuditAction(command)}`,
      metadata: { questionIds: ids, changed: ids.length },
      ...(command._tag === 'TransferOwnership' ? { targetUserId: command.ownerUserId } : {}),
    });
    return { ok: true, changed: ids.length };
  });
}

function bulkAuditAction(command: QuestionBankBulkCommand): string {
  switch (command._tag) {
    case 'AddToCollection':
      return 'collection_added';
    case 'RemoveFromCollection':
      return 'collection_removed';
    case 'AddTags':
      return 'tags_added';
    case 'RemoveTags':
      return 'tags_removed';
    case 'Archive':
      return 'archived';
    case 'Restore':
      return 'restored';
    case 'TransferOwnership':
      return 'ownership_transferred';
  }
}
