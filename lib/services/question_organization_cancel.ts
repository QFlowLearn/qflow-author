import { safeErrorSummary } from '../error_summary.ts';
import { and, eq, inArray } from 'drizzle-orm';
import type { QflowDatabase } from '../db.ts';
import { organizationItems, organizationRuns } from '../db/question_organization_schema.ts';
import type { RequestContext } from '../tenants.ts';
import type { EnrichmentResult } from './bank_enrichment_contract.ts';
import { authorizeEnrichment } from './bank_enrichment_access.ts';
import type { OrganizationFailure } from './question_organization_contract.ts';
import { isCanonicalUuid } from '../uuid.ts';

/** Cancellation stops future writes; already applied changes remain individually undoable. */
export async function cancelOrganizationRun(
  database: QflowDatabase,
  ctx: RequestContext,
  runId: string,
): Promise<EnrichmentResult<string, OrganizationFailure>> {
  if (!isCanonicalUuid(runId)) return { ok: false, code: 'invalid_input' };
  try {
    return await database.transaction(
      async (tx): Promise<EnrichmentResult<string, OrganizationFailure>> => {
        if (!await authorizeEnrichment(tx, ctx, 'manage_content')) {
          return { ok: false, code: 'forbidden' };
        }
        const [run] = await tx.select().from(organizationRuns).where(
          and(eq(organizationRuns.id, runId), eq(organizationRuns.tenantId, ctx.tenantId)),
        ).for('update');
        if (!run) return { ok: false, code: 'not_found' };
        if (run.state !== 'queued' && run.state !== 'cancelled') {
          return { ok: false, code: 'conflict' };
        }
        await tx.update(organizationRuns).set({ state: 'cancelled' }).where(
          eq(organizationRuns.id, runId),
        );
        await tx.update(organizationItems).set({
          state: 'cancelled',
          leaseToken: null,
          leaseExpiresAt: null,
        }).where(
          and(
            eq(organizationItems.runId, runId),
            inArray(organizationItems.state, ['pending', 'processing', 'received']),
          ),
        );
        return { ok: true, value: runId };
      },
    );
  } catch (cause) {
    console.error('Question organization persistence failed', safeErrorSummary(cause));
    return { ok: false, code: 'storage_failed' };
  }
}
