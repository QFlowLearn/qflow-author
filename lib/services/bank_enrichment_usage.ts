import { and, eq, sql } from 'drizzle-orm';
import {
  type EnrichmentAIConfig,
  enrichmentCostMicros,
  isEnrichmentRecord,
  parseEnrichmentAIConfig,
} from '../ai/bank_enrichment_config.ts';
import {
  ENRICHMENT_MAX_OUTPUT_TOKENS,
  type EnrichmentAIProvider,
  type EnrichmentAIReceipt,
  type EnrichmentAIRequest,
  enrichmentRequestInputBound,
  parseEnrichmentAIReceipt,
} from '../ai/bank_enrichment_provider.ts';
import { canonicalJsonStringify } from '../canonical_json.ts';
import type { QflowDatabase, QflowDatabaseTransaction } from '../db.ts';
import { enrichmentBudgets, enrichmentUsageAttempts } from '../db/bank_enrichment_usage_schema.ts';
import { enrichmentSnapshots } from '../db/bank_enrichment_schema.ts';
import { safeErrorSummary } from '../error_summary.ts';
import type { RequestContext } from '../tenants.ts';
import { isCanonicalUuid } from '../uuid.ts';
import { authorizeEnrichment, canReadEnrichment } from './bank_enrichment_access.ts';
import type { EnrichmentResult } from './bank_enrichment_contract.ts';

type UsageFailure =
  | 'invalid_input'
  | 'forbidden'
  | 'not_found'
  | 'operation_conflict'
  | 'request_changed'
  | 'storage_failed'
  | 'budget_exceeded'
  | 'in_flight'
  | 'aborted'
  | 'input_too_large';
/** The estimate reports settled and uncertain charges separately. */
export type EnrichmentUsageSummary = {
  readonly limitMicros: number;
  readonly chargedMicros: number;
  readonly reservedMicros: number;
  readonly attempts: number;
  readonly unsettled: number;
  readonly uncertain: number;
};

/** Atomic attempt budgeting; an ambiguous external call retains its full reserved charge. */
export class BankEnrichmentUsage {
  constructor(
    private readonly database: QflowDatabase,
    private readonly now: () => Date,
    private readonly options: {
      readonly authorizeDispatch?: (tx: QflowDatabaseTransaction) => Promise<boolean>;
    } = {},
  ) {}

  /** Fix the operation's budget and model before any request; replay requires identical input. */
  async open(
    ctx: RequestContext,
    id: string,
    snapshotId: string,
    purpose: 'preview' | 'run',
    input: unknown,
  ): Promise<EnrichmentResult<string, UsageFailure>> {
    const config = parseEnrichmentAIConfig(input);
    if (
      !config || !isCanonicalUuid(id) || !isCanonicalUuid(snapshotId) ||
      (purpose !== 'preview' && purpose !== 'run')
    ) return { ok: false, code: 'invalid_input' };
    try {
      return await this.database.transaction(async (tx) => {
        if (!await authorizeEnrichment(tx, ctx, 'manage_content')) {
          return { ok: false, code: 'forbidden' } as const;
        }
        const [existing] = await tx.select().from(enrichmentBudgets).where(
          eq(enrichmentBudgets.id, id),
        );
        if (existing) {
          return existing.tenantId === ctx.tenantId && existing.createdBy === ctx.userId &&
              existing.snapshotId === snapshotId && existing.purpose === purpose &&
              canonicalJsonStringify(existing.configuration) === canonicalJsonStringify(config)
            ? { ok: true, value: id } as const
            : { ok: false, code: 'operation_conflict' } as const;
        }
        const [snapshot] = await tx.select({ id: enrichmentSnapshots.id }).from(enrichmentSnapshots)
          .where(
            and(
              eq(enrichmentSnapshots.id, snapshotId),
              eq(enrichmentSnapshots.tenantId, ctx.tenantId),
            ),
          );
        if (!snapshot) return { ok: false, code: 'not_found' } as const;
        await tx.insert(enrichmentBudgets).values({
          id,
          tenantId: ctx.tenantId,
          snapshotId,
          purpose,
          configuration: config,
          limitMicros: purpose === 'preview' ? config.previewBudgetMicros : config.runBudgetMicros,
          createdBy: ctx.userId,
          createdAt: this.now(),
        });
        return { ok: true, value: id } as const;
      });
    } catch (cause: unknown) {
      return storageFailure(cause);
    }
  }

