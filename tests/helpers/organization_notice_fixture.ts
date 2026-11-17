import { db } from '../../lib/db.ts';
import { processOrganizationStep } from '../../lib/services/question_organization_processor.ts';
import { organizationNow } from './organization_workspace.ts';

/** Complete the real source-based organization flow; this fixture must never call an AI service. */
export async function finishOrganizationNotice(
  params: { jobId: string; workflowExecutionId: string },
) {
  for (let step = 0; step < 20; step++) {
    const result = await processOrganizationStep(params, {
      database: db,
      now: organizationNow,
      newId: () => crypto.randomUUID(),
      provider: () => {
        throw new Error('Notice source fixture must not call AI');
      },
    });
    if (!result.ok) throw new Error('Notice fixture step failed.');
    if (result.value.state === 'completed') return;
  }
  throw new Error('Notice fixture did not complete.');
}
