import { expect } from 'vitest';

import { parseAdaptivePlan } from '../../lib/assessment_adaptive_plan.ts';
import { compileAdaptiveAssessment } from '../../lib/assessment_adaptive_export.ts';
import { writeQti3AssessmentTest } from '@longsightgroup/qti3-writer';
import type { Part, QuestionPlacement } from '../../lib/test_export.ts';
export function adaptiveExportFixture(questionCount = 100) {
  const blocks = [];
  for (let group = 0; group < questionCount / 5; group++) {
    for (let level = 0; level <= Math.min(group, 2); level++) {
      blocks.push({
        group,
        level,
        placementIds: Array.from({ length: 5 }, () => crypto.randomUUID()),
      });
    }
  }
  const plan = parseAdaptivePlan({
    revision: 1,
    buildId: crypto.randomUUID(),
    requestDigest: 'a'.repeat(64),
    partId: crypto.randomUUID(),
    settings: {
      selection: `scheme=${crypto.randomUUID()}`,
      versionId: crypto.randomUUID(),
      levelIds: ['one', 'two', 'three'],
      questionCount,
    },
    audience: 'Synthetic test audience',
    levels: [
      { id: 'one', label: 'Introductory' },
      { id: 'two', label: 'Intermediate' },
      { id: 'three', label: 'Advanced' },
    ],
    blocks,
  });
  if (!plan) expect.unreachable('Expected plan');
  const part: Omit<Part, 'placements'> & { placements: QuestionPlacement[] } = {
    id: plan.partId,
    title: 'Adaptive',
    placements: blocks.flatMap((block) =>
      block.placementIds.map((id) => ({ id, itemId: `question_${id}`, snapshotRev: 1 }))
    ),
  };
  const assessment = { id: crypto.randomUUID(), title: 'Adaptive fixture' };
  const definition = compileAdaptiveAssessment(assessment, [part], plan);
  const written = writeQti3AssessmentTest(definition);
  if (!(written.ok)) {
    expect.unreachable(written.ok ? undefined : JSON.stringify(written.diagnostics));
  }
  return { plan, part, assessment, definition, xml: written.value };
}
