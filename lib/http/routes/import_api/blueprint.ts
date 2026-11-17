import { defineHttpRoute, type HttpRequest } from '../../route.ts';

import { saveAssessmentBlueprintResponse } from '../../assessment_blueprint_request.ts';
import { updateMigrationRunBlueprint } from '../../../import/migration_run_review.ts';
import { requireAuthContext } from '../../../tenants.ts';

export const blueprintImportRoute = defineHttpRoute('/api/imports/:id/blueprint', {
  'PUT': handle,
});

function handle(ctx: HttpRequest) {
  const auth = requireAuthContext(ctx.state);
  return saveAssessmentBlueprintResponse({
    request: ctx.req,
    operation: 'migration-blueprint-update',
    resourceId: ctx.params.id,
    save: (blueprint) => updateMigrationRunBlueprint(auth, ctx.params.id, blueprint),
  });
}
