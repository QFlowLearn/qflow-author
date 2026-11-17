import { ENRICHMENT_VOCABULARY_KEYS } from './bank_enrichment_query_sql.ts';
import { sql } from 'drizzle-orm';
import type { QflowDatabaseTransaction } from '../db.ts';
import { ENRICHMENT_DIMENSIONS } from './bank_enrichment_contract.ts';

import type { BankEnrichmentFilter } from './bank_enrichment_query.ts';

/** Semantic validation for both browsing and capturing filtered work, including zero-result filters. */
export async function validBankEnrichmentFilter(
  tx: QflowDatabaseTransaction,
  tenantId: string,
  filter: BankEnrichmentFilter | undefined,
): Promise<boolean> {
  if (!filter) return true;
  const schemes = await tx.execute(
    sql`SELECT 1 FROM bank_enrichment_schemes WHERE tenant_id = ${tenantId} AND id = ${filter.schemeId}`,
  );
  if (schemes.length !== 1) return false;
  for (const dimension of ENRICHMENT_DIMENSIONS) {
    const value = filter[dimension];
    if (value?.kind !== 'value') continue;
    const rows = await tx.execute(sql`
      SELECT 1 FROM bank_enrichment_scheme_versions ev
      CROSS JOIN LATERAL jsonb_array_elements(ev.definition -> ${
      ENRICHMENT_VOCABULARY_KEYS[dimension]
    }) category
      WHERE ev.tenant_id = ${tenantId} AND ev.scheme_id = ${filter.schemeId} AND ev.id = ${value.versionId}
        AND category ->> 'id' = ${value.valueId}
    `);
    if (rows.length !== 1) return false;
  }
  return true;
}
