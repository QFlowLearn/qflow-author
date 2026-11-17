import { and, eq } from 'drizzle-orm';
import type { QflowDatabase, QflowDatabaseTransaction } from '../db.ts';
import { assessmentPrintPacks, assessments, workflowDispatches } from '../db/schema.ts';
import type { RequestContext } from '../tenants.ts';
import type { ObjectStorage } from '../storage_contract.ts';
import type { PrintConfiguration, PrintPreflight, PrintResult } from '../print/print_contract.ts';
import { canonicalJsonStringify } from '../canonical_json.ts';
import { parsePrintPack, type PrintPack, printPackIdentityValid } from '../print/print_pack.ts';
import { preflightPrint, printImageReferences } from '../print/print_preflight.ts';
import {
  PRINT_RENDERER_ID,
  PRINT_TEMPLATE_VERSION,
  type PrintAsset,
  type PrintSnapshot,
  printSourceDigest,
} from '../print/print_snapshot.ts';
import {
  cleanupPrintAssets,
  type PreparedPrintAsset,
  preparePrintAssets,
  retainPrintAssets,
} from './assessment_print_assets.ts';
import { readPrintSource, readPrintSourceInTransaction } from './assessment_print_source.ts';
import {
  hasWorkspaceCapability,
  lockWorkspaceAndRequireAuthority,
} from './workspace_authorization.ts';

/** Explicit persistence and object capabilities, shared by HTTP and runtime tests. */
export type PrintServices = {
  readonly database: QflowDatabase;
  readonly storage: ObjectStorage;
  readonly now: () => Date;
  readonly newId: () => string;
};

/** Inspect the whole ordered paper, including assets authorized through the current tenant. */
export async function inspectPrint(
  ctx: RequestContext,
  assessmentId: string,
  configuration: PrintConfiguration,
  deps: PrintServices,
) {
  const source = await readPrintSource(ctx, assessmentId, deps.database);
  if (!source.ok) return source;
  const parsed = preflightPrint(source.value, configuration);
  const prepared = await preparePrintAssets(ctx, printImageReferences(parsed.parts), deps.storage);
  const inspected = preflightPrint(source.value, configuration, prepared.problems);
  return {
    ok: true as const,
    value: {
      source: source.value,
      prepared: prepared.assets,
      preflight: inspected.preflight,
      digest: await printSourceDigest(source.value, configuration, prepared.assets),
    },
  };
}

