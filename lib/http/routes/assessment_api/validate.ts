import { defineHttpRoute } from '../../route.ts';
import { buildAssessmentPackage } from '../../../export/assessment_package.ts';
import {
  assessmentExportRequirementsFromSelection,
  parseAssessmentExportPreflightId,
  parseAssessmentExportRequirementSelection,
  unexpectedAssessmentExportResponse,
} from '../../../export/assessment_export_http.ts';
import { exportActorIdFromAuthenticatedUser } from '../../../export/assessment_export_requirements.ts';
import { getAssessment } from '../../../services/assessment_records.ts';
import { resolveStorage } from '../../../storage.ts';
import { requireAuthContext } from '../../../tenants.ts';

export const validateApiRoute = defineHttpRoute('/api/assessments/:id/validate', {
  '*': async (ctx) => {
    const auth = requireAuthContext(ctx.state);
    const assessment = await getAssessment(auth, ctx.params.id);
    if (!assessment) {
      return Response.json({ error: 'not_found', message: 'Not Found' }, { status: 404 });
    }
    const parsedSelection = parseAssessmentExportRequirementSelection(ctx.url.searchParams);
    if (!parsedSelection.ok) {
      return Response.json(parsedSelection.body, { status: 400 });
    }
    const requestedPreflightId = ctx.url.searchParams.get('preflightId');
    const parsedPreflightId = requestedPreflightId === null
      ? null
      : parseAssessmentExportPreflightId(requestedPreflightId);
    if (parsedPreflightId && !parsedPreflightId.ok) {
      return Response.json(parsedPreflightId.body, { status: 400 });
    }

    let result: Awaited<ReturnType<typeof buildAssessmentPackage>>;
    try {
      result = await buildAssessmentPackage({
        assessment,
        auth,
        readUploadBytes: (upload) => resolveStorage(ctx).readObject(upload.path),
        targetId: ctx.url.searchParams.get('target'),
        requirements: assessmentExportRequirementsFromSelection(
          parsedSelection.selection,
          exportActorIdFromAuthenticatedUser(auth.userId),
        ),
      });
    } catch (cause: unknown) {
      return unexpectedAssessmentExportResponse(cause, {
        assessmentId: ctx.params.id,
        operation: 'validate',
      });
    }
    if (!result.ok) {
      if (result.preflight) {
        return Response.json({
          ok: true,
          preflight: result.preflight,
        });
      }
      return Response.json(result.body, { status: result.status });
    }
    if (
      parsedPreflightId?.ok &&
      result.preflight.preflightId !== parsedPreflightId.preflightId
    ) {
      return Response.json(
        {
          error: 'PreflightStale',
          message: 'The assessment or export requirements changed after preflight.',
          preflightId: parsedPreflightId.preflightId,
        },
        { status: 409 },
      );
    }
    return Response.json({
      ok: true,
      preflight: result.preflight,
    });
  },
});
