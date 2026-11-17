import { and, eq, inArray } from 'drizzle-orm';
import type { QflowDatabase, QflowDatabaseTransaction } from '../db.ts';
import { assessmentPrintPacks, organizationMemberships } from '../db/schema.ts';
import type { RequestContext } from '../tenants.ts';
import { parseRole } from '../roles.ts';
import type { ObjectStorage } from '../storage_contract.ts';
import {
  parsePrintPack,
  type PrintCandidate,
  type PrintPack,
  printPackIdentityValid,
  type PrintPdfArtifact,
} from '../print/print_pack.ts';
import type { PrintResult } from '../print/print_contract.ts';
import type { PrintRenderer } from '../print/print_renderer_contract.ts';
import {
  PRINT_RENDERER_ID,
  PRINT_TEMPLATE_VERSION,
  printSourceDigest,
} from '../print/print_snapshot.ts';
import { preflightPrint } from '../print/print_preflight.ts';
import { projectMarkingPaper, projectStudentPaper } from '../print/print_projection.ts';
import type { PrintImage } from '../print/print_image.ts';
import {
  hasWorkspaceCapability,
  lockWorkspaceAndRequireAuthority,
} from './workspace_authorization.ts';
import { sha256Hex } from '../sha256.ts';
import { canonicalJsonStringify } from '../canonical_json.ts';
import type { WorkflowTerminalDomainOutcome } from '../job_failure.ts';

/** Build only retained immutable source, with no ambient latest-revision or network lookup. */
export async function buildPrintPack(
  id: string,
  executionId: string,
  deps: {
    readonly database: QflowDatabase;
    readonly storage: ObjectStorage;
    readonly renderer: PrintRenderer;
  },
): Promise<PrintResult<null>> {
  const [unlocked] = await deps.database.select().from(assessmentPrintPacks).where(
    and(eq(assessmentPrintPacks.id, id), eq(assessmentPrintPacks.workflowExecutionId, executionId)),
  );
  const observed = unlocked && parsePrintPack(unlocked);
  if (!observed || !await printPackIdentityValid(observed)) {
    return { ok: false, code: 'snapshot_corrupt' };
  }
  const claim = await deps.database.transaction(async (tx): Promise<PrintPack | null> => {
    const actor = await printActor(tx, observed);
    if (
      !actor || !await lockWorkspaceAndRequireAuthority(tx, actor, { capability: 'manage_content' })
    ) return null;
    const [row] = await tx.select().from(assessmentPrintPacks).where(
      and(
        eq(assessmentPrintPacks.id, id),
        eq(assessmentPrintPacks.workflowExecutionId, executionId),
      ),
    ).for('update');
    if (!row) return null;
    const pack = parsePrintPack(row);
    if (!pack || !await printPackIdentityValid(pack)) return null;
    if (pack.state !== 'queued' && pack.state !== 'building') return pack;
    await tx.update(assessmentPrintPacks).set({ state: 'building' }).where(
      eq(assessmentPrintPacks.id, id),
    );
    return pack;
  });
  if (!claim) return { ok: false, code: 'forbidden' };
  if (claim.state === 'preview-ready' || claim.state === 'confirmed') {
    return { ok: true, value: null };
  }
  if (claim.state !== 'queued' && claim.state !== 'building') {
    return { ok: false, code: 'not_ready' };
  }
  const fail = async (
    code:
      | 'snapshot_corrupt'
      | 'storage_failed'
      | 'render_failed'
      | 'font_unsupported'
      | 'forbidden',
  ): Promise<PrintResult<null>> => {
    if (code === 'storage_failed') throw new PrintBuildStorageError();
    await deps.database.update(assessmentPrintPacks).set({ state: 'failed', failureCode: code })
      .where(
        and(
          eq(assessmentPrintPacks.id, id),
          eq(assessmentPrintPacks.workflowExecutionId, executionId),
          inArray(assessmentPrintPacks.state, ['queued', 'building']),
        ),
      );
    return { ok: false, code };
  };
  const snapshot = claim.snapshot;
  if (
    snapshot.rendererId !== PRINT_RENDERER_ID || snapshot.templateVersion !== PRINT_TEMPLATE_VERSION
  ) return await fail('snapshot_corrupt');
  if (
    await printSourceDigest(snapshot.source, snapshot.configuration, snapshot.assets) !==
      snapshot.sourceDigest
  ) return await fail('snapshot_corrupt');
  const prepared = preflightPrint(snapshot.source, snapshot.configuration);
  if (prepared.preflight.outcome !== 'ready') return await fail('snapshot_corrupt');
  const assets = new Map<string, PrintImage>();
  try {
    for (const asset of snapshot.assets) {
      const bytes = await deps.storage.readObject(asset.key);
      if (bytes.length !== asset.byteLength || await sha256Hex(bytes) !== asset.sha256) {
        return await fail('snapshot_corrupt');
      }
      assets.set(asset.reference, {
        bytes,
        mediaType: asset.mediaType,
        width: asset.width,
        height: asset.height,
      });
    }
  } catch {
    return await fail('storage_failed');
  }
  const projection = {
    configuration: snapshot.configuration,
    form: snapshot.form,
    createdAt: snapshot.createdAt,
    parts: prepared.parts,
    assets,
  };
  const artifacts: PrintPdfArtifact[] = [];
  for (const kind of ['student', 'marking'] as const) {
    const paper = kind === 'student'
      ? projectStudentPaper(projection)
      : projectMarkingPaper(projection);
    if (!paper.ok) return await fail('snapshot_corrupt');
    const result = await deps.renderer.render(paper.value);
    if (!result.ok) {
      return await fail(result.code === 'font_unsupported' ? 'font_unsupported' : 'render_failed');
    }
    const rendered = result.value;
    try {
      const sha256 = await sha256Hex(rendered.bytes),
        key = `print/${snapshot.tenantId}/${id}/pdf/${kind}-${sha256}.pdf`;
      await deps.storage.putObject({
        key,
        data: rendered.bytes,
        contentType: 'application/pdf',
        immutableIdentity: { sha256 },
      });
      artifacts.push({ key, sha256, byteLength: rendered.bytes.length, pages: rendered.pages });
    } catch {
      return await fail('storage_failed');
    }
  }
  const pair = {
    sourceDigest: snapshot.sourceDigest,
    student: artifacts[0],
    marking: artifacts[1],
    checks: [
      'canonical-content',
      'separate-projections',
      'retained-assets',
      'compiler-diagnostics',
      'page-count',
    ],
  };
  const candidate: PrintCandidate = {
    ...pair,
    digest: await sha256Hex(new TextEncoder().encode(canonicalJsonStringify(pair))),
  };
  return await deps.database.transaction(async (tx) => {
    const actor = await printActor(tx, claim);
    if (
      !actor || !await lockWorkspaceAndRequireAuthority(tx, actor, { capability: 'manage_content' })
    ) {
      await tx.update(assessmentPrintPacks).set({ state: 'failed', failureCode: 'forbidden' })
        .where(and(eq(assessmentPrintPacks.id, id), eq(assessmentPrintPacks.state, 'building')));
      return { ok: false as const, code: 'forbidden' as const };
    }
    const adopted = await tx.update(assessmentPrintPacks).set({ state: 'preview-ready', candidate })
      .where(
        and(
          eq(assessmentPrintPacks.id, id),
          eq(assessmentPrintPacks.tenantId, claim.tenantId),
          eq(assessmentPrintPacks.workflowExecutionId, executionId),
          eq(assessmentPrintPacks.state, 'building'),
        ),
      ).returning({ id: assessmentPrintPacks.id });
    return adopted.length
      ? { ok: true as const, value: null }
      : { ok: false as const, code: 'not_ready' as const };
  });
}

