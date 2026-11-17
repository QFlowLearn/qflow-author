import { expect, test as testCase } from 'vitest';

import { strToU8, zipSync } from 'fflate';
import { comparePublishedAssessmentPackage } from '../lib/export/assessment_publication_comparison.ts';
import { summarizeAdaptiveRoute } from '../lib/assessment_adaptive_route_summary.ts';
import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

function question(title: string, answer = 'A') {
  return exportQti3TestItemXml('single_select', {
    type: 'single_select',
    title,
    bodyHtml: '<p>Pick one.</p>',
    choices: [{ id: 'A', text: 'One' }, { id: 'B', text: 'Two' }],
    correctId: answer,
  }, { identifier: title });
}
testCase('publication review identifies question additions removals and answer edits', () => {
  const bytes = zipSync({
    'assessment.xml': strToU8('<assessment title="Old"/>'),
    'items/edited.xml': strToU8(question('Edited')),
    'items/removed.xml': strToU8(question('Removed')),
    'items/unchanged.xml': strToU8(question('Unchanged')),
  });
  const result = comparePublishedAssessmentPackage(bytes, {
    assessmentXml: '<assessment title="New"/>',
    itemsXml: {
      edited: question('Edited', 'B'),
      added: question('Added'),
      unchanged: question('Unchanged'),
    },
  });
  expect(result).toStrictEqual({
    status: 'changed',
    structureChanged: true,
    added: ['Added'],
    removed: ['Removed'],
    edited: ['Edited'],
  });
});
testCase('publication review does not invent evidence when assessment XML is absent', () => {
  expect(comparePublishedAssessmentPackage(zipSync({}), { assessmentXml: 'test', itemsXml: {} }))
    .toStrictEqual({ status: 'unavailable' });
});
testCase('route summary merges consecutive blocks but preserves returns to earlier levels', () => {
  expect(summarizeAdaptiveRoute(['Easy', 'Moderate', 'Hard', 'Hard', 'Moderate'])).toStrictEqual([
    { level: 'Easy', start: 1, end: 5 },
    { level: 'Moderate', start: 6, end: 10 },
    { level: 'Hard', start: 11, end: 20 },
    { level: 'Moderate', start: 21, end: 25 },
  ]);
  expect(summarizeAdaptiveRoute([])).toStrictEqual([]);
});
