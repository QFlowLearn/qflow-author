import type { ReleaseHistoryQuery } from '../banks/bank_release_history.ts';
import type { ObjectReader } from '../storage_contract.ts';
import { sha256Hex } from '../sha256.ts';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, type QflowDatabase, type QflowDatabaseTransaction } from '../db.ts';
import {
  bankReleaseEvents,
  bankReleasePreparations,
  bankReleaseRevisions,
  bankReleases,
} from '../db/bank_release_schema.ts';
import { bankCollections } from '../db/bank_schema.ts';
import { users } from '../db/principal_schema.ts';
import { questions } from '../db/question_schema.ts';
import { canonicalJsonStringify } from '../canonical_json.ts';
import {
  parseCreateRelease,
  parseReleaseManifest,
  type ReleaseManifest,
  releaseManifestDigest,
  type ReleaseResult,
  uuid,
} from '../banks/bank_release.ts';
import { parseReleaseCommand, type ReleaseCommand } from '../banks/bank_release_command.ts';
import { validateManifestAttestation } from '../publication_evidence.ts';
import type { RequestContext } from '../tenants.ts';
import {
  canPublishEditions,
  hasWorkspaceCapability,
  lockWorkspaceAndRequireAuthority,
} from './workspace_authorization.ts';
import { selectReleaseQuestions, snapshotReleaseItems } from './bank_release_selection.ts';

