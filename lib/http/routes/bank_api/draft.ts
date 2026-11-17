import {
  deleteDraftSession,
  getDraftSession,
  updateDraftSession,
} from '../../../services/drafts.ts';
import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { draftRequestJson, parseDraftBody } from '../../../draft_request.ts';
import { parseDraftSessionId } from '../../../draft_session_id.ts';
import { hasCapability } from '../../../roles.ts';

/** Shared bank API endpoint contract and implementation. */
export const draftBankRoute = defineHttpRoute('/api/drafts/:id', {
  GET: handleGET,
  PUT: handlePUT,
  DELETE: handleDELETE,
});

function draftMutationFailureResponse(code: 'forbidden' | 'not_found'): Response {
  return code === 'forbidden'
    ? new Response('Forbidden', { status: 403 })
    : new Response('Not Found', { status: 404 });
}

async function handleGET(ctx: HttpRequest) {
  const { params } = ctx;
  const id = parseDraftSessionId(params.id);
  if (!id) return new Response('Not Found', { status: 404 });
  const auth = requireAuthContext(ctx.state);
  const draft = await getDraftSession(auth, id);
  if (!draft) return new Response('Not Found', { status: 404 });
  return new Response(JSON.stringify(draft), { headers: { 'content-type': 'application/json' } });
}

async function handlePUT(ctx: HttpRequest) {
  const { req, params } = ctx;
  const id = parseDraftSessionId(params.id);
  if (!id) return new Response('Not Found', { status: 404 });
  const auth = requireAuthContext(ctx.state);
  if (!hasCapability(auth.role, 'manage_content')) {
    return new Response('Forbidden', { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const draft = parseDraftBody(body);
  if (!('type' in draft)) return draftRequestJson(draft);
  const updated = await updateDraftSession(auth, id, draft);
  if (!updated.ok) return draftMutationFailureResponse(updated.code);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json' },
  });
}

async function handleDELETE(ctx: HttpRequest) {
  const { params } = ctx;
  const id = parseDraftSessionId(params.id);
  if (!id) return new Response('Not Found', { status: 404 });
  const auth = requireAuthContext(ctx.state);
  if (!hasCapability(auth.role, 'manage_content')) {
    return new Response('Forbidden', { status: 403 });
  }
  const deleted = await deleteDraftSession(auth, id);
  if (!deleted.ok) return draftMutationFailureResponse(deleted.code);
  return new Response(null, { status: 204 });
}
