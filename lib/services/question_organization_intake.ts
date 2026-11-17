import { and, eq, inArray } from 'drizzle-orm';
import type { QflowDatabaseTransaction } from '../db.ts';
import { organizationActivation, organizationOrigins } from '../db/question_organization_schema.ts';
import { questions } from '../db/question_schema.ts';
import type { RequestContext } from '../tenants.ts';
import { uuidV5 } from '../uuid_v5.ts';
import { queueOrganizationInTransaction } from './question_organization_store.ts';
import type { OrganizationSource } from './question_organization_contract.ts';

/** Record the owning collection once, then capture work in the publication transaction. */
export async function registerOrganizationIntake(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  collectionId: string,
  items: readonly {
    readonly questionId: string;
    readonly source: OrganizationSource | null;
  }[],
  now: Date,
): Promise<void> {
  if (!items.length) return;
  await tx.insert(organizationOrigins).values(
    items.map((item) => ({ ...item, tenantId: ctx.tenantId, collectionId })),
  ).onConflictDoNothing();
  await queueSavedQuestionOrganization(tx, ctx, items.map((item) => item.questionId), now);
}

/** No configured origin means no automatic job. Configured work is committed with the revision. */
export async function queueSavedQuestionOrganization(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  questionIds: readonly string[],
  now: Date,
): Promise<void> {
  if (!questionIds.length) return;
  const origins = await tx.select({
    origin: organizationOrigins,
    revisionId: questions.latestRevisionId,
  }).from(organizationOrigins).innerJoin(
    questions,
    and(
      eq(questions.id, organizationOrigins.questionId),
      eq(questions.tenantId, organizationOrigins.tenantId),
    ),
  ).where(
    and(
      eq(organizationOrigins.tenantId, ctx.tenantId),
      inArray(organizationOrigins.questionId, [...questionIds]),
    ),
  );
  for (const collectionId of new Set(origins.map((row) => row.origin.collectionId))) {
    const [activation] = await tx.select().from(organizationActivation).where(
      and(
        eq(organizationActivation.tenantId, ctx.tenantId),
        eq(organizationActivation.collectionId, collectionId),
      ),
    ).limit(1);
    if (!activation?.setupId) continue;
    const selected = origins.filter((row) => row.origin.collectionId === collectionId).sort((
      a,
      b,
    ) => a.origin.questionId.localeCompare(b.origin.questionId));
    const runId = await uuidV5(
      activation.setupId,
      `saved:${selected.map((row) => `${row.origin.questionId}:${row.revisionId}`).join(',')}`,
    );
    // The current authorized publisher owns this run; a departed setup author cannot block saves.
    const queued = await queueOrganizationInTransaction(tx, ctx, {
      id: runId,
      setupId: activation.setupId,
      mode: 'apply',
      questionIds: selected.map((row) => row.origin.questionId),
    }, now);
    if (!queued.ok) throw new OrganizationIntakeFailure(queued.code);
  }
}

/** Queue failure must roll back the enclosing commit rather than lose its pending work. */
export class OrganizationIntakeFailure extends Error {
  constructor(readonly code: string) {
    super('Automatic organization could not be queued.');
  }
}
