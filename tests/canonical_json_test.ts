import { expect, test as testCase } from 'vitest';

import { canonicalJsonStringify, projectJsonPersistenceObject } from '../lib/canonical_json.ts';

testCase('canonical JSON identity is independent of object key order', () => {
  const beforePersistence = {
    type: 'single_select',
    title: 'Plate motion',
    choices: [{ text: 'Tectonic plates', id: 'A' }],
    settings: { required: true, shuffle: false },
  };
  const afterJsonbPersistence = {
    settings: { shuffle: false, required: true },
    choices: [{ id: 'A', text: 'Tectonic plates' }],
    title: 'Plate motion',
    type: 'single_select',
  };

  expect(canonicalJsonStringify(beforePersistence)).toStrictEqual(
    canonicalJsonStringify(afterJsonbPersistence),
  );
});

testCase('canonical JSON uses ordinal key order', () => {
  expect(canonicalJsonStringify({
    'ä': 4,
    'z': 3,
    'a': 2,
    'Z': 1,
    '😀': 5,
    '\uE000': 6,
  })).toStrictEqual('{"Z":1,"a":2,"z":3,"ä":4,"😀":5,"":6}');
});

testCase('canonical JSON rejects values without one JSON identity', () => {
  const sparse = Array<string>(1);
  for (
    const value of [
      undefined,
      { missing: undefined },
      Number.NaN,
      Number.POSITIVE_INFINITY,
      new Date('2026-01-01T00:00:00.000Z'),
      1n,
      sparse,
    ]
  ) {
    expect(() => canonicalJsonStringify(value)).toThrowError(Error);
  }
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  expect(() => canonicalJsonStringify(cyclic)).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('cannot represent cyclic values')
    ),
  );
});

testCase('JSON persistence deliberately omits optional properties without repairing arrays', () => {
  expect(projectJsonPersistenceObject({
    retained: true,
    optional: undefined,
    nested: { retained: 'yes', optional: undefined },
  })).toStrictEqual({
    retained: true,
    nested: { retained: 'yes' },
  });
  expect(() => projectJsonPersistenceObject({ entries: [undefined] })).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error &&
      caught.message.includes('cannot represent undefined at $.entries[0]')
    ),
  );
});
