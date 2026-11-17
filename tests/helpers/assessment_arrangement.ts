import { expect } from 'vitest';

import {
  type AssessmentArrangeRequest,
  parseAssessmentArrangeRequest,
} from '../../lib/assessment_arrangement.ts';
import { assessmentArrangementVersion } from '../../lib/assessment_arrangement_version.ts';
import { saveAssessmentParts } from '../../lib/services/assessment_arrangement_save.ts';
import { getAssessment } from '../../lib/services/assessment_records.ts';
import type { AssessmentPartInput } from '../../lib/services/assessment_structure.ts';
import type { RequestContext } from '../../lib/tenants.ts';

/** Build a fixture command from an explicitly observed saved base. */
export async function assessmentArrangementCommandFixture(
  ctx: RequestContext,
  id: string,
  parts: AssessmentPartInput[],
): Promise<AssessmentArrangeRequest> {
  const saved = await getAssessment(ctx, id);
  if (!saved) expect.unreachable('Expected saved');
  // Serialize the actual wire projection before parsing optional selectors.
  const wire = parseAssessmentArrangeRequest(JSON.parse(JSON.stringify({
    expectedVersion: await assessmentArrangementVersion(id, saved.parts),
    parts: parts.map((part) => ({
      ...part,
      placements: part.placements?.map((placement) =>
        'content' in placement ? placement : ({
          ...placement,
          snapshotRev: placement.snapshotRev ?? undefined,
          blueprintTargetId: placement.blueprintTargetId ?? undefined,
        })
      ),
    })),
  })));
  if (!(wire.ok)) expect.unreachable(wire.ok ? '' : wire.error.message);
  return wire.request;
}

/** Persist arrangement test setup through the same versioned production service. */
export async function saveAssessmentArrangementFixture(
  ctx: RequestContext,
  id: string,
  parts: AssessmentPartInput[],
): Promise<void> {
  const result = await saveAssessmentParts(
    ctx,
    id,
    await assessmentArrangementCommandFixture(ctx, id, parts),
  );
  if (!(result.ok)) expect.unreachable(result.ok ? '' : result.error.code);
}
