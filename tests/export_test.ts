import { test as testCase } from 'vitest';
import { buildAssessmentTestXml, type Part } from '../lib/test_export.ts';

// lightweight test for export components reused in routes
testCase('test export produces assessment test skeleton', () => {
  const title = 'Example';
  const a = { id: 'abc', title };
  const parts: Part[] = [
    {
      id: 'p1',
      title: 'Part 1',
      placements: [{ id: 'x', itemId: 'it1' }],
      options: { navigationMode: 'nonlinear', submissionMode: 'individual' },
    },
  ];
  const testXml = buildAssessmentTestXml(a, parts);
  if (!testXml.includes('<qti-assessment-test')) throw new Error('missing root');
});
