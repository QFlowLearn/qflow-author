import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '../db.ts';
import { assessmentPrintPacks } from '../db/schema.ts';
import { resolveStorage } from '../storage.ts';
import { requireAuthContext } from '../tenants.ts';
import { isCanonicalUuid } from '../uuid.ts';
import { parsePrintConfiguration, type PrintFailureCode } from '../print/print_contract.ts';
import { printPackView } from '../print/print_view.ts';
import { parsePrintPack } from '../print/print_pack.ts';
import {
  createPrintPreview,
  getPrintPreview,
  inspectPrint,
  type PrintServices,
} from '../services/assessment_print_previews.ts';
import {
  confirmPrintPack,
  parsePrintConfirmation,
} from '../services/assessment_print_confirmation.ts';
import { downloadPrintFile } from '../services/assessment_print_delivery.ts';
import { hasWorkspaceCapability } from '../services/workspace_authorization.ts';
import {
  dispatchPendingWorkflowJobs,
  requireWorkflowBindings,
} from '../workflows/workflow_dispatch.ts';
import type { HttpRequest } from './route.ts';
import { attachmentContentDisposition } from './attachment_content_disposition.ts';

const headers = { 'cache-control': 'private, no-store' };
const services = (ctx: HttpRequest): PrintServices => ({
  database: getDb(ctx),
  storage: resolveStorage(ctx),
  now: () => new Date(),
  newId: () => crypto.randomUUID(),
});
const valid = (ctx: HttpRequest) =>
  isCanonicalUuid(ctx.params.id) && (!ctx.params.packId || isCanonicalUuid(ctx.params.packId)) &&
  ctx.url.search === '';
function failure(code: PrintFailureCode) {
  const statuses = {
    invalid_input: 400,
    forbidden: 403,
    not_found: 404,
    blocked: 422,
    stale_preview: 409,
    operation_conflict: 409,
    storage_failed: 503,
    render_failed: 422,
    font_unsupported: 422,
    not_ready: 409,
    snapshot_corrupt: 422,
  };
  return Response.json({ error: code }, { status: statuses[code], headers });
}
async function body(ctx: HttpRequest): Promise<Record<string, unknown> | null> {
  if (Number(ctx.req.headers.get('content-length') ?? 0) > 32000) return null;
  try {
    if (!ctx.req.body) return null;
    const reader = ctx.req.body.getReader(), chunks: Uint8Array[] = [];
    let count = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        count += chunk.value.length;
        if (count > 32000) {
          await reader.cancel();
          return null;
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(count);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value))
      : null;
  } catch {
    return null;
  }
}
/** Current draft preflight; assets are read only after tenant ownership is established. */
export async function printPreflightHttp(ctx: HttpRequest): Promise<Response> {
  if (!valid(ctx)) return failure('invalid_input');
  const input = await body(ctx),
    configuration = input && Object.keys(input).length === 1 &&
      parsePrintConfiguration(input.configuration);
  if (!configuration) return failure('invalid_input');
  const result = await inspectPrint(
    requireAuthContext(ctx.state),
    ctx.params.id,
    configuration,
    services(ctx),
  );
  return result.ok ? Response.json(result.value.preflight, { headers }) : failure(result.code);
}
/** Persist the reservation and outbox before nudging the existing durable dispatcher. */
export async function printCreateHttp(ctx: HttpRequest): Promise<Response> {
  if (!valid(ctx)) return failure('invalid_input');
  const input = await body(ctx),
    configuration = input && Object.keys(input).length === 2 &&
      parsePrintConfiguration(input.configuration);
  if (
    !configuration || typeof input?.operationId !== 'string' || !isCanonicalUuid(input.operationId)
  ) return failure('invalid_input');
  requireWorkflowBindings(ctx);
  const auth = requireAuthContext(ctx.state);
  const result = await createPrintPreview(
    auth,
    ctx.params.id,
    input.operationId,
    configuration,
    services(ctx),
  );
  if (!result.ok) return failure(result.code);
  if (result.value.pack?.state === 'queued') {
    await dispatchPendingWorkflowJobs(ctx, {
      jobIds: [result.value.pack.id],
      tenantId: auth.tenantId,
    });
  }
  return Response.json({
    preflight: result.value.preflight,
    pack: result.value.pack && printPackView(result.value.pack),
  }, { headers, status: result.value.pack ? 202 : 200 });
}
/** Restore retained history after navigation without exposing sealed source or keys. */
export async function printListHttp(ctx: HttpRequest): Promise<Response> {
  if (!valid(ctx)) return failure('invalid_input');
  const auth = requireAuthContext(ctx.state), deps = services(ctx);
  if (!await hasWorkspaceCapability(auth, 'manage_content', deps.database)) {
    return failure('forbidden');
  }
  const rows = await deps.database.select().from(assessmentPrintPacks).where(
    and(
      eq(assessmentPrintPacks.tenantId, auth.tenantId),
      eq(assessmentPrintPacks.assessmentId, ctx.params.id),
    ),
  ).orderBy(desc(assessmentPrintPacks.createdAt)).limit(20);
  const packs = rows.map(parsePrintPack);
  if (packs.some((pack) => pack === null)) return failure('snapshot_corrupt');
  return Response.json(packs.filter((pack) => pack !== null).map(printPackView), { headers });
}
export async function printStatusHttp(ctx: HttpRequest): Promise<Response> {
  if (!valid(ctx)) return failure('invalid_input');
  const result = await getPrintPreview(
    requireAuthContext(ctx.state),
    ctx.params.id,
    ctx.params.packId,
    services(ctx),
  );
  return result.ok ? Response.json(printPackView(result.value), { headers }) : failure(result.code);
}
export async function printConfirmHttp(ctx: HttpRequest): Promise<Response> {
  if (!valid(ctx)) return failure('invalid_input');
  const confirmation = parsePrintConfirmation(await body(ctx));
  if (!confirmation) return failure('invalid_input');
  const result = await confirmPrintPack(
    requireAuthContext(ctx.state),
    ctx.params.id,
    ctx.params.packId,
    confirmation,
    services(ctx),
  );
  return result.ok ? Response.json(printPackView(result.value), { headers }) : failure(result.code);
}
/** Kind is fixed in the route definition, never inferred from request data or an object key. */
export function printDownloadHttp(kind: 'student' | 'marking' | 'manifest', preview: boolean) {
  return async (ctx: HttpRequest): Promise<Response> => {
    if (!valid(ctx)) return failure('invalid_input');
    const result = await downloadPrintFile(
      requireAuthContext(ctx.state),
      ctx.params.id,
      ctx.params.packId,
      kind,
      preview,
      services(ctx),
    );
    if (!result.ok) return failure(result.code);
    return new Response(new Uint8Array(result.value.bytes), {
      headers: {
        ...headers,
        'content-type': result.value.contentType,
        'content-disposition': attachmentContentDisposition(result.value.filename),
        'content-length': String(result.value.bytes.length),
        'x-content-type-options': 'nosniff',
        'x-qflow-sha256': result.value.sha256,
      },
    });
  };
}
