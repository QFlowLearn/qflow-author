import { db } from '../db.ts';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { bankReleaseEvents, bankReleases } from '../db/bank_release_schema.ts';
import { questions } from '../db/question_schema.ts';
import { parseReleaseManifest, positive, type ReleaseResult, uuid } from '../banks/bank_release.ts';
import type { RequestContext } from '../tenants.ts';
import { canPublishEditions, hasWorkspaceCapability } from './workspace_authorization.ts';
import type { ReleaseDependencies } from './bank_releases.ts';
import { loadReleaseArtifactPreview } from './release_artifact_preview.ts';

/** Inspection is version-bound and independent of the full confirmation set. */
export type ReleasePreviewQuery = {
  readonly comparisonBefore?: string | null;
  readonly version: number | null;
  readonly page: number;
  readonly filter: 'all' | 'exceptions' | 'stale' | 'attest' | 'reviewed' | 'shipped';
};
/** Strict query parser keeps stale pagination from silently reading a different selection. */
export function parseReleasePreviewQuery(params: URLSearchParams): ReleasePreviewQuery | null {
  if (
    [...params.keys()].some((key) =>
      !['version', 'page', 'filter', 'comparisonBefore'].includes(key) ||
      params.getAll(key).length !== 1
    )
  ) return null;
  const comparisonBefore = params.get('comparisonBefore');
  if (comparisonBefore !== null && !uuid(comparisonBefore)) return null;
  const filter = params.get('filter') ?? 'all';
  const rawVersion = params.get('version'), rawPage = params.get('page');
  if (
    (rawVersion !== null && !/^[1-9]\d*$/.test(rawVersion)) ||
    (rawPage !== null && !/^[1-9]\d*$/.test(rawPage))
  ) return null;
  const version = rawVersion === null ? null : Number(rawVersion),
    page = rawPage === null ? 1 : Number(rawPage);
  if (
    (version !== null && !positive(version)) || !positive(page) ||
    (filter !== 'all' && filter !== 'exceptions' && filter !== 'stale' && filter !== 'attest' &&
      filter !== 'reviewed' &&
      filter !== 'shipped') ||
    (version === null && (page !== 1 || filter !== 'all' || comparisonBefore !== null))
  ) return null;
  return { version, page, filter, ...(comparisonBefore ? { comparisonBefore } : {}) };
}
/** Load manifest, current revision indicators, and permission in one consistent read snapshot. */
export async function loadReleasePreview(
  ctx: RequestContext,
  id: string,
  query: ReleasePreviewQuery,
  deps: ReleaseDependencies = { database: db, now: () => new Date() },
) {
  if (!uuid(id)) return { ok: false as const, code: 'invalid_input' as const };
  return await deps.database.transaction(async (tx) => {
    if (!await hasWorkspaceCapability(ctx, 'view_content', tx)) {
      return { ok: false as const, code: 'forbidden' as const };
    }
    const [release] = await tx.select().from(bankReleases).where(
      and(eq(bankReleases.id, id), eq(bankReleases.tenantId, ctx.tenantId)),
    );
    if (!release) return { ok: false as const, code: 'not_found' as const };
    if (query.version !== null && query.version !== release.version) {
      return { ok: false as const, code: 'stale_preview' as const };
    }
    const manifest = parseReleaseManifest(release.manifest);
    const latest = await tx.select({ id: questions.id, revisionId: questions.latestRevisionId })
      .from(questions).where(
        and(
          eq(questions.tenantId, ctx.tenantId),
          inArray(questions.id, manifest.items.map((row) => row.questionId)),
        ),
      );
    const rows = manifest.items.map((item, index) => {
      const newer =
        latest.find((row) => row.id === item.questionId)?.revisionId !== item.revisionId;
      const correction = item.eligibility.kind === 'attestation_required' &&
        item.eligibility.review?.state === 'changes_requested';
      return {
        ...item,
        position: index + 1,
        newer,
        correction,
        exception: correction,
        stale: newer && item.selection === 'current' && release.state === 'draft',
      };
    });
    const counts = {
      total: rows.length,
      exceptions: rows.filter((row) => row.correction).length,
      stale: rows.filter((row) => row.stale).length,
      attest: rows.filter((row) => row.eligibility.kind === 'attestation_required').length,
      reviewed: rows.filter((row) => row.eligibility.kind === 'reviewed').length,
      shipped: rows.filter((row) => row.previouslyShipped).length,
      excluded: manifest.exclusions.length,
    };
    const filtered = rows.filter((row) =>
      query.filter === 'all' ||
      (query.filter === 'exceptions'
        ? row.exception
        : query.filter === 'stale'
        ? row.stale
        : query.filter === 'attest'
        ? row.eligibility.kind === 'attestation_required'
        : query.filter === 'reviewed'
        ? row.eligibility.kind === 'reviewed'
        : row.previouslyShipped)
    ).sort((a, b) => Number(b.exception) - Number(a.exception) || a.position - b.position);
    const pageCount = Math.max(1, Math.ceil(filtered.length / 50));
    if (query.page > pageCount) return { ok: false as const, code: 'invalid_input' as const };
    const events = await tx.select().from(bankReleaseEvents).where(
      and(eq(bankReleaseEvents.tenantId, ctx.tenantId), eq(bankReleaseEvents.releaseId, id)),
    ).orderBy(desc(bankReleaseEvents.createdAt), desc(bankReleaseEvents.operationId)).limit(50);
    const [signoff] = await tx.select().from(bankReleaseEvents).where(
      and(
        eq(bankReleaseEvents.tenantId, ctx.tenantId),
        eq(bankReleaseEvents.releaseId, id),
        sql`${bankReleaseEvents.command}->>'action' = 'freeze'`,
      ),
    ).limit(1);
    if (query.comparisonBefore) {
      const [anchor] = await tx.select({ id: bankReleases.id }).from(bankReleases).where(
        and(
          eq(bankReleases.id, query.comparisonBefore),
          eq(bankReleases.tenantId, ctx.tenantId),
          eq(bankReleases.state, 'frozen'),
        ),
      );
      if (!anchor) return { ok: false as const, code: 'not_found' as const };
    }
    const comparisons = await tx.select({ id: bankReleases.id, label: bankReleases.label }).from(
      bankReleases,
    ).where(
      and(
        eq(bankReleases.tenantId, ctx.tenantId),
        eq(bankReleases.state, 'frozen'),
        query.comparisonBefore
          ? sql`(${bankReleases.createdAt}, ${bankReleases.id}) < (SELECT created_at, id FROM bank_releases WHERE id = ${query.comparisonBefore} AND tenant_id = ${ctx.tenantId})`
          : undefined,
      ),
    ).orderBy(
      desc(bankReleases.createdAt),
      desc(bankReleases.id),
    ).limit(101);

    const replacementChoices = comparisons.slice(0, 100);
    if (
      release.replacementId && !replacementChoices.some((row) => row.id === release.replacementId)
    ) {
      const [replacement] = await tx.select({ id: bankReleases.id, label: bankReleases.label })
        .from(bankReleases).where(
          and(
            eq(bankReleases.id, release.replacementId),
            eq(bankReleases.tenantId, ctx.tenantId),
            eq(bankReleases.state, 'frozen'),
          ),
        );
      if (!replacement) throw new Error('Edition replacement is missing or not frozen.');
      replacementChoices.push(replacement);
    }
    return {
      ok: true as const,
      value: {
        release: { ...release, manifest },
        artifacts: await loadReleaseArtifactPreview(tx, ctx.tenantId, id),
        actorId: ctx.userId,
        canPublish: await canPublishEditions(tx, ctx),
        query: { ...query, version: release.version },
        counts,
        rows: filtered.slice((query.page - 1) * 50, query.page * 50),
        pageCount,
        events,
        comparisons: comparisons.slice(0, 100),
        replacementChoices,
        comparisonNext: comparisons.length > 100 ? comparisons[99].id : null,
        signoff: signoff ?? null,
        correctionQuestionIds: rows.filter((row) => row.correction).map((row) => row.questionId),
      },
    };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
/** Presentation data from the authoritative snapshot loader. */
export type ReleasePreview = Extract<
  Awaited<ReturnType<typeof loadReleasePreview>>,
  { ok: true }
>['value'];
/** Return typed status codes for all edition failures. */
export function releaseFailureStatus(
  code: Exclude<ReleaseResult<unknown>, { ok: true }>['code'],
): number {
  if (code === 'forbidden') return 403;
  if (code === 'not_found') return 404;
  if (code === 'storage_failed') return 503;
  if (code === 'invalid_input' || code === 'invalid_selection') return 400;
  return 409;
}
