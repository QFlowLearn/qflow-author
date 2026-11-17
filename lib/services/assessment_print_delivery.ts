import { and, eq } from 'drizzle-orm';
import { assessmentPrintPacks } from '../db/schema.ts';
import { parsePrintPack, printPackIdentityValid } from '../print/print_pack.ts';
import type { PrintResult } from '../print/print_contract.ts';
import type { RequestContext } from '../tenants.ts';
import { canPublishEditions, hasWorkspaceCapability } from './workspace_authorization.ts';
import type { PrintServices } from './assessment_print_previews.ts';
import { sha256Hex } from '../sha256.ts';

/** Separate typed download routes select slots; callers cannot submit an arbitrary object key. */
export async function downloadPrintFile(
  ctx: RequestContext,
  assessmentId: string,
  id: string,
  kind: 'student' | 'marking' | 'manifest',
  preview: boolean,
  deps: PrintServices,
): Promise<
  PrintResult<
    {
      readonly bytes: Uint8Array;
      readonly contentType: string;
      readonly filename: string;
      readonly sha256: string;
    }
  >
> {
  const authorized = () =>
    preview
      ? hasWorkspaceCapability(ctx, 'manage_content', deps.database)
      : canPublishEditions(deps.database, ctx);
  if (!await authorized()) return { ok: false, code: 'forbidden' };
  const [row] = await deps.database.select().from(assessmentPrintPacks).where(
    and(
      eq(assessmentPrintPacks.id, id),
      eq(assessmentPrintPacks.tenantId, ctx.tenantId),
      eq(assessmentPrintPacks.assessmentId, assessmentId),
    ),
  );
  if (!row) return { ok: false, code: 'not_found' };
  const pack = parsePrintPack(row);
  if (!pack || !await printPackIdentityValid(pack)) return { ok: false, code: 'snapshot_corrupt' };
  if (
    preview
      ? (pack.state !== 'preview-ready' && pack.state !== 'confirmed')
      : pack.state !== 'confirmed'
  ) return { ok: false, code: 'not_ready' };
  if (pack.state !== 'preview-ready' && pack.state !== 'confirmed') {
    return { ok: false, code: 'not_ready' };
  }
  if (kind === 'manifest') {
    if (preview || pack.state !== 'confirmed') return { ok: false, code: 'not_ready' };
    const bytes = new TextEncoder().encode(pack.manifest);
    if (await sha256Hex(bytes) !== pack.manifestSha256) {
      return { ok: false, code: 'snapshot_corrupt' };
    }
    if (!await authorized()) return { ok: false, code: 'forbidden' };
    return {
      ok: true,
      value: {
        bytes,
        contentType: 'application/json',
        filename: `${pack.snapshot.form}-manifest.json`,
        sha256: pack.manifestSha256,
      },
    };
  }
  const artifact = pack.candidate[kind];
  try {
    const bytes = await deps.storage.readObject(artifact.key);
    if (bytes.length !== artifact.byteLength || await sha256Hex(bytes) !== artifact.sha256) {
      return { ok: false, code: 'snapshot_corrupt' };
    }
    if (!await authorized()) return { ok: false, code: 'forbidden' };
    return {
      ok: true,
      value: {
        bytes,
        contentType: 'application/pdf',
        filename: `${pack.snapshot.form}-${kind}.pdf`,
        sha256: artifact.sha256,
      },
    };
  } catch {
    return { ok: false, code: 'storage_failed' };
  }
}
