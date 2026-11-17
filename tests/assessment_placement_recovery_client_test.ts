import { expect, test as testCase } from 'vitest';

import { parseRestoredAssessmentPlacement } from '../lib/client/assessment_placement_recovery.ts';

function restoredFixture() {
  const receipt = {
    id: crypto.randomUUID(),
    placementId: crypto.randomUUID(),
    partId: crypto.randomUUID(),
    itemId: crypto.randomUUID(),
    snapshotRev: 1,
    blueprintTargetId: null,
    fixed: true,
    position: 2,
    title: 'Question',
    removedAt: '2026-10-06T12:00:00.000Z',
    expiresAt: '2026-10-06T12:05:00.000Z',
    restoredAt: '2026-10-06T12:01:00.000Z',
  };
  return {
    receipt,
    beforePlacementId: crypto.randomUUID(),
    revision: 1,
    placement: {
      id: receipt.placementId,
      partId: receipt.partId,
      itemId: receipt.itemId,
      snapshotRev: 1,
      blueprintTargetId: null,
      fixed: true,
      position: 2,
    },
    draft: {
      type: 'single_select',
      itemLanguage: 'en-US',
      title: 'Question',
      bodyHtml: '<p>Which city?</p>',
      choices: [{ id: 'A', text: 'Paris' }, { id: 'B', text: 'Berlin' }],
      correctId: 'A',
    },
  };
}

testCase(
  'recovery response parsing rejects contradictory identities, anchors, revision policies and malformed drafts',
  () => {
    const value = restoredFixture();
    if (!(parseRestoredAssessmentPlacement(value))) {
      expect.unreachable('Expected parseRestoredAssessmentPlacement(value)');
    }
    for (
      const change of [
        { receipt: { ...value.receipt, restoredAt: null } },
        { placement: { ...value.placement, id: crypto.randomUUID() } },
        { placement: { ...value.placement, itemId: crypto.randomUUID() } },
        { placement: { ...value.placement, position: 0 } },
        { placement: { ...value.placement, snapshotRev: 2 } },
        { placement: { ...value.placement, fixed: false } },
        { placement: { ...value.placement, fixed: 'true' } },
        { beforePlacementId: value.receipt.placementId },
        { beforePlacementId: 'bad' },
        { revision: 1.5 },
        { draft: { ...value.draft, correctId: 'missing' } },
      ]
    ) expect(parseRestoredAssessmentPlacement({ ...value, ...change })).toStrictEqual(null);
    if (
      !(parseRestoredAssessmentPlacement({
        ...value,
        revision: 2,
        beforePlacementId: null,
        placement: { ...value.placement, snapshotRev: null },
      }))
    ) {
      expect.unreachable(
        'Expected parseRestoredAssessmentPlacement({ ...value, revision: 2, beforePlacementId: null, placeme',
      );
    }
  },
);
