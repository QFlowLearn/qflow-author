import { expect, test as testCase } from 'vitest';

import {
  createDriverViewLoader,
  DRIVER_VIEW_IMPORTS,
  type DriverViewImports,
  DriverViewsUnavailable,
  loadDriverViews,
} from '../islands/item_editor/useDriverViews.ts';
import { driverViewsFor } from '../islands/drivers/view_registry.ts';
import { QUESTION_TYPE_IDS, type QuestionTypeId } from '../lib/types/registry.ts';

testCase('driver view loader registers every exact question type', async () => {
  await Promise.all(QUESTION_TYPE_IDS.map(loadDriverViews));

  for (const typeId of QUESTION_TYPE_IDS) {
    const views = driverViewsFor(typeId);
    expect(typeof views?.ui, `${typeId} UI`).toStrictEqual('function');
    expect(typeof views?.rightRail, `${typeId} right rail`).toStrictEqual('function');
  }
});

testCase('driver view loader shares the same request for concurrent callers', async () => {
  const first = loadDriverViews('single_select');
  const second = loadDriverViews('single_select');

  expect(first).toBe(second);
  await first;
});

testCase('driver view loader removes failed requests so the same type can retry', async () => {
  let attempts = 0;
  const registered = new Set<QuestionTypeId>();
  const imports: DriverViewImports = {
    ...DRIVER_VIEW_IMPORTS,
    single_select: () => {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new Error('Simulated module failure.'));
      registered.add('single_select');
      return Promise.resolve({});
    },
  };
  const load = createDriverViewLoader(imports, (typeId) => registered.has(typeId));

  const failure = await (async () => {
    const caught: unknown = await Promise.resolve().then(() => load('single_select')).then(
      () => expect.unreachable('Expected a rejection.'),
      (cause: unknown) => cause,
    );
    if (!(caught instanceof DriverViewsUnavailable)) {
      expect.unreachable('Expected DriverViewsUnavailable');
    }
    return caught;
  })();
  if (!((failure.cause) instanceof Error)) {
    expect.unreachable('Expected failure.cause to have the expected instance type');
  }
  await load('single_select');

  expect(attempts).toStrictEqual(2);
});

testCase('driver view loader rejects modules that do not register their UI', async () => {
  const imports: DriverViewImports = {
    ...DRIVER_VIEW_IMPORTS,
    single_select: () => Promise.resolve({}),
  };
  const load = createDriverViewLoader(imports, () => false);

  await expect(Promise.resolve().then(() => load('single_select'))).rejects.toBeInstanceOf(
    DriverViewsUnavailable,
  );
});
