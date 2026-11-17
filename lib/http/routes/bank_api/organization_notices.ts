import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { parseOrganizationNoticeAck } from '../../../organization_notices.ts';
import { organizationNoticeActions } from '../../../services/question_organization_notices.ts';

const headers = { 'Cache-Control': 'no-store' };
const statuses = {
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  invalid_input: 400,
  storage_failed: 503,
};

/** The API middleware supplies authentication, content authority and same-origin CSRF checks. */
const methods = {
  async GET(ctx: HttpRequest) {
    const result = await organizationNoticeActions(ctx.runtime).read(requireAuthContext(ctx.state));
    return result.ok
      ? Response.json(result.value, { headers })
      : Response.json({ error: result.code }, { status: statuses[result.code], headers });
  },
  async POST(ctx: HttpRequest) {
    let raw: unknown;
    try {
      raw = await ctx.req.json();
    } catch {
      return Response.json({ error: 'invalid_input' }, { status: 400, headers });
    }
    const command = parseOrganizationNoticeAck(raw);
    if (!command) return Response.json({ error: 'invalid_input' }, { status: 400, headers });
    const result = await organizationNoticeActions(ctx.runtime).acknowledge(
      requireAuthContext(ctx.state),
      command,
    );
    return result.ok
      ? new Response(null, { status: 204, headers })
      : Response.json({ error: result.code }, { status: statuses[result.code], headers });
  },
};

export const organizationNoticesRoute = defineHttpRoute('/api/items/organization-notices', {
  GET: methods.GET,
  HEAD: methods.GET,
  POST: methods.POST,
});
