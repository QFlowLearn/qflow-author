import { expect, test as testCase } from 'vitest';

import {
  parsePlacementRemovalCommand,
  parsePlacementRemovalOrder,
  parsePlacementRemovalReceipt,
} from '../lib/assessment_placement_removal.ts';
import { placementRemovalResponse } from '../lib/http/assessment_placement_removal.ts';

testCase('placement removal parses exact retry commands and durable receipts', () => {
  const id = crypto.randomUUID(), partId = crypto.randomUUID(), itemId = crypto.randomUUID();
  const command = { removalId: id, expectedRevision: 2 };
  expect(parsePlacementRemovalCommand(command)).toStrictEqual(command);
  for (
    const value of [
      null,
      {},
      { ...command, extra: true },
      { ...command, expectedRevision: 0 },
      { ...command, expectedRevision: 1.5 },
      { ...command, removalId: 'bad' },
    ]
  ) {
    expect(parsePlacementRemovalCommand(value)).toStrictEqual(null);
  }
  const receipt = {
    id,
    placementId: crypto.randomUUID(),
    partId,
    itemId,
    snapshotRev: null,
    blueprintTargetId: null,
    fixed: false,
    position: 2,
    title: 'Saved question 漢字',
    removedAt: '2026-10-06T12:00:00.000Z',
    expiresAt: '2026-10-06T12:05:00.000Z',
    restoredAt: null,
  };
  expect(parsePlacementRemovalReceipt(receipt)).toStrictEqual(receipt);
  for (
    const change of [
      { position: 0 },
      { snapshotRev: -1 },
      { snapshotRev: undefined },
      { blueprintTargetId: '' },
      { blueprintTargetId: ' invalid target ' },
      { fixed: 'true' },
      { fixed: undefined },
      { expiresAt: receipt.removedAt },
      { expiresAt: 'tomorrow' },
      { restoredAt: '2026-10-06T11:00:00.000Z' },
    ]
  ) expect(parsePlacementRemovalReceipt({ ...receipt, ...change })).toStrictEqual(null);
  const order = [{ id, position: 1 }, { id: partId, position: 3 }];
  expect(parsePlacementRemovalOrder(order)).toStrictEqual(order);
  expect(parsePlacementRemovalOrder([])).toStrictEqual([]);
  expect(parsePlacementRemovalOrder([order[0], order[0]])).toStrictEqual(null);
  expect(parsePlacementRemovalOrder([...order].reverse())).toStrictEqual(null);
  expect(parsePlacementRemovalOrder([{ id, position: 0 }])).toStrictEqual(null);
  expect(parsePlacementRemovalOrder([{ id, position: 1 }, { id: partId, position: 1 }]))
    .toStrictEqual(null);
});

testCase('placement recovery failures have explicit safe protocol outcomes', async () => {
  for (
    const [code, status] of [
      ['forbidden', 403],
      ['not_found', 404],
      ['conflict', 409],
      ['expired', 410],
      ['unavailable', 422],
      ['adaptive_managed', 409],
      ['storage_failed', 503],
    ] as const
  ) {
    const response = placementRemovalResponse({ ok: false, code });
    expect(response.status).toStrictEqual(status);
    expect(await response.json()).toStrictEqual({ ok: false, code });
    expect(response.headers.get('cache-control')).toStrictEqual('no-store');
  }
  const response = placementRemovalResponse({ ok: true, value: [] });
  if (!(response.ok)) expect.unreachable('Expected response.ok');
  expect(await response.json()).toStrictEqual({ ok: true, value: [] });
});
