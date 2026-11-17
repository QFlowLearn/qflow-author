import { expect, test as testCase } from 'vitest';

import { moveAssessmentCanvasPlacement } from '../lib/assessment_canvas_move.ts';
import { parseAssessmentArrangeRequest } from '../lib/assessment_arrangement.ts';

testCase(
  'ordinary canvas moves preserve frozen placement identities, selectors, settings and other parts',
  () => {
    const parts = [{
      id: 'part',
      title: 'Part',
      options: { instructionsHtml: '<p>Read.</p>' },
      placements: ['a', 'b', 'c'].map((id, index) => ({
        id,
        itemId: `question-${id}`,
        snapshotRev: index + 1,
        blueprintTargetId: 'math',
      })),
    }, { id: 'other', title: 'Other', placements: [{ id: 'd', itemId: 'question-d' }] }];
    Object.freeze(parts[0].placements);
    for (const position of [0, 2]) {
      const result = moveAssessmentCanvasPlacement(parts, {
        partId: 'part',
        placementId: 'b',
        position,
      });
      if (!(result.ok)) expect.unreachable('Expected result.ok');
      expect(result.parts[0].placements.map((entry) => entry.id)).toStrictEqual(
        position === 0 ? ['b', 'a', 'c'] : ['a', 'c', 'b'],
      );
      expect(result.parts[0].placements.find((entry) => entry.id === 'b')).toStrictEqual(
        parts[0].placements[1],
      );
      expect(result.parts[0].options).toStrictEqual(parts[0].options);
      expect(result.parts[1]).toStrictEqual(parts[1]);
    }
    expect(parts[0].placements.map((entry) => entry.id)).toStrictEqual(['a', 'b', 'c']);
    for (const position of [-1, 3, 0.5, NaN]) {
      expect(moveAssessmentCanvasPlacement(parts, { partId: 'part', placementId: 'b', position }))
        .toStrictEqual({ ok: false, reason: 'position' });
    }
    expect(moveAssessmentCanvasPlacement(parts, { partId: 'other', placementId: 'b', position: 0 }))
      .toStrictEqual({ ok: false, reason: 'missing' });
    expect(moveAssessmentCanvasPlacement([{ ...parts[0], options: { navigationMode: 'linear' } }], {
      partId: 'part',
      placementId: 'b',
      position: 0,
    })).toStrictEqual({ ok: false, reason: 'constrained' });
  },
);

testCase(
  'canvas movement intent is strictly parsed with the existing complete arrangement command',
  () => {
    const partId = '10000000-0000-4000-8000-000000000001';
    const placementId = '10000000-0000-4000-8000-000000000002';
    const base = {
      expectedVersion: 'a'.repeat(64),
      parts: [{ id: partId, title: 'Part', placements: [] }],
    };
    const move = { partId, placementId, position: 0 };
    const result = parseAssessmentArrangeRequest({ ...base, canvasMove: move });
    if (!(result.ok)) expect.unreachable('Expected result.ok');
    expect(result.request.canvasMove).toStrictEqual(move);
    for (
      const canvasMove of [
        null,
        {},
        { ...move, partId: 'bad' },
        { ...move, placementId: 'bad' },
        { ...move, position: -1 },
        { ...move, position: 500 },
        { ...move, position: 0.5 },
        { ...move, unexpected: true },
      ]
    ) {
      expect(parseAssessmentArrangeRequest({ ...base, canvasMove }).ok).toStrictEqual(false);
    }
  },
);