/** Explicit persistence and clock dependencies shared by edition commands. */
export type ReleaseDependencies = { readonly database: QflowDatabase; readonly now: () => Date };
const defaultDependencies: ReleaseDependencies = { database: db, now: () => new Date() };
/** Parsed edition read model. */
export type ReleaseRecord = Omit<typeof bankReleases.$inferSelect, 'manifest'> & {
  readonly manifest: ReleaseManifest;
};
/** Create one pinned selection and its actor-bound retry receipt atomically. */
export async function createBankRelease(
  ctx: RequestContext,
  input: unknown,
  deps = defaultDependencies,
): Promise<ReleaseResult<string>> {
  const command = parseCreateRelease(input);
  if (!command) return { ok: false, code: 'invalid_input' };
  return await deps.database.transaction(async (tx) => {
    if (!await lockWorkspaceAndRequireAuthority(tx, ctx, { grant: 'publication' })) {
      return { ok: false, code: 'forbidden' };
    }
    const replay = await findReplay(tx, ctx, command.operationId, command.id, command);
    if (replay) return replay;
    const sameLabel = await tx.select().from(bankReleases).where(
      and(eq(bankReleases.tenantId, ctx.tenantId), eq(bankReleases.label, command.label)),
    );
    if (sameLabel.length) return { ok: false, code: 'label_exists' };
    const existing = await tx.select().from(bankReleases).where(eq(bankReleases.id, command.id));
    if (existing.length) return { ok: false, code: 'operation_conflict' };
    const selected = await selectReleaseQuestions(
      tx,
      ctx,
      command.collectionIds,
      command.questionIds,
    );
    if (!selected.ok) return selected;
    const snapshot = await snapshotReleaseItems(
      tx,
      ctx,
      selected.value.ids.map((questionId) => ({
        questionId,
        revisionId: null,
        selection: 'current',
      })),
    );
    if (!snapshot.ok) return snapshot;
    const manifest: ReleaseManifest = {
      schema: 'qflow.bank-release.v1',
      label: command.label,
      notes: command.notes,
      collections: selected.value.collections,
      items: snapshot.value,
      exclusions: [],
      preparation: null,
    };
    const now = deps.now();
    await tx.insert(bankReleases).values({
      id: command.id,
      tenantId: ctx.tenantId,
      label: manifest.label,
      version: 1,
      state: 'draft',
      distribution: 'available',
      manifest,
      digest: await releaseManifestDigest(manifest),
      createdBy: ctx.userId,
      createdAt: now,
    });
    await replacePins(tx, ctx.tenantId, command.id, manifest);
    await recordReleaseEvent(tx, ctx, command.id, command.operationId, command, now);
    return { ok: true, value: command.id };
  });
}
/** Read metadata is workspace-visible; publication/download commands require the separate grant. */
export async function getBankRelease(
  ctx: RequestContext,
  id: string,
  deps = defaultDependencies,
): Promise<ReleaseResult<ReleaseRecord>> {
  if (!uuid(id)) return { ok: false, code: 'invalid_input' };
  if (!await hasWorkspaceCapability(ctx, 'view_content', deps.database)) {
    return { ok: false, code: 'forbidden' };
  }
  const [row] = await deps.database.select().from(bankReleases).where(
    and(eq(bankReleases.id, id), eq(bankReleases.tenantId, ctx.tenantId)),
  );
  return row
    ? { ok: true, value: { ...row, manifest: parseReleaseManifest(row.manifest) } }
    : { ok: false, code: 'not_found' };
}
/** Bounded workspace edition history, newest first. */
export async function listBankReleases(
  ctx: RequestContext,
  query: ReleaseHistoryQuery,
  deps = defaultDependencies,
) {
  if (!await hasWorkspaceCapability(ctx, 'view_content', deps.database)) {
    return { ok: false as const, code: 'forbidden' as const };
  }
  if (query.before) {
    const anchor = await getBankRelease(ctx, query.before, deps);
    if (!anchor.ok) return anchor;
  }
  const rows = await deps.database.select({
    id: bankReleases.id,
    label: bankReleases.label,
    state: bankReleases.state,
    distribution: bankReleases.distribution,
    createdAt: bankReleases.createdAt,
  }).from(bankReleases).where(
    and(
      eq(bankReleases.tenantId, ctx.tenantId),
      query.before
        ? sql`(${bankReleases.createdAt}, ${bankReleases.id}) < (SELECT created_at, id FROM bank_releases WHERE id = ${query.before} AND tenant_id = ${ctx.tenantId})`
        : undefined,
    ),
  ).orderBy(
    desc(bankReleases.createdAt),
    desc(bankReleases.id),
  ).limit(101);
  return {
    ok: true as const,
    value: { rows: rows.slice(0, 100), next: rows.length > 100 ? rows[99].id : null },
  };
}
/** Apply an exact-version mutation under the publication/membership serialization boundary. */
export async function mutateBankRelease(
  ctx: RequestContext,
  input: unknown,
  { storage, database = db, now = () => new Date() }: {
    readonly storage: ObjectReader;
    readonly database?: QflowDatabase;
    readonly now?: () => Date;
  },
): Promise<ReleaseResult<string>> {
  const deps = { storage, database, now };
  const command = parseReleaseCommand(input);
  if (!command) return { ok: false, code: 'invalid_input' };
  if (!await canPublishEditions(deps.database, ctx)) return { ok: false, code: 'forbidden' };
  const technicalBlockers: string[] = [];
  if (command.action === 'freeze') {
    const release = await getBankRelease(ctx, command.releaseId, deps);
    if (!release.ok) return release;
    const preparation = release.value.manifest.preparation;
    if (!preparation) return { ok: false, code: 'preparation_required' };
    const [prep] = await deps.database.select().from(bankReleasePreparations).where(
      and(
        eq(bankReleasePreparations.id, preparation.id),
        eq(bankReleasePreparations.tenantId, ctx.tenantId),
      ),
    );
    if (!prep) return { ok: false, code: 'preparation_conflict' };
    try {
      const bytes = await deps.storage.readObject(prep.objectKey);
      if (
        await sha256Hex(bytes) !== preparation.sha256 || bytes.byteLength !== preparation.byteLength
      ) technicalBlockers.push('retained_source_digest_mismatch');
    } catch {
      technicalBlockers.push('retained_source_unavailable');
    }
  }
  return await deps.database.transaction(async (tx) => {
    if (!await lockWorkspaceAndRequireAuthority(tx, ctx, { grant: 'publication' })) {
      return { ok: false, code: 'forbidden' };
    }
    const replay = await findReplay(tx, ctx, command.operationId, command.releaseId, command);
    if (replay) return replay;
    const [row] = await tx.select().from(bankReleases).where(
      and(eq(bankReleases.id, command.releaseId), eq(bankReleases.tenantId, ctx.tenantId)),
    ).for('update');
    if (!row) return { ok: false, code: 'not_found' };
    if (row.version !== command.version || row.digest !== command.digest) {
      return { ok: false, code: 'stale_preview' };
    }
    const manifest = parseReleaseManifest(row.manifest);
    const now = deps.now();
    const result = command.action === 'withdraw' || command.action === 'restore'
      ? await changeDistribution(tx, ctx, row, command)
      : row.state === 'frozen'
      ? { ok: false as const, code: 'frozen' as const }
      : command.action === 'freeze'
      ? await freeze(tx, ctx, row, manifest, command, now, technicalBlockers)
      : await revise(tx, ctx, row, manifest, command);
    if (!result.ok) return result;
    await recordReleaseEvent(tx, ctx, row.id, command.operationId, command, now);
    return { ok: true, value: row.id };
  });
}

