import { and, desc, eq } from 'drizzle-orm';
import { canonicalJsonStringify } from '../canonical_json.ts';
import type { QflowDatabase, QflowDatabaseTransaction } from '../db.ts';
import { enrichmentSchemes, enrichmentSchemeVersions } from '../db/bank_enrichment_schema.ts';
import { enrichmentExampleSourcesExist } from './bank_enrichment_sources.ts';
import { safeErrorSummary } from '../error_summary.ts';
import type { RequestContext } from '../tenants.ts';
import { isCanonicalUuid } from '../uuid.ts';
import { authorizeEnrichment, canReadEnrichment } from './bank_enrichment_access.ts';
import {
  type EnrichmentDefinition,
  type EnrichmentResult,
  type EnrichmentSchemeVersion,
  parseEnrichmentDefinition,
  validEnrichmentReplacementMap,
} from './bank_enrichment_contract.ts';

type SaveVersion = {
  readonly id: string;
  readonly schemeId: string;
  readonly expectedVersion: number;
  readonly definition: EnrichmentDefinition;
};
type SaveFailure =
  | 'invalid_input'
  | 'forbidden'
  | 'version_conflict'
  | 'operation_conflict'
  | 'storage_failed';

/** Persistence adapter for reusable schemes, atomic version creation and request replay. */
export class BankEnrichmentStore {
  constructor(
    private readonly database: QflowDatabase | QflowDatabaseTransaction,
    private readonly now: () => Date,
  ) {}

  /** Save one immutable version; repeated IDs replay only an identical actor and input. */
  async saveVersion(
    ctx: RequestContext,
    input: unknown,
  ): Promise<EnrichmentResult<EnrichmentSchemeVersion, SaveFailure>> {
    const command = parseSaveVersion(input);
    if (!command) return { ok: false, code: 'invalid_input' };
    try {
      return await this.database.transaction(
        async (tx): Promise<EnrichmentResult<EnrichmentSchemeVersion, SaveFailure>> => {
          if (!await authorizeEnrichment(tx, ctx, 'manage_content')) {
            return { ok: false, code: 'forbidden' };
          }
          const existing = await tx.select().from(enrichmentSchemeVersions).where(
            eq(enrichmentSchemeVersions.id, command.id),
          );
          if (existing[0]) {
            const row = existing[0];
            if (
              row.tenantId !== ctx.tenantId || row.createdBy !== ctx.userId ||
              row.schemeId !== command.schemeId || row.version !== command.expectedVersion + 1
            ) {
              return { ok: false, code: 'operation_conflict' };
            }
            const value = parseVersion(row);
            return canonicalJsonStringify(value.definition) ===
                canonicalJsonStringify(command.definition)
              ? { ok: true, value }
              : { ok: false, code: 'operation_conflict' };
          }
          const schemes = await tx.select().from(enrichmentSchemes).where(
            eq(enrichmentSchemes.id, command.schemeId),
          );
          if (schemes[0] && schemes[0].tenantId !== ctx.tenantId) {
            return { ok: false, code: 'forbidden' };
          }
          const latest = await tx.select().from(
            enrichmentSchemeVersions,
          )
            .where(
              and(
                eq(enrichmentSchemeVersions.schemeId, command.schemeId),
                eq(enrichmentSchemeVersions.tenantId, ctx.tenantId),
              ),
            )
            .orderBy(desc(enrichmentSchemeVersions.version)).limit(1);
          if ((latest[0]?.version ?? 0) !== command.expectedVersion) {
            return { ok: false, code: 'version_conflict' };
          }
          const previous = latest[0] ? parseVersion(latest[0]).definition : null;
          if (!validEnrichmentReplacementMap(previous, command.definition)) {
            return { ok: false, code: 'invalid_input' };
          }
          if (!await enrichmentExampleSourcesExist(tx, ctx.tenantId, command.definition.examples)) {
            return { ok: false, code: 'invalid_input' };
          }
          const now = this.now();
          if (!schemes.length) {
            await tx.insert(enrichmentSchemes).values({
              id: command.schemeId,
              tenantId: ctx.tenantId,
              createdBy: ctx.userId,
              createdAt: now,
            });
          }
          const value: EnrichmentSchemeVersion = {
            id: command.id,
            schemeId: command.schemeId,
            version: command.expectedVersion + 1,
            definition: command.definition,
          };
          await tx.insert(enrichmentSchemeVersions).values({
            ...value,
            tenantId: ctx.tenantId,
            createdBy: ctx.userId,
            createdAt: now,
          });
          return { ok: true, value };
        },
      );
    } catch (cause: unknown) {
      console.error('Enrichment scheme persistence failed', safeErrorSummary(cause));
      return { ok: false, code: 'storage_failed' };
    }
  }

  /** Load the exact producing version; labels are never reconstructed from newer definitions. */
  async getVersion(
    ctx: RequestContext,
    id: string,
  ): Promise<
    EnrichmentResult<
      EnrichmentSchemeVersion,
      'invalid_input' | 'forbidden' | 'not_found' | 'storage_failed'
    >
  > {
    if (!isCanonicalUuid(id)) return { ok: false, code: 'invalid_input' };
    try {
      return await this.database.transaction(async (tx) => {
        if (!await canReadEnrichment(tx, ctx, 'view_content')) {
          return { ok: false, code: 'forbidden' } as const;
        }
        const rows = await tx.select().from(enrichmentSchemeVersions)
          .where(
            and(
              eq(enrichmentSchemeVersions.id, id),
              eq(enrichmentSchemeVersions.tenantId, ctx.tenantId),
            ),
          );
        return rows[0]
          ? { ok: true, value: parseVersion(rows[0]) } as const
          : { ok: false, code: 'not_found' } as const;
      }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
    } catch (cause: unknown) {
      console.error('Enrichment scheme read failed', safeErrorSummary(cause));
      return { ok: false, code: 'storage_failed' };
    }
  }
}

function parseVersion(row: typeof enrichmentSchemeVersions.$inferSelect): EnrichmentSchemeVersion {
  const definition = parseEnrichmentDefinition(row.definition);
  if (
    !definition || !isCanonicalUuid(row.id) || !isCanonicalUuid(row.schemeId) ||
    !Number.isInteger(row.version) || row.version < 1
  ) {
    throw new Error('Invalid persisted enrichment scheme version.');
  }
  return { id: row.id, schemeId: row.schemeId, version: row.version, definition };
}

function parseSaveVersion(value: unknown): SaveVersion | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  if (Object.keys(value).sort().join(',') !== 'definition,expectedVersion,id,schemeId') return null;
  if (!('id' in value) || typeof value.id !== 'string' || !isCanonicalUuid(value.id)) return null;
  if (
    !('schemeId' in value) || typeof value.schemeId !== 'string' || !isCanonicalUuid(value.schemeId)
  ) return null;
  if (
    !('expectedVersion' in value) || typeof value.expectedVersion !== 'number' ||
    !Number.isInteger(value.expectedVersion) || value.expectedVersion < 0 ||
    value.expectedVersion >= 2147483647
  ) return null;
  if (!('definition' in value)) return null;
  const definition = parseEnrichmentDefinition(value.definition);
  return definition
    ? { id: value.id, schemeId: value.schemeId, expectedVersion: value.expectedVersion, definition }
    : null;
}