/** Reserve one immutable form before retaining assets, then atomically enqueue its durable build. */
export async function createPrintPreview(
  ctx: RequestContext,
  assessmentId: string,
  operationId: string,
  configuration: PrintConfiguration,
  deps: PrintServices,
): Promise<PrintResult<{ readonly pack: PrintPack | null; readonly preflight: PrintPreflight }>> {
  if (!await hasWorkspaceCapability(ctx, 'manage_content', deps.database)) {
    return { ok: false, code: 'forbidden' };
  }
  const [prior] = await deps.database.select().from(assessmentPrintPacks).where(
    and(
      eq(assessmentPrintPacks.tenantId, ctx.tenantId),
      eq(assessmentPrintPacks.operationId, operationId),
    ),
  );
  if (prior) {
    const pack = parsePrintPack(prior);
    if (!pack || !await printPackIdentityValid(pack)) {
      return { ok: false, code: 'snapshot_corrupt' };
    }
    if (
      pack.actorId !== ctx.userId || pack.assessmentId !== assessmentId ||
      canonicalJsonStringify(pack.snapshot.configuration) !== canonicalJsonStringify(configuration)
    ) return { ok: false, code: 'operation_conflict' };
    const inspected = preflightPrint(pack.snapshot.source, configuration);
    if (pack.state !== 'preparing') {
      return { ok: true, value: { pack, preflight: inspected.preflight } };
    }
    const prepared = await preparePrintAssets(
      ctx,
      printImageReferences(inspected.parts),
      deps.storage,
    );
    if (
      prepared.problems.size ||
      await printSourceDigest(pack.snapshot.source, configuration, prepared.assets) !==
        pack.snapshot.sourceDigest
    ) {
      const terminal = await deps.database.update(assessmentPrintPacks).set({
        state: 'failed',
        failureCode: 'stale_preview',
      }).where(
        and(eq(assessmentPrintPacks.id, pack.id), eq(assessmentPrintPacks.state, 'preparing')),
      ).returning({ id: assessmentPrintPacks.id });
      if (terminal.length) {
        await cleanupPrintAssets(ctx, pack.id, pack.snapshot.assets, deps.storage);
      }
      return { ok: false, code: 'stale_preview' };
    }
    return await retainAndQueue(ctx, pack, prepared.assets, inspected.preflight, deps);
  }
  const inspected = await inspectPrint(ctx, assessmentId, configuration, deps);
  if (!inspected.ok) return inspected;
  const { source, prepared, preflight, digest } = inspected.value;
  if (preflight.outcome !== 'ready') return { ok: true, value: { pack: null, preflight } };
  const id = deps.newId(), executionId = deps.newId(), createdAt = deps.now();
  const assets: PrintAsset[] = prepared.map((asset) => ({
    reference: asset.reference,
    sourceSha256: asset.sourceSha256,
    sourceKey: `print/${ctx.tenantId}/${id}/assets/source-${asset.sourceSha256}`,
    key: `print/${ctx.tenantId}/${id}/assets/image-${asset.sha256}`,
    sha256: asset.sha256,
    mediaType: asset.image.mediaType,
    byteLength: asset.image.bytes.length,
    width: asset.image.width,
    height: asset.image.height,
  }));
  const snapshot: PrintSnapshot = {
    schema: 'qflow.print-snapshot.v1',
    id,
    tenantId: ctx.tenantId,
    form: `QF-${id.toUpperCase()}`,
    createdAt: createdAt.toISOString(),
    sourceDigest: digest,
    rendererId: PRINT_RENDERER_ID,
    templateVersion: PRINT_TEMPLATE_VERSION,
    source,
    configuration,
    assets,
  };
  const reservation = await deps.database.transaction(
    async (tx): Promise<PrintResult<{ readonly pack: PrintPack; readonly fresh: boolean }>> => {
      if (!await lockPrintAssessment(tx, ctx, assessmentId)) {
        return { ok: false, code: 'forbidden' };
      }
      const [prior] = await tx.select().from(assessmentPrintPacks).where(
        and(
          eq(assessmentPrintPacks.tenantId, ctx.tenantId),
          eq(assessmentPrintPacks.operationId, operationId),
        ),
      );
      if (prior) {
        if (
          prior.actorId !== ctx.userId || prior.assessmentId !== assessmentId ||
          prior.sourceDigest !== digest
        ) return { ok: false, code: 'operation_conflict' };
        const pack = parsePrintPack(prior);
        return pack
          ? { ok: true, value: { pack, fresh: false } }
          : { ok: false, code: 'snapshot_corrupt' };
      }
      const current = await readPrintSourceInTransaction(tx, ctx, assessmentId);
      if (
        !current.ok || await printSourceDigest(current.value, configuration, assets) !== digest
      ) return { ok: false, code: 'stale_preview' };
      const [row] = await tx.insert(assessmentPrintPacks).values({
        id,
        tenantId: ctx.tenantId,
        assessmentId,
        actorId: ctx.userId,
        operationId,
        sourceDigest: digest,
        snapshot,
        state: 'preparing',
        workflowExecutionId: executionId,
        createdAt,
      }).returning();
      const pack = row && parsePrintPack(row);
      return pack
        ? { ok: true, value: { pack, fresh: true } }
        : { ok: false, code: 'snapshot_corrupt' };
    },
  );
  if (!reservation.ok) return reservation;
  if (!reservation.value.fresh) {
    return { ok: true, value: { pack: reservation.value.pack, preflight } };
  }
  return await retainAndQueue(ctx, reservation.value.pack, prepared, preflight, deps);
}

