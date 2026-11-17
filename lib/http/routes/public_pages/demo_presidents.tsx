import { ensureDemoPresidents } from '../../../demo_presidents_seed.ts';
import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { requireAuthContext } from '../../../tenants.ts';

// Creates a sample assessment with a few items about US Presidents
/** Shared route contract preserving the existing server-rendered page behavior. */
export const demoPresidentsPageRoute = defineHttpRoute('/demo/presidents', {
  GET: handleGET,
  HEAD: handleGET,
});

export default function _() {
  return null;
}

async function handleGET(ctx: HttpRequest) {
  const auth = requireAuthContext(ctx.state);
  const id = await ensureDemoPresidents(auth);
  return new Response(null, { status: 302, headers: { location: `/assessments/${id}` } });
}
