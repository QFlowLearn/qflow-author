import { expect, test as testCase } from 'vitest';

import { createCanvasPublishOperationGate } from '../lib/client/canvas_publish_operation_gate.ts';

testCase(
  'Canvas publish operation gate rejects overlap without aborting the active command',
  () => {
    const gate = createCanvasPublishOperationGate();
    const first = gate.begin();
    if (!first) expect.unreachable('Expected first');
    expect(gate.isActive()).toStrictEqual(true);

    expect(gate.begin()).toStrictEqual(null);
    expect(first.signal.aborted).toStrictEqual(false);

    first.finish();
    expect(gate.isActive()).toStrictEqual(false);
    const next = gate.begin();
    if (!next) expect.unreachable('Expected next');
    expect(next.signal.aborted).toStrictEqual(false);
  },
);

testCase('Canvas publish operation gate cancels owned work during lifecycle cleanup', () => {
  const gate = createCanvasPublishOperationGate();
  const active = gate.begin();
  if (!active) expect.unreachable('Expected active');

  gate.cancel();
  expect(active.signal.aborted).toStrictEqual(true);
  expect(gate.isActive()).toStrictEqual(false);
  if (!(gate.begin())) expect.unreachable('Expected gate.begin()');
});
