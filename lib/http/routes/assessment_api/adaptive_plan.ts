import { adaptiveAssessmentServices } from '../../assessment_adaptive.ts';
import { defineHttpRoute, type HttpHandler } from '../../route.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { isCanonicalUuid } from '../../../uuid.ts';
import {
  adaptivePlanDocument,
  parseAdaptivePlanCommand,
} from '../../../assessment_adaptive_plan.ts';

const methods = {
  async GET(ctx) {
    const schemeId = new URL(ctx.req.url).searchParams.get('scheme');
    if (!isCanonicalUuid(schemeId) || !isCanonicalUuid(ctx.params.id)) {
      return Response.json({ error: 'invalid_input' }, { status: 400 });
    }
    const versions = await adaptiveAssessmentServices(ctx).read.categoryOptions(
      requireAuthContext(ctx.state),
      ctx.params.id,
      schemeId,
    );
    return versions
      ? Response.json({ versions })
      : Response.json({ error: 'not_found' }, { status: 404 });
  },
  async POST(ctx) {
    const command = parseAdaptivePlanCommand(await ctx.req.json().catch(() => null));
    if (!command || !isCanonicalUuid(ctx.params.id)) {
      return Response.json({ error: 'invalid_input' }, { status: 400 });
    }
    const result = await adaptiveAssessmentServices(ctx).plans.run(
      requireAuthContext(ctx.state),
      ctx.params.id,
      command,
    );
    if (!result.ok) {
      const status = {
        invalid_input: 400,
        forbidden: 403,
        not_found: 404,
        not_empty: 409,
        not_draft: 409,
        conflict: 409,
        storage_failed: 503,
      };
      return Response.json({ error: result.code }, { status: status[result.code] });
    }
    return Response.json(
      result.value.kind === 'built'
        ? { kind: 'built', plan: adaptivePlanDocument(result.value.plan) }
        : result.value,
    );
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const adaptivePlanApiRoute = defineHttpRoute(
  '/api/assessments/:id/adaptive-plan',
  { ...methods, HEAD: methods.GET },
);
