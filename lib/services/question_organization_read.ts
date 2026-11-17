import { and, eq } from 'drizzle-orm';
import type { DbReadConnection } from '../db.ts';
import { organizationRuns, organizationSetups } from '../db/question_organization_schema.ts';
import { enrichmentSchemeVersions } from '../db/bank_enrichment_schema.ts';
import { organizationMemberships } from '../db/principal_schema.ts';
import type { RequestContext } from '../tenants.ts';
import { parseRole } from '../roles.ts';
import { parseEnrichmentDefinition } from './bank_enrichment_contract.ts';
import { parseOrganizationSetup } from './question_organization_contract.ts';

/** Rebuild step-owned domain input from the immutable policy and actual actor membership. */
export async function loadOrganizationRun(
  database: DbReadConnection,
  runId: string,
  executionId: string,
  actor: { readonly kind: 'execution_actor' } | {
    readonly kind: 'request';
    readonly ctx: RequestContext;
  },
) {
  const [row] = await database.select({
    run: organizationRuns,
    setup: organizationSetups,
    version: enrichmentSchemeVersions,
    role: organizationMemberships.role,
    userId: organizationMemberships.userId,
  }).from(organizationRuns)
    .innerJoin(
      organizationSetups,
      and(
        eq(organizationSetups.id, organizationRuns.setupId),
        eq(organizationSetups.tenantId, organizationRuns.tenantId),
      ),
    )
    .innerJoin(
      enrichmentSchemeVersions,
      and(
        eq(enrichmentSchemeVersions.id, organizationSetups.versionId),
        eq(enrichmentSchemeVersions.tenantId, organizationRuns.tenantId),
      ),
    )
    .innerJoin(
      organizationMemberships,
      and(
        eq(organizationMemberships.tenantId, organizationRuns.tenantId),
        eq(
          organizationMemberships.userId,
          actor.kind === 'request' ? actor.ctx.userId : organizationRuns.executionBy,
        ),
      ),
    )
    .where(
      and(
        eq(organizationRuns.id, runId),
        eq(organizationRuns.executionId, executionId),
        actor.kind === 'request' ? eq(organizationRuns.tenantId, actor.ctx.tenantId) : undefined,
      ),
    );
  if (!row) return null;
  const definition = parseEnrichmentDefinition(row.version.definition);
  const policy = definition && parseOrganizationSetup(row.setup.policy, definition);
  const role = parseRole(row.role);
  if (!definition || !policy || !role) throw new Error('Invalid organization run configuration.');
  return {
    run: row.run,
    setup: row.setup,
    schemeId: row.version.schemeId,
    definition,
    policy,
    ctx: { tenantId: row.run.tenantId, userId: row.userId, role },
  };
}
export type OrganizationRun = NonNullable<Awaited<ReturnType<typeof loadOrganizationRun>>>;