async function printActor(
  database: Pick<QflowDatabase, 'select'>,
  pack: PrintPack,
): Promise<RequestContext | null> {
  const [member] = await database.select({ role: organizationMemberships.role }).from(
    organizationMemberships,
  ).where(
    and(
      eq(organizationMemberships.tenantId, pack.tenantId),
      eq(organizationMemberships.userId, pack.actorId),
    ),
  );
  const role = parseRole(member?.role);
  if (!role) return null;
  const ctx = { tenantId: pack.tenantId, userId: pack.actorId, role };
  return await hasWorkspaceCapability(ctx, 'manage_content', database) ? ctx : null;
}

/** Reconcile a terminated durable execution with the existing dispatch outbox. */
export async function settlePrintAfterWorkflowTerminal(
  tx: QflowDatabaseTransaction,
  input: { readonly jobId: string; readonly tenantId: string; readonly executionId: string },
): Promise<WorkflowTerminalDomainOutcome> {
  const [row] = await tx.select({ state: assessmentPrintPacks.state }).from(assessmentPrintPacks)
    .where(
      and(
        eq(assessmentPrintPacks.id, input.jobId),
        eq(assessmentPrintPacks.tenantId, input.tenantId),
        eq(assessmentPrintPacks.workflowExecutionId, input.executionId),
      ),
    ).for('update');
  if (!row) return { _tag: 'JobMissing' };
  if (row.state === 'preview-ready' || row.state === 'confirmed') {
    return { _tag: 'AlreadyCompleted' };
  }
  if (row.state === 'failed') return { _tag: 'AlreadyFailed' };
  await tx.update(assessmentPrintPacks).set({ state: 'failed', failureCode: 'render_failed' })
    .where(eq(assessmentPrintPacks.id, input.jobId));
  return { _tag: 'Failed' };
}

/** Transient object I/O keeps the same claimed form eligible for durable retry. */
export class PrintBuildStorageError extends Error {
  constructor() {
    super('Print object storage is temporarily unavailable.');
    this.name = 'PrintBuildStorageError';
  }
}
