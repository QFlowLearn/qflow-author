import {
  buildDeliverySsoLaunchRedirectUrl,
  DeliveryLaunchConfigurationError,
  fetchDeliveryAssignmentState,
} from '../../../delivery_launch.ts';
import { safeErrorSummary } from '../../../error_summary.ts';
import { readDeliverySummary } from '../../../delivery_metadata.ts';
import { getDeliveryLaunchUser } from '../../../services/account.ts';
import { getAssessment } from '../../../services/assessment_records.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { defineHttpRoute } from '../../route.ts';

export const launchDeliveryApiRoute = defineHttpRoute(
  '/api/assessments/:id/launch/delivery',
  {
    '*': async (ctx) => {
      if (ctx.req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

      const auth = requireAuthContext(ctx.state);
      const assignmentId = ctx.url.searchParams.get('assignmentId')?.trim();
      if (!assignmentId) {
        return json({ error: 'assignment_required', message: 'assignmentId is required.' }, 400);
      }

      const assessment = await getAssessment(auth, ctx.params.id);
      if (!assessment) return json({ error: 'not_found', message: 'Assessment not found.' }, 404);
      const delivery = readDeliverySummary(assessment.metadata);
      if (!delivery) {
        return json({
          error: 'delivery_not_published',
          message: 'Publish this assessment to QFlowLearn Delivery before launching it.',
        }, 409);
      }
      if (!delivery.assessmentId) {
        return json({
          error: 'delivery_publish_metadata_incomplete',
          message: 'Republish this assessment to QFlowLearn Delivery before launching it.',
        }, 409);
      }

      const user = await getDeliveryLaunchUser(auth.userId);
      if (!user) return json({ error: 'user_not_found', message: 'User not found.' }, 404);

      try {
        const assignmentState = await fetchDeliveryAssignmentState({
          assignmentId,
          qflowTenantId: auth.tenantId,
        });
        if (
          assignmentState.assignment.assignmentId !== assignmentId ||
          assignmentState.assignment.assessmentId !== delivery.assessmentId ||
          assignmentState.assignment.assessmentVersionId !== delivery.assessmentVersionId
        ) {
          return json({
            error: 'assignment_mismatch',
            message:
              'assignmentId does not match the published QFlowLearn Delivery assessment version.',
          }, 403);
        }
        const redirectUrl = await buildAuthenticatedUserDeliveryPreviewLaunch({
          qflowTenantId: auth.tenantId,
          assignmentId,
          user,
        });
        return new Response(null, {
          status: 302,
          headers: { location: redirectUrl },
        });
      } catch (cause: unknown) {
        if (cause instanceof DeliveryLaunchConfigurationError) {
          return json({ error: 'delivery_launch_not_configured', message: cause.message }, 503);
        }
        console.error(JSON.stringify({
          event: 'delivery_launch_failed',
          assessmentId: assessment.id,
          assignmentId,
          cause: safeErrorSummary(cause),
        }));
        return json({
          error: 'delivery_launch_failed',
          message: 'Delivery launch failed.',
        }, 502);
      }
    },
  },
);

function buildAuthenticatedUserDeliveryPreviewLaunch(input: {
  qflowTenantId: string;
  assignmentId: string;
  user: {
    id: string;
    email: string;
    displayName: string | null;
  };
}): Promise<string> {
  // This route is for authenticated QFlow preview/admin launch. Production
  // learner launch must pass learner identity from the learner-facing surface.
  return buildDeliverySsoLaunchRedirectUrl({
    qflowTenantId: input.qflowTenantId,
    assignmentId: input.assignmentId,
    learner: {
      subject: input.user.id,
      displayName: input.user.displayName?.trim() || input.user.email,
      email: input.user.email,
    },
  });
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
