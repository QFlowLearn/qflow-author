import { defineHttpRoute, type HttpHandler } from '../../route.ts';
import { adaptiveAssessmentServices } from '../../assessment_adaptive.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { isCanonicalUuid } from '../../../uuid.ts';

/** Author-only simulation; never creates an attempt or accepts learner scores. */
const methods = {
  async GET(ctx) {
    const scenario = new URL(ctx.req.url).searchParams.get('scenario');
    if (
      !isCanonicalUuid(ctx.params.id) ||
      (scenario !== 'strong' && scenario !== 'struggling' && scenario !== 'mixed' &&
        scenario !== 'answer')
    ) {
      return Response.json({ error: 'invalid_input' }, { status: 400 });
    }
    const result = await adaptiveAssessmentServices(ctx).read.preview(
      requireAuthContext(ctx.state),
      ctx.params.id,
      scenario,
    );
    if (!result.ok) {
      const status = { forbidden: 403, not_found: 404, invalid_assessment: 422 };
      return Response.json({ error: result.code }, { status: status[result.code] });
    }
    return Response.json(result.value);
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const adaptivePreviewApiRoute = defineHttpRoute(
  '/api/assessments/:id/adaptive-preview',
  { ...methods, HEAD: methods.GET },
);