async function revise(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  row: typeof bankReleases.$inferSelect,
  manifest: ReleaseManifest,
  command: Exclude<ReleaseCommand, { action: 'freeze' | 'withdraw' | 'restore' }>,
): Promise<ReleaseResult<null>> {
  const changed = command.action === 'refresh'
    ? await refreshManifest(tx, ctx, row.id, manifest, command)
    : command.action === 'exclude'
    ? excludeFromManifest(manifest, command)
    : keepHistorical(manifest, command);
  if (!changed.ok) return changed;
  const next = { ...changed.value, preparation: null };
  await tx.update(bankReleases).set({
    label: next.label,
    manifest: next,
    digest: await releaseManifestDigest(next),
    version: row.version + 1,
  }).where(eq(bankReleases.id, row.id));
  await replacePins(tx, ctx.tenantId, row.id, next);
  return { ok: true, value: null };
}
async function refreshManifest(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  releaseId: string,
  manifest: ReleaseManifest,
  command: Extract<ReleaseCommand, { action: 'refresh' }>,
): Promise<ReleaseResult<ReleaseManifest>> {
  const labels = await tx.select().from(bankReleases).where(
    and(eq(bankReleases.tenantId, ctx.tenantId), eq(bankReleases.label, command.label)),
  );
  if (labels.some((other) => other.id !== releaseId)) return { ok: false, code: 'label_exists' };
  const snapshot = await snapshotReleaseItems(
    tx,
    ctx,
    manifest.items.map((item) => ({
      ...item,
      revisionId: item.selection === 'current' ? null : item.revisionId,
    })),
  );
  if (!snapshot.ok) return snapshot;
  const collections = manifest.collections.length
    ? await tx.select().from(bankCollections).where(
      and(
        eq(bankCollections.tenantId, ctx.tenantId),
        inArray(
          bankCollections.id,
          manifest.collections.map((c) => c.id),
        ),
      ),
    )
    : [];
  if (collections.length !== manifest.collections.length) {
    return { ok: false, code: 'invalid_selection' };
  }
  return {
    ok: true,
    value: {
      ...manifest,
      label: command.label,
      notes: command.notes,
      items: snapshot.value,
      collections: manifest.collections.map((c) => ({
        id: c.id,
        name: collections.find((row) => row.id === c.id)!.name,
      })),
    },
  };
}
function excludeFromManifest(
  manifest: ReleaseManifest,
  command: Extract<ReleaseCommand, { action: 'exclude' }>,
): ReleaseResult<ReleaseManifest> {
  if (command.questionIds.some((id) => !manifest.items.some((item) => item.questionId === id))) {
    return { ok: false, code: 'invalid_selection' };
  }
  const items = manifest.items.filter((item) => !command.questionIds.includes(item.questionId));
  if (!items.length) return { ok: false, code: 'invalid_selection' };
  return {
    ok: true,
    value: {
      ...manifest,
      items,
      exclusions: [
        ...manifest.exclusions,
        ...command.questionIds.map((questionId) => ({ questionId, reason: command.reason })),
      ],
    },
  };
}
function keepHistorical(
  manifest: ReleaseManifest,
  command: Extract<ReleaseCommand, { action: 'keep' }>,
): ReleaseResult<ReleaseManifest> {
  if (command.questionIds.some((id) => !manifest.items.some((item) => item.questionId === id))) {
    return { ok: false, code: 'invalid_selection' };
  }
  return {
    ok: true,
    value: {
      ...manifest,
      items: manifest.items.map((item) =>
        command.questionIds.includes(item.questionId) ? { ...item, selection: 'historical' } : item
      ),
    },
  };
}
async function freeze(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  row: typeof bankReleases.$inferSelect,
  manifest: ReleaseManifest,
  command: Extract<ReleaseCommand, { action: 'freeze' }>,
  now: Date,
  technicalBlockers: readonly string[],
): Promise<ReleaseResult<null>> {
  if (!manifest.preparation) return { ok: false, code: 'preparation_required' };
  const latest = await tx.select().from(questions).where(
    and(
      eq(questions.tenantId, ctx.tenantId),
      inArray(questions.id, manifest.items.map((item) => item.questionId)),
    ),
  ).for('update');
  if (
    manifest.items.some((item) =>
      item.selection === 'current' &&
      latest.find((q) => q.id === item.questionId)?.latestRevisionId !== item.revisionId
    )
  ) return { ok: false, code: 'stale_preview' };
  const fresh = await snapshotReleaseItems(tx, ctx, manifest.items);
  if (!fresh.ok) return fresh;
  // Shipping history is informational; a new review decision changes sign-off obligations.
  if (
    fresh.value.some((item, index) =>
      canonicalJsonStringify(item.eligibility) !==
      canonicalJsonStringify(manifest.items[index].eligibility)
    )
  ) return { ok: false, code: 'stale_preview' };
  const required = fresh.value.filter((item) => item.eligibility.kind === 'attestation_required');
  const evidenceDocument = {
    digest: row.digest,
    revisions: fresh.value.map((item) => item.eligibility),
    technicalBlockers,
  };
  if (command.attestation === null && evidenceDocument.technicalBlockers.length) {
    return { ok: false, code: 'technical_blocker' };
  }
  if (!command.attestation && required.length) return { ok: false, code: 'attestation_required' };
  const attestation = command.attestation === null ? null : validateManifestAttestation({
    ...command.attestation,
    operationId: command.operationId,
    manifestDigest: row.digest,
    revisionIds: required.map((item) => item.revisionId),
  }, evidenceDocument);
  if (attestation && !attestation.ok) return attestation;
  const adopted = await tx.update(bankReleasePreparations).set({ state: 'adopted' }).where(
    and(
      eq(bankReleasePreparations.id, manifest.preparation.id),
      eq(bankReleasePreparations.tenantId, ctx.tenantId),
      eq(bankReleasePreparations.releaseId, row.id),
      eq(bankReleasePreparations.state, 'ready'),
      eq(bankReleasePreparations.sha256, manifest.preparation.sha256),
    ),
  ).returning();
  if (!adopted.length) return { ok: false, code: 'preparation_conflict' };
  const evidence = {
    editorial: fresh.value.flatMap((item) =>
      item.eligibility.kind === 'reviewed' ? [item.eligibility.evidence] : []
    ),
    attestation: attestation?.ok
      ? {
        kind: 'publisher_attestation',
        editionId: row.id,
        actorId: ctx.userId,
        attestedAt: now.toISOString(),
        confirmation: attestation.attestation,
        revisions: required.map((item) => ({
          questionId: item.questionId,
          revisionId: item.revisionId,
          revisionAuthorId: item.eligibility.revisionAuthorId,
          intake: item.eligibility.intake,
        })),
      }
      : null,
  };
  await tx.update(bankReleases).set({ state: 'frozen', frozenAt: now, evidence }).where(
    eq(bankReleases.id, row.id),
  );
  return { ok: true, value: null };
}
async function changeDistribution(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  row: typeof bankReleases.$inferSelect,
  command: Extract<ReleaseCommand, { action: 'withdraw' | 'restore' }>,
): Promise<ReleaseResult<null>> {
  if (row.state !== 'frozen') return { ok: false, code: 'not_frozen' };
  if ((command.action === 'withdraw') === (row.distribution === 'withdrawn')) {
    return { ok: false, code: 'invalid_transition' };
  }
  if (command.replacementId !== null) {
    const [replacement] = await tx.select().from(bankReleases).where(
      and(
        eq(bankReleases.id, command.replacementId),
        eq(bankReleases.tenantId, ctx.tenantId),
        eq(bankReleases.state, 'frozen'),
      ),
    );
    if (!replacement || replacement.id === row.id) return { ok: false, code: 'invalid_selection' };
  }
  await tx.update(bankReleases).set({
    distribution: command.action === 'withdraw' ? 'withdrawn' : 'available',
    replacementId: command.replacementId,
  }).where(eq(bankReleases.id, row.id));
  return { ok: true, value: null };
}
async function replacePins(
  tx: QflowDatabaseTransaction,
  tenantId: string,
  releaseId: string,
  manifest: ReleaseManifest,
) {
  await tx.delete(bankReleaseRevisions).where(
    and(eq(bankReleaseRevisions.tenantId, tenantId), eq(bankReleaseRevisions.releaseId, releaseId)),
  );
  await tx.insert(bankReleaseRevisions).values(
    manifest.items.map((item) => ({
      tenantId,
      releaseId,
      questionId: item.questionId,
      revisionId: item.revisionId,
    })),
  );
}
async function findReplay(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  operationId: string,
  releaseId: string,
  command: unknown,
): Promise<ReleaseResult<string> | null> {
  const [event] = await tx.select().from(bankReleaseEvents).where(
    and(
      eq(bankReleaseEvents.tenantId, ctx.tenantId),
      eq(bankReleaseEvents.operationId, operationId),
    ),
  );
  if (!event) return null;
  return event.actorId === ctx.userId && event.releaseId === releaseId &&
      canonicalJsonStringify(event.command) === canonicalJsonStringify(command)
    ? { ok: true, value: releaseId }
    : { ok: false, code: 'operation_conflict' };
}
/** Record one immutable actor snapshot in the same transaction as its edition operation. */
export async function recordReleaseEvent(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  releaseId: string,
  operationId: string,
  command: unknown,
  now: Date,
): Promise<void> {
  const [actor] = await tx.select().from(users).where(eq(users.id, ctx.userId));
  if (!actor) throw new Error('Publication actor is missing.');
  await tx.insert(bankReleaseEvents).values({
    tenantId: ctx.tenantId,
    operationId,
    releaseId,
    actorId: ctx.userId,
    actorLabel: actor.displayName?.trim() || actor.email,
    command,
    createdAt: now,
  });
}
