import { expect, test as testCase } from 'vitest';

import { adaptiveExportFixture } from './helpers/adaptive_export_fixture.ts';
import { previewAdaptiveAssessment } from '../lib/assessment_adaptive_preview.ts';
testCase(
  'shared-engine previews finish exactly 100 unique questions with expected difficulty counts',
  () => {
    const { xml } = adaptiveExportFixture();
    for (const scenario of ['strong', 'struggling', 'mixed'] as const) {
      const result = previewAdaptiveAssessment(xml, scenario);
      expect(result.answered).toStrictEqual(100);
      expect(new Set(result.route.map((step) => step.itemRef)).size).toStrictEqual(100);
      if (scenario === 'strong') {
        expect(
          [0, 1, 2].map((level) =>
            result.route.filter((step) => step.level === `QFLOW_LEVEL_${level}`).length
          ),
        ).toStrictEqual([5, 5, 90]);
      }
      if (scenario === 'struggling') {
        expect(result.route.filter((step) => step.level === 'QFLOW_LEVEL_0').length).toStrictEqual(
          100,
        );
      }
    }
  },
);
