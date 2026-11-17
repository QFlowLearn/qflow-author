import {
  type AssessmentBlueprint,
  AssessmentBlueprintParseError,
  AssessmentBlueprintUpdateError,
  parseAssessmentBlueprint,
} from '../assessment_blueprint.ts';
import { safeErrorSummary } from '../error_summary.ts';

type AssessmentBlueprintSaveRequest = {
  readonly request: Request;
  readonly operation: 'assessment-blueprint-update' | 'migration-blueprint-update';
  readonly resourceId: string;
  readonly save: (blueprint: AssessmentBlueprint) => Promise<AssessmentBlueprint>;
};

/** Parse, persist, and translate one assessment-blueprint HTTP update. */
export async function saveAssessmentBlueprintResponse(
  input: AssessmentBlueprintSaveRequest,
): Promise<Response> {
  let value: unknown;
  try {
    value = await input.request.json();
  } catch (_cause: unknown) {
    return Response.json({ error: 'Assessment blueprint must be valid JSON.' }, { status: 400 });
  }

  let blueprint: AssessmentBlueprint;
  try {
    blueprint = parseAssessmentBlueprint(value);
  } catch (cause: unknown) {
    if (cause instanceof AssessmentBlueprintParseError) {
      return Response.json({ error: cause.message }, { status: 422 });
    }
    console.error(JSON.stringify({
      event: 'assessment_blueprint_parse_failed',
      operation: input.operation,
      resourceId: input.resourceId,
      cause: safeErrorSummary(cause),
    }));
    return Response.json({ error: 'Could not parse the blueprint.' }, { status: 500 });
  }

  try {
    return Response.json({ blueprint: await input.save(blueprint) });
  } catch (cause: unknown) {
    if (cause instanceof AssessmentBlueprintUpdateError) {
      return Response.json(
        { error: cause.message },
        { status: cause.code === 'not_found' ? 404 : 409 },
      );
    }
    console.error(JSON.stringify({
      event: 'assessment_blueprint_save_failed',
      operation: input.operation,
      resourceId: input.resourceId,
      cause: safeErrorSummary(cause),
    }));
    return Response.json({ error: 'Could not save the blueprint.' }, { status: 500 });
  }
}
