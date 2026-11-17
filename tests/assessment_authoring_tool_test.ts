import { expect, test as testCase } from 'vitest';

import {
  ASSESSMENT_TOOL_IDS,
  assessmentToolHref,
  parseAssessmentToolQuery,
} from '../lib/assessment_authoring_tool.ts';

testCase('assessment authoring tool query selects one explicit secondary tool', () => {
  expect(parseAssessmentToolQuery(new URLSearchParams())).toStrictEqual({
    ok: true,
    tool: null,
  });
  expect(parseAssessmentToolQuery(new URLSearchParams('tool=assessment-export'))).toStrictEqual({
    ok: true,
    tool: ASSESSMENT_TOOL_IDS.export,
  });
  expect(parseAssessmentToolQuery(new URLSearchParams('tool=assessment-plan'))).toStrictEqual({
    ok: true,
    tool: ASSESSMENT_TOOL_IDS.plan,
  });
});

testCase('assessment authoring tool query rejects unknown and repeated options', () => {
  expect(parseAssessmentToolQuery(new URLSearchParams('tool=unknown'))).toStrictEqual({
    ok: false,
    message: 'QFlowLearn does not support the "unknown" assessment tool.',
  });
  expect(
    parseAssessmentToolQuery(new URLSearchParams('tool=assessment-export&tool=assessment-plan')),
  ).toStrictEqual({ ok: false, message: 'Choose only one assessment editor tool.' });
  expect(parseAssessmentToolQuery(new URLSearchParams('view=assessment-export'))).toStrictEqual({
    ok: false,
    message: 'The assessment editor contains an unsupported option.',
  });
});

testCase('assessment tool links carry one server-rendered selection', () => {
  expect(assessmentToolHref('assessment-1', null)).toStrictEqual('/assessments/assessment-1');
  expect(assessmentToolHref('assessment-1', ASSESSMENT_TOOL_IDS.export)).toStrictEqual(
    '/assessments/assessment-1?tool=assessment-export',
  );
  expect(assessmentToolHref('assessment/1', ASSESSMENT_TOOL_IDS.plan)).toStrictEqual(
    '/assessments/assessment%2F1?tool=assessment-plan',
  );
});