  /** Reserve once, call outside the transaction, then retain the receipt before returning it. */
  async execute(
    ctx: RequestContext,
    budgetId: string,
    attemptId: string,
    request: EnrichmentAIRequest,
    provider: (config: EnrichmentAIConfig) => EnrichmentAIProvider,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<EnrichmentResult<EnrichmentAIReceipt, UsageFailure>> {
    const { signal } = options;
    if (!isCanonicalUuid(budgetId) || !isCanonicalUuid(attemptId)) {
      return { ok: false, code: 'invalid_input' };
    }
    if (signal?.aborted) return { ok: false, code: 'aborted' };
    const inputBound = enrichmentRequestInputBound(request);
    if (inputBound === null) return { ok: false, code: 'input_too_large' };
    const hash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(canonicalJsonStringify(request)),
    );
    const fingerprint = Array.from(
      new Uint8Array(hash),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('');
    const reservation = await this.reserve(ctx, budgetId, attemptId, fingerprint, inputBound);
    if (!reservation.ok) return reservation;
    if (reservation.value.kind === 'replay') return { ok: true, value: reservation.value.receipt };
    // Cancellation after reservation is charged conservatively; never dispatch after it is observed.
    const receipt: EnrichmentAIReceipt = signal?.aborted
      ? { ok: false, code: 'aborted', usage: null }
      : await provider(reservation.value.config)(request, { signal });
    return await this.settle(
      ctx,
      budgetId,
      attemptId,
      receipt,
      reservation.value.config,
      reservation.value.reservedMicros,
    );
  }

  /** Show actual charges and conservative outstanding reserves for this operation only. */
  async summary(
    ctx: RequestContext,
    budgetId: string,
  ): Promise<EnrichmentResult<EnrichmentUsageSummary, UsageFailure>> {
    if (!isCanonicalUuid(budgetId)) return { ok: false, code: 'invalid_input' };
    try {
      return await this.database.transaction(async (tx) => {
        if (!await canReadEnrichment(tx, ctx, 'view_content')) {
          return { ok: false, code: 'forbidden' } as const;
        }
        const [budget] = await tx.select().from(enrichmentBudgets).where(
          and(eq(enrichmentBudgets.id, budgetId), eq(enrichmentBudgets.tenantId, ctx.tenantId)),
        );
        return budget
          ? {
            ok: true,
            value: { limitMicros: budget.limitMicros, ...await totals(tx, budgetId) },
          } as const
          : { ok: false, code: 'not_found' } as const;
      }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
    } catch (cause: unknown) {
      return storageFailure(cause);
    }
  }

  private async reserve(
    ctx: RequestContext,
    budgetId: string,
    id: string,
    fingerprint: string,
    inputBound: number,
  ): Promise<
    EnrichmentResult<
      | {
        readonly kind: 'dispatch';
        readonly config: EnrichmentAIConfig;
        readonly reservedMicros: number;
      }
      | { readonly kind: 'replay'; readonly receipt: EnrichmentAIReceipt },
      UsageFailure
    >
  > {
    try {
      return await this.database.transaction(async (tx) => {
        if (!await authorizeEnrichment(tx, ctx, 'manage_content')) {
          return { ok: false, code: 'forbidden' } as const;
        }
        if (this.options.authorizeDispatch && !await this.options.authorizeDispatch(tx)) {
          return { ok: false, code: 'aborted' } as const;
        }
        const [budget] = await tx.select().from(enrichmentBudgets).where(
          and(eq(enrichmentBudgets.id, budgetId), eq(enrichmentBudgets.tenantId, ctx.tenantId)),
        ).for('update');
        if (!budget) return { ok: false, code: 'not_found' } as const;
        const config = parseEnrichmentAIConfig(budget.configuration);
        if (!config) throw new Error('Invalid stored enrichment configuration.');
        const [existing] = await tx.select().from(enrichmentUsageAttempts).where(
          eq(enrichmentUsageAttempts.id, id),
        );
        if (existing) {
          if (
            existing.tenantId !== ctx.tenantId || existing.budgetId !== budgetId
          ) return { ok: false, code: 'operation_conflict' } as const;
          // A resumed job may have a revised prompt/schema. Keep this receipt and require a new attempt.
          if (existing.fingerprint !== fingerprint) {
            return { ok: false, code: 'request_changed' } as const;
          }
          if (existing.state === 'dispatched') return { ok: false, code: 'in_flight' } as const;
          const receipt = storedReceipt(existing.receipt);
          if (!receipt) throw new Error('Invalid stored enrichment receipt.');
          return { ok: true, value: { kind: 'replay', receipt } } as const;
        }
        const reservedMicros = enrichmentCostMicros(
          config,
          inputBound,
          ENRICHMENT_MAX_OUTPUT_TOKENS,
        );
        const spent = await totals(tx, budgetId);
        if (spent.chargedMicros + spent.reservedMicros + reservedMicros > budget.limitMicros) {
          return { ok: false, code: 'budget_exceeded' } as const;
        }
        await tx.insert(enrichmentUsageAttempts).values({
          id,
          tenantId: ctx.tenantId,
          budgetId,
          fingerprint,
          reservedMicros,
          state: 'dispatched',
          createdAt: this.now(),
        });
        return { ok: true, value: { kind: 'dispatch', config, reservedMicros } } as const;
      });
    } catch (cause: unknown) {
      return storageFailure(cause);
    }
  }

  private async settle(
    ctx: RequestContext,
    budgetId: string,
    id: string,
    receipt: EnrichmentAIReceipt,
    config: EnrichmentAIConfig,
    reserved: number,
  ): Promise<EnrichmentResult<EnrichmentAIReceipt, UsageFailure>> {
    try {
      // Settlement must still record a charge if membership was revoked while the provider ran.
      const chargedMicros = receipt.usage
        ? enrichmentCostMicros(config, receipt.usage.inputTokens, receipt.usage.outputTokens)
        : reserved;
      const rows = await this.database.update(enrichmentUsageAttempts).set({
        state: 'settled',
        receipt,
        chargedMicros,
        settledAt: this.now(),
      })
        .where(
          and(
            eq(enrichmentUsageAttempts.id, id),
            eq(enrichmentUsageAttempts.tenantId, ctx.tenantId),
            eq(enrichmentUsageAttempts.budgetId, budgetId),
            eq(enrichmentUsageAttempts.state, 'dispatched'),
          ),
        ).returning({ id: enrichmentUsageAttempts.id });
      return rows.length ? { ok: true, value: receipt } : { ok: false, code: 'operation_conflict' };
    } catch (cause: unknown) {
      return storageFailure(cause);
    }
  }
}

async function totals(
  tx: QflowDatabaseTransaction,
  budgetId: string,
): Promise<Omit<EnrichmentUsageSummary, 'limitMicros'>> {
  const [row] = await tx.select({
    charged: sql<
      string
    >`COALESCE(sum(CASE WHEN ${enrichmentUsageAttempts.receipt}->'usage' <> 'null'::jsonb THEN ${enrichmentUsageAttempts.chargedMicros} ELSE 0 END), 0)::text`,
    reserved: sql<
      string
    >`COALESCE(sum(CASE WHEN ${enrichmentUsageAttempts.receipt} IS NULL OR ${enrichmentUsageAttempts.receipt}->'usage' = 'null'::jsonb THEN COALESCE(${enrichmentUsageAttempts.chargedMicros}, ${enrichmentUsageAttempts.reservedMicros}) ELSE 0 END), 0)::text`,
    attempts: sql<string>`count(*)::text`,
    unsettled: sql<
      string
    >`count(*) FILTER (WHERE ${enrichmentUsageAttempts.state} = 'dispatched')::text`,
    uncertain: sql<
      string
    >`count(*) FILTER (WHERE ${enrichmentUsageAttempts.receipt} IS NULL OR ${enrichmentUsageAttempts.receipt}->'usage' = 'null'::jsonb)::text`,
  }).from(enrichmentUsageAttempts).where(eq(enrichmentUsageAttempts.budgetId, budgetId));
  const values = [row?.charged, row?.reserved, row?.attempts, row?.unsettled, row?.uncertain].map(
    Number,
  );
  if (values.some((v) => !Number.isSafeInteger(v) || v < 0)) {
    throw new Error('Invalid stored enrichment usage totals.');
  }
  return {
    chargedMicros: values[0],
    reservedMicros: values[1],
    attempts: values[2],
    unsettled: values[3],
    uncertain: values[4],
  };
}
function storedReceipt(value: unknown): EnrichmentAIReceipt | null {
  if (!isEnrichmentRecord(value)) return null;
  const usage = isEnrichmentRecord(value.usage) ? value.usage : null;
  const parsed = parseEnrichmentAIReceipt({
    id: usage?.requestId,
    model: usage?.model,
    usage: { prompt_tokens: usage?.inputTokens, completion_tokens: usage?.outputTokens },
    choices: [{ finish_reason: 'stop', message: { content: value.content } }],
  });
  if (value.ok === true && parsed.ok) return parsed;
  if (
    value.ok !== false ||
    !['aborted', 'provider_failed', 'invalid_response'].includes(String(value.code))
  ) return null;
  if (
    value.code !== 'aborted' && value.code !== 'provider_failed' &&
    value.code !== 'invalid_response'
  ) return null;
  if (value.usage !== null && !parsed.usage) return null;
  return { ok: false, code: value.code, usage: parsed.usage };
}
function storageFailure(cause: unknown): { readonly ok: false; readonly code: 'storage_failed' } {
  console.error('Enrichment usage persistence failed', safeErrorSummary(cause));
  return { ok: false, code: 'storage_failed' };
}
