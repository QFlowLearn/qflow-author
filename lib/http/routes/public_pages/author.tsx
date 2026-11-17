import { listAssessments } from '../../../services/assessment_records.ts';
import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { requireAuthContext } from '../../../tenants.ts';

/** Shared route contract preserving the existing server-rendered page behavior. */
export const authorPageRoute = defineHttpRoute('/author', { GET: handleGET, HEAD: handleGET });

export function authorNotFoundResponse(i18n: import('../../../i18n/messages.ts').I18n): Response {
  return new Response(i18n.t('help.page.notFound.description'), { status: 404 });
}

export default function _() {
  return null;
}

async function handleGET(ctx: HttpRequest) {
  // Redirect to the most recently updated assessment.
  const auth = requireAuthContext(ctx.state);
  const [latest] = await listAssessments(auth, 1);
  if (!latest?.id) {
    return authorNotFoundResponse(ctx.state.i18n);
  }
  return new Response(null, { status: 302, headers: { location: `/assessments/${latest.id}` } });
}
