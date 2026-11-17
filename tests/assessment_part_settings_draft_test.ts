import { expect, test as testCase } from 'vitest';

import {
  createPartSettingsDraft,
  parsePartSettingsDraft,
} from '../lib/assessment_part_settings_draft.ts';
import type { PartOptions } from '../lib/test_export.ts';

testCase(
  'part settings drafts preserve omissions, explicit zero and all feedback identities',
  () => {
    for (
      const options of [{}, { timeLimits: {} }, { timeLimits: { minTime: 0 } }, {
        navigationMode: 'linear',
        submissionMode: 'simultaneous',
        timeLimits: { minTime: 30, maxTime: 300 },
        instructionsHtml: '<p>Keep instructions</p>',
        feedback: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            access: 'atEnd',
            showHide: 'show',
            outcomeIdentifier: 'SCORE',
            html: '<p>First</p>',
          },
          {
            id: '22222222-2222-4222-8222-222222222222',
            access: 'during',
            showHide: 'hide',
            outcomeIdentifier: 'SECOND',
            html: '<p>Second</p>',
          },
        ],
      }] satisfies PartOptions[]
    ) {
      const draft = createPartSettingsDraft(options);
      const parsed = parsePartSettingsDraft(draft);
      if (!(parsed.ok)) expect.unreachable('Expected parsed.ok');
      expect(parsed.options).toStrictEqual(options);
      if (draft.feedback) {
        draft.feedback[0].html = 'Edited';
        expect(options.feedback?.[0].html).toStrictEqual('<p>First</p>');
      }
    }
  },
);

testCase('part settings drafts reject invalid raw seconds without changing the source', () => {
  for (
    const minTime of ['-', '-1', '1.5', '1e2', 'abc', 'Infinity', '31536001', '9007199254740992']
  ) {
    const draft = { timeLimits: { minTime, maxTime: '300' } };
    expect(parsePartSettingsDraft(draft)).toStrictEqual({ ok: false, issue: 'timeNumber' });
    expect(draft.timeLimits.minTime).toStrictEqual(minTime);
  }
  expect(parsePartSettingsDraft({ timeLimits: { minTime: '301', maxTime: '300' } })).toStrictEqual({
    ok: false,
    issue: 'timeRange',
  });
  expect(parsePartSettingsDraft({ timeLimits: { minTime: '', maxTime: '31536000' } }))
    .toStrictEqual({
      ok: true,
      options: { timeLimits: { maxTime: 31536000 } },
    });
});
