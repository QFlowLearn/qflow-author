import { expect } from 'vitest';

import { parseQtiFixedTestOrdering, prepareQtiFixedTestOrder } from '@longsightgroup/qti3-core';

/** Verify the browser fixture's two free questions and protected third slot through shared QTI. */
export function assertProtectedQuestionShuffle(xml: string): void {
  const ordering = parseQtiFixedTestOrdering(xml);
  if (!(ordering.ok)) expect.unreachable('Expected ordering.ok');
  expect(ordering.value.sections.length).toStrictEqual(1);
  expect(ordering.value.sections[0].shuffle).toStrictEqual(true);
  expect(ordering.value.sections[0].items.map((item) => item.fixed)).toStrictEqual([
    false,
    false,
    true,
  ]);
  const generatedOrders = new Set<string>();
  for (let seed = 0; seed < 16; seed++) {
    const generated = prepareQtiFixedTestOrder(ordering.value, { kind: 'new', seed });
    if (!(generated.ok)) expect.unreachable('Expected generated.ok');
    expect(generated.value.sections[0].itemRefs[2]).toStrictEqual(
      ordering.value.sections[0].items[2].identifier,
    );
    const restored = prepareQtiFixedTestOrder(ordering.value, {
      kind: 'restore',
      state: generated.value,
    });
    if (!(restored.ok)) expect.unreachable('Expected restored.ok');
    expect(restored.value).toStrictEqual(generated.value);
    generatedOrders.add(generated.value.sections[0].itemRefs.join(','));
  }
  if (!(generatedOrders.size > 1)) expect.unreachable('Expected generatedOrders.size > 1');
}
