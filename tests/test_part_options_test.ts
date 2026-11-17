import { test as testCase } from 'vitest';
import { buildAssessmentTestXml, type Part } from '../lib/test_export.ts';

testCase('test part options: navigation/submission/time/instructions/feedback', () => {
  const a = { id: 'T1', title: 'Sample Test' };
  const parts: Part[] = [{
    id: 'P1',
    title: 'Part 1',
    placements: [{ id: 'pl1', itemId: 'item-1' }],
    options: {
      navigationMode: 'linear',
      submissionMode: 'simultaneous',
      timeLimits: { minTime: 30, maxTime: 300 },
      instructionsHtml: '<b>Read carefully</b>',
      feedback: [{
        id: 'FB1',
        access: 'atEnd',
        showHide: 'show',
        outcomeIdentifier: 'TEST_FEEDBACK',
        html: 'Well done',
      }],
    },
  }];
  const xml = buildAssessmentTestXml(a, parts);
  if (!xml.includes('navigation-mode="linear"')) throw new Error('missing navigation-mode');
  if (!xml.includes('submission-mode="simultaneous"')) throw new Error('missing submission-mode');
  if (!xml.includes('<qti-time-limits min-time="30" max-time="300"')) {
    throw new Error('missing time-limits');
  }
  if (!xml.includes('<qti-rubric-block')) throw new Error('missing rubric-block');
  if (!xml.includes('<qti-test-feedback')) throw new Error('missing test-feedback');
  if (!xml.includes('<qti-assessment-item-ref')) throw new Error('missing item-ref');
});
