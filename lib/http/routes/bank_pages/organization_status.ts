import { defineHttpRoute, type HttpHandler } from '../../route.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { enrichmentPageServices } from '../../bank_enrichment.ts';

const methods = {
  async GET(ctx) {
    const result = await enrichmentPageServices(ctx).read.status(
      requireAuthContext(ctx.state),
      ctx.params.id,
    );
    return result.ok
      ? Response.json({ updatedAt: result.value.updatedAt }, {
        headers: { 'cache-control': 'no-store' },
      })
      : Response.json({ error: 'unavailable' }, {
        status: result.code === 'forbidden' ? 403 : 404,
      });
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const bankOrganizationStatusPageRoute = defineHttpRoute('/items/organize/:id/status', {
  ...methods,
  HEAD: methods.GET,
});
