import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  organizationAttempts,
  organizationItems,
  organizationRuns,
} from '../db/question_organization_schema.ts';
import { authorizeEnrichment } from './bank_enrichment_access.ts';
import { applyOrganizationItems } from './question_organization_apply.ts';
import type { OrganizationRun } from './question_organization_read.ts';
import type {
  ClaimedItem,
  ItemOutcome,
  OrganizationWorkerServices,
} from './question_organization_work.ts';

/** Commit all receipts and their usage allocations atomically before applying any changes. */
export async function checkpointOrganizationBatch(
  context: OrganizationRun,
  results: readonly { readonly claim: ClaimedItem; readonly outcome: ItemOutcome }[],
  services: OrganizationWorkerServices,
): Promise<void> {
  const { database, now } = services;
  await database.transaction(async (tx) => {
    if (!await authorizeEnrichment(tx, context.ctx, 'manage_content')) return;
    const [run] = await tx.select().from(organizationRuns).where(
      eq(organizationRuns.id, context.run.id),
    ).for('update');
    if (run.state !== 'queued' || run.executionId !== context.run.executionId) return;
    const items = await tx.select().from(organizationItems).where(and(
      eq(organizationItems.runId, context.run.id),
      inArray(organizationItems.questionId, results.map((r) => r.claim.item.questionId)),
    )).orderBy(organizationItems.questionId).for('update');
    const itemWrites: {
      questionId: string;
      state: string;
      decision: unknown;
      detail: string | null;
      leaseToken: string | null;
      leaseExpiresAt: Date | null;
    }[] = [];
    const attemptWrites: {
      id: string;
      state: 'uncertain' | 'received' | 'skipped';
      chargedMicros: number | null;
      code: string | null;
    }[] = [];
    for (const { claim, outcome } of results) {
      const item = items.find((i) => i.questionId === claim.item.questionId);
      if (!item) throw new Error('Organization checkpoint item missing.');
      if (
        !['processing', 'received'].includes(item.state) ||
        item.leaseToken !== claim.leaseToken || !item.leaseExpiresAt ||
        item.leaseExpiresAt <= now()
      ) continue;
      if (outcome.kind === 'failure') {
        if (claim.reservation) {
          const notSubmitted = ['input_too_large', 'unsupported_example'].includes(outcome.code);
          attemptWrites.push({
            id: claim.leaseToken,
            state: notSubmitted ? 'skipped' : 'uncertain',
            chargedMicros: notSubmitted ? 0 : null,
            code: outcome.code,
          });
          if (notSubmitted) run.reservedMicros -= claim.reservation;
        }
        itemWrites.push({
          questionId: item.questionId,
          state: item.attempts < 3 && ['provider_failed', 'aborted'].includes(outcome.code)
            ? 'pending'
            : 'failed',
          decision: item.decision,
          detail: outcome.code,
          leaseToken: null,
          leaseExpiresAt: null,
        });
        continue;
      }
      if (item.state === 'received') continue;
      if (outcome.kind !== 'decision') {
        throw new Error('Organization completed without a decision.');
      }
      itemWrites.push({
        questionId: item.questionId,
        state: 'received',
        decision: outcome.value,
        detail: null,
        leaseToken: item.leaseToken,
        leaseExpiresAt: item.leaseExpiresAt,
      });
      // Settle known usage once. Uncertain requests retain their conservative reservation.
      if (claim.reservation) {
        attemptWrites.push({
          id: claim.leaseToken,
          state: outcome.value.kind === 'clef' ? 'received' : 'skipped',
          chargedMicros: outcome.chargedMicros,
          code: null,
        });
        run.reservedMicros += outcome.chargedMicros - claim.reservation;
      }
    }
    // All candidate rows remain locked. Parameterized records replace per-item round trips.
    if (itemWrites.length) {
      await tx.execute(sql`
        UPDATE ${organizationItems}
        SET state = patch.state, decision = patch.decision, detail = patch.detail,
            lease_token = patch."leaseToken", lease_expires_at = patch."leaseExpiresAt"
        FROM jsonb_to_recordset(${JSON.stringify(itemWrites)}::jsonb) AS patch(
          "questionId" uuid, state text, decision jsonb, detail text,
          "leaseToken" uuid, "leaseExpiresAt" timestamptz
        )
        WHERE ${organizationItems.runId} = ${run.id}
          AND ${organizationItems.questionId} = patch."questionId"
      `);
    }
    if (attemptWrites.length) {
      await tx.execute(sql`
        UPDATE ${organizationAttempts}
        SET state = patch.state, charged_micros = patch."chargedMicros", code = patch.code
        FROM jsonb_to_recordset(${JSON.stringify(attemptWrites)}::jsonb) AS patch(
          id uuid, state text, "chargedMicros" integer, code text
        )
        WHERE ${organizationAttempts.runId} = ${run.id}
          AND ${organizationAttempts.id} = patch.id
      `);
    }
    await tx.update(organizationRuns).set({ reservedMicros: run.reservedMicros }).where(
      eq(organizationRuns.id, run.id),
    );
  });
  // The receipt commits before application. A crash here reuses it without another model call.
  await database.transaction(async (tx) => {
    if (await authorizeEnrichment(tx, context.ctx, 'manage_content')) {
      await applyOrganizationItems(
        tx,
        context,
        results.map(({ claim }) => ({
          questionId: claim.item.questionId,
          leaseToken: claim.leaseToken,
        })),
        now(),
      );
    }
  });
}
