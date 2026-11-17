import { preflightPrint } from '../print/print_preflight.ts';
import { and, eq } from 'drizzle-orm';
import { assessmentPrintPacks } from '../db/schema.ts';
import type { RequestContext } from '../tenants.ts';
import type { PrintResult } from '../print/print_contract.ts';
import { parsePrintPack, type PrintPack, printPackIdentityValid } from '../print/print_pack.ts';
import { printSourceDigest } from '../print/print_snapshot.ts';
import { canonicalJsonStringify } from '../canonical_json.ts';
import { sha256Hex } from '../sha256.ts';
import {
  getPrintPreview,
  inspectPrint,
  lockPrintAssessment,
  type PrintServices,
} from './assessment_print_previews.ts';
import { readPrintSourceInTransaction } from './assessment_print_source.ts';
import { canPublishEditions } from './workspace_authorization.ts';

import type { PrintConfirmation } from '../print/print_confirmation.ts';
export { parsePrintConfirmation } from '../print/print_confirmation.ts';

/** Recheck live source and authorized asset bytes, then promote the exact reviewed retained pair. */
export async function confirmPrintPack(
  ctx: RequestContext,
  assessmentId: string,
  id: string,
  confirmation: PrintConfirmation,
  deps: PrintServices,
): Promise<PrintResult<PrintPack>> {
  const preview = await getPrintPreview(ctx, assessmentId, id, deps);
  if (!preview.ok) return preview;
  const pack = preview.value;
  if (pack.state !== 'preview-ready' && pack.state !== 'confirmed') {
    return { ok: false, code: 'not_ready' };
  }
  if (!matches(pack, confirmation)) return { ok: false, code: 'stale_preview' };
  if (!await canPublishEditions(deps.database, ctx)) return { ok: false, code: 'forbidden' };
  if (pack.state === 'confirmed') return { ok: true, value: pack };
  if (pack.actorId !== ctx.userId) return { ok: false, code: 'forbidden' };
  const current = await inspectPrint(ctx, assessmentId, pack.snapshot.configuration, deps);
  if (!current.ok) return current;
  if (
    current.value.preflight.outcome !== 'ready' ||
    current.value.digest !== pack.snapshot.sourceDigest
  ) return { ok: false, code: 'stale_preview' };
  for (const artifact of [pack.candidate.student, pack.candidate.marking]) {
    try {
      const bytes = await deps.storage.readObject(artifact.key);
      if (bytes.length !== artifact.byteLength || await sha256Hex(bytes) !== artifact.sha256) {
        return { ok: false, code: 'snapshot_corrupt' };
      }
    } catch {
      return { ok: false, code: 'storage_failed' };
    }
  }
  return await deps.database.transaction(async (tx): Promise<PrintResult<PrintPack>> => {
    if (!await lockPrintAssessment(tx, ctx, assessmentId) || !await canPublishEditions(tx, ctx)) {
      return { ok: false, code: 'forbidden' };
    }
    const [row] = await tx.select().from(assessmentPrintPacks).where(
      and(
        eq(assessmentPrintPacks.tenantId, ctx.tenantId),
        eq(assessmentPrintPacks.id, id),
        eq(assessmentPrintPacks.assessmentId, assessmentId),
      ),
    ).for('update');
    const stored = row && parsePrintPack(row);
    if (!stored || !await printPackIdentityValid(stored) || !matches(stored, confirmation)) {
      return { ok: false, code: 'stale_preview' };
    }
    if (stored.state === 'confirmed') return { ok: true, value: stored };
    if (stored.state !== 'preview-ready') return { ok: false, code: 'not_ready' };
    const source = await readPrintSourceInTransaction(tx, ctx, assessmentId);
    if (
      !source.ok ||
      await printSourceDigest(
          source.value,
          stored.snapshot.configuration,
          current.value.prepared,
        ) !== stored.snapshot.sourceDigest
    ) return { ok: false, code: 'stale_preview' };
    const prepared = preflightPrint(stored.snapshot.source, stored.snapshot.configuration);
    if (prepared.preflight.outcome !== 'ready') return { ok: false, code: 'snapshot_corrupt' };
    const manualMarking = prepared.parts.flatMap((part) =>
      part.placements.flatMap((placement) =>
        placement.kind === 'question' && placement.question.scoring.kind === 'manual'
          ? [{
            placementId: placement.id,
            maximum: placement.question.scoring.maximum,
            guidancePresent: true,
          }]
          : []
      )
    );
    const confirmedAt = deps.now();
    const manifest = canonicalJsonStringify({
      schema: 'qflow.print-manifest.v1',
      packId: id,
      form: stored.snapshot.form,
      createdAt: stored.snapshot.createdAt,
      confirmedAt: confirmedAt.toISOString(),
      confirmedBy: ctx.userId,
      rendererId: stored.snapshot.rendererId,
      templateVersion: stored.snapshot.templateVersion,
      sourceDigest: stored.snapshot.sourceDigest,
      configuration: stored.snapshot.configuration,
      source: stored.snapshot.source,
      assets: stored.snapshot.assets,
      candidate: stored.candidate,
      adaptations: {
        presentationApproved: stored.snapshot.configuration.approvePresentation,
        order: stored.snapshot.configuration.order,
        responseLines: stored.snapshot.configuration.responseLines,
        responseOverrides: stored.snapshot.configuration.responseOverrides,
        manualMarking,
        separateStaffGuide: true,
      },
    });
    const [saved] = await tx.update(assessmentPrintPacks).set({
      state: 'confirmed',
      confirmedBy: ctx.userId,
      confirmedAt,
      manifest,
      manifestSha256: await sha256Hex(new TextEncoder().encode(manifest)),
    }).where(and(eq(assessmentPrintPacks.id, id), eq(assessmentPrintPacks.state, 'preview-ready')))
      .returning();
    const final = saved && parsePrintPack(saved);
    return final ? { ok: true, value: final } : { ok: false, code: 'not_ready' };
  });
}

function matches(pack: PrintPack, confirmation: PrintConfirmation): boolean {
  return (pack.state === 'preview-ready' || pack.state === 'confirmed') &&
    pack.candidate.digest === confirmation.candidateDigest &&
    pack.candidate.sourceDigest === confirmation.sourceDigest &&
    pack.candidate.student.sha256 === confirmation.studentSha256 &&
    pack.candidate.marking.sha256 === confirmation.markingSha256;
}
