import { expect, test as testCase } from 'vitest';

import { defaultsGapMatch, listGapIds, validateGapMatch } from '../lib/types/gap_match.ts';

testCase('gap_match draft defaults are valid and include gap markers', () => {
  const draft = defaultsGapMatch();
  const errs = validateGapMatch(draft);
  expect(errs).toStrictEqual([]);

  const markers = listGapIds(draft.bodyHtml ?? '');
  if (!(markers.length >= 1)) expect.unreachable('Expected markers.length >= 1');
  expect(markers.sort()).toStrictEqual((draft.gaps ?? []).map((g) => g.id).sort());
});

testCase('gap_match validation errors are human-readable', () => {
  const draft = defaultsGapMatch();
  const broken = {
    ...draft,
    title: '',
    gaps: [{ id: 'NOT VALID', label: '' }],
    gapChoices: [{ id: '', kind: 'text', text: '' }],
    correctGapPairs: [{ choiceId: 'X', gapId: 'Y' }],
    bodyHtml: '<p>Missing markers</p>',
  } as any;
  const errs = validateGapMatch(broken);
  if (!(errs.some((e) => e.toLowerCase().includes('title')))) {
    expect.unreachable("Expected errs.some((e) => e.toLowerCase().includes('title'))");
  }
  if (!(errs.some((e) => e.toLowerCase().includes('gap identifier')))) {
    expect.unreachable("Expected errs.some((e) => e.toLowerCase().includes('gap identifier'))");
  }
  if (!(errs.some((e) => e.toLowerCase().includes('insert at least one gap')))) {
    expect.unreachable(
      "Expected errs.some((e) => e.toLowerCase().includes('insert at least one gap'))",
    );
  }
  if (!(errs.some((e) => e.toLowerCase().includes('gap choice')))) {
    expect.unreachable("Expected errs.some((e) => e.toLowerCase().includes('gap choice'))");
  }
  if (!(errs.some((e) => e.toLowerCase().includes('correct pair')))) {
    expect.unreachable("Expected errs.some((e) => e.toLowerCase().includes('correct pair'))");
  }
});
