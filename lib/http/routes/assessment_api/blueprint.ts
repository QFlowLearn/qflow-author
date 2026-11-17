import { defineHttpRoute, type HttpRequest } from '../../route.ts';

import { saveAssessmentBlueprintResponse } from '../../assessment_blueprint_request.ts';
import { updateAssessmentBlueprint } from '../../../services/assessment_structure.ts';
import { requireAuthContext } from '../../../tenants.ts';

export const blueprintApiRoute = defineHttpRoute('/api/assessments/:id/blueprint', {
  'PUT': handle,
});

function handle(ctx: HttpRequest) {
  const auth = requireAuthContext(ctx.state);
  return saveAssessmentBlueprintResponse({
    request: ctx.req,
    operation: 'assessment-blueprint-update',
    resourceId: ctx.params.id,
    save: (blueprint) => updateAssessmentBlueprint(auth, ctx.params.id, blueprint),
  });
}