/** Current editorial authority is required even for retained draft previews. */
export async function getPrintPreview(
  ctx: RequestContext,
  assessmentId: string,
  id: string,
  deps: Pick<PrintServices, 'database'>,
): Promise<PrintResult<PrintPack>> {
  if (!await hasWorkspaceCapability(ctx, 'manage_content', deps.database)) {
    return { ok: false, code: 'forbidden' };
  }
  const [row] = await deps.database.select().from(assessmentPrintPacks).where(
    and(
      eq(assessmentPrintPacks.tenantId, ctx.tenantId),
      eq(assessmentPrintPacks.assessmentId, assessmentId),
      eq(assessmentPrintPacks.id, id),
    ),
  );
  if (!row) return { ok: false, code: 'not_found' };
  const pack = parsePrintPack(row);
  return pack && await printPackIdentityValid(pack)
    ? { ok: true, value: pack }
    : { ok: false, code: 'snapshot_corrupt' };
}

/** Reuse the existing workspace and assessment serialization boundary. */
export async function lockPrintAssessment(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  assessmentId: string,
): Promise<boolean> {
  if (!await lockWorkspaceAndRequireAuthority(tx, ctx, { capability: 'manage_content' })) {
    return false;
  }
  const [assessment] = await tx.select({ id: assessments.id }).from(assessments).where(
    and(eq(assessments.tenantId, ctx.tenantId), eq(assessments.id, assessmentId)),
  ).for('update');
  return assessment !== undefined;
}

async function retainAndQueue(
  ctx: RequestContext,
  pack: PrintPack,
  prepared: readonly PreparedPrintAsset[],
  preflight: PrintPreflight,
  deps: PrintServices,
): Promise<PrintResult<{ readonly pack: PrintPack | null; readonly preflight: PrintPreflight }>> {
  const { id, assessmentId, snapshot } = pack,
    { sourceDigest: digest, assets, configuration } = snapshot;
  const executionId = pack.workflowExecutionId;
  if (!executionId) return { ok: false, code: 'snapshot_corrupt' };
  const createdAt = new Date(snapshot.createdAt);
  if (!await retainPrintAssets(ctx, id, prepared, deps.storage)) {
    const terminal = await deps.database.update(assessmentPrintPacks).set({
      state: 'failed',
      failureCode: 'storage_failed',
    })
      .where(and(eq(assessmentPrintPacks.id, id), eq(assessmentPrintPacks.state, 'preparing')))
      .returning({ id: assessmentPrintPacks.id });
    if (terminal.length) await cleanupPrintAssets(ctx, id, assets, deps.storage);
    return { ok: false, code: 'storage_failed' };
  }
  type Outcome = {
    readonly result: PrintResult<
      { readonly pack: PrintPack | null; readonly preflight: PrintPreflight }
    >;
    readonly cleanup: boolean;
  };
  const queued = await deps.database.transaction(async (tx): Promise<Outcome> => {
    const fail = async (code: 'forbidden' | 'stale_preview'): Promise<Outcome> => {
      const terminal = await tx.update(assessmentPrintPacks).set({
        state: 'failed',
        failureCode: code,
      })
        .where(and(eq(assessmentPrintPacks.id, id), eq(assessmentPrintPacks.state, 'preparing')))
        .returning({ id: assessmentPrintPacks.id });
      return {
        result: { ok: false, code: terminal.length ? code : 'not_ready' },
        cleanup: terminal.length > 0,
      };
    };
    if (!await lockPrintAssessment(tx, ctx, assessmentId)) return await fail('forbidden');
    const current = await readPrintSourceInTransaction(tx, ctx, assessmentId);
    if (!current.ok || await printSourceDigest(current.value, configuration, assets) !== digest) {
      return await fail('stale_preview');
    }
    const [row] = await tx.update(assessmentPrintPacks).set({ state: 'queued' }).where(
      and(eq(assessmentPrintPacks.id, id), eq(assessmentPrintPacks.state, 'preparing')),
    ).returning();
    if (!row) return { result: { ok: false, code: 'not_ready' }, cleanup: false };
    await tx.insert(workflowDispatches).values({
      id: executionId,
      kind: 'assessment_print',
      jobId: id,
      tenantId: ctx.tenantId,
      state: 'pending',
      createdAt,
      updatedAt: createdAt,
    });
    const saved = parsePrintPack(row);
    return {
      result: saved
        ? { ok: true, value: { pack: saved, preflight } }
        : { ok: false, code: 'snapshot_corrupt' },
      cleanup: false,
    };
  });
  if (queued.cleanup) await cleanupPrintAssets(ctx, id, assets, deps.storage);
  return queued.result;
}
