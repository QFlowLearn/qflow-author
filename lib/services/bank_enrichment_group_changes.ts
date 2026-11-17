import type { QflowDatabase } from '../db.ts';
import type { RequestContext } from '../tenants.ts';
import { isCanonicalUuid } from '../uuid.ts';
import { uuidV5 } from '../uuid_v5.ts';
import type { EnrichmentResult } from './bank_enrichment_contract.ts';
import { BankEnrichmentScopes } from './bank_enrichment_scope.ts';
import { BankEnrichmentMutations } from './bank_enrichment_mutation_store.ts';
import { BankEnrichmentJobs } from './bank_enrichment_jobs.ts';
import type { EnrichmentSetupFailure } from './bank_enrichment_setup.ts';

/** Freeze and dispatch instructor changes under stable operation IDs. */
export class BankEnrichmentGroupChanges {
  constructor(private readonly database: QflowDatabase, private readonly now: () => Date) {}

  /** The server confirms the displayed affected count before changing any classifications. */
  async correct(
    ctx: RequestContext,
    operationId: string,
    scope: unknown,
    versionId: string,
    values: unknown,
    expectedCount: number,
  ): Promise<EnrichmentResult<string, EnrichmentSetupFailure | 'scope_changed'>> {
    if (
      !isCanonicalUuid(operationId) || !isCanonicalUuid(versionId) ||
      !Number.isSafeInteger(expectedCount) || expectedCount < 1
    ) return { ok: false, code: 'invalid_input' };
    const snapshotId = await uuidV5(operationId, 'scope');
    const captured = await new BankEnrichmentScopes(this.database, this.now).capture(
      ctx,
      snapshotId,
      scope,
    );
    if (!captured.ok) return captured;
    if (captured.value.itemCount !== expectedCount) return { ok: false, code: 'scope_changed' };
    const prepared = await new BankEnrichmentMutations(this.database, this.now).correct(
      ctx,
      operationId,
      { snapshotId, versionId, values },
    );
    if (!prepared.ok) return prepared;
    return await new BankEnrichmentJobs(this.database, this.now).queueMutation(
      ctx,
      operationId,
      await uuidV5(operationId, 'execution'),
    );
  }

  /** Undo targets only the source's existing writes and runs in the same bounded workflow. */
  async undo(
    ctx: RequestContext,
    operationId: string,
    sourceRunId: string,
  ): Promise<EnrichmentResult<string, EnrichmentSetupFailure>> {
    const prepared = await new BankEnrichmentMutations(this.database, this.now).undo(
      ctx,
      operationId,
      sourceRunId,
    );
    if (!prepared.ok) return prepared;
    return await new BankEnrichmentJobs(this.database, this.now).queueMutation(
      ctx,
      operationId,
      await uuidV5(operationId, 'execution'),
    );
  }
}
