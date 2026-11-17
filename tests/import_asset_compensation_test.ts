import { expect, test as testCase } from 'vitest';

import { parseItemLanguage } from '../lib/types/item_language.ts';

const IMPORTED_LANGUAGE = parseItemLanguage('fr-CA');

import {
  cleanupStagedImportAssets,
  ImportAssetCleanupRequiredError,
  type StagedImportAssets,
  stageImportAssets,
  throwAfterImportAssetCleanup,
} from '../lib/import/commit_import_result.ts';
import type { ImportResult } from '../lib/import/types.ts';
import type { ObjectWriteLifecycle } from '../lib/storage_contract.ts';

const CONTEXT = {
  tenantId: 'tenant-import-compensation',
  userId: 'user-import-compensation',
  role: 'owner' as const,
};

testCase('stageImportAssets removes earlier objects when later staging fails', async () => {
  const writes: string[] = [];
  const deletes: string[] = [];
  const storage: ObjectWriteLifecycle = {
    putObject(input) {
      writes.push(input.key);
      if (writes.length === 2) throw new Error('Simulated second object write failure.');
      return Promise.resolve();
    },
    deleteObject(key) {
      deletes.push(key);
      return Promise.resolve();
    },
  };

  await expect(
    Promise.resolve().then(() =>
      stageImportAssets(CONTEXT, importResultWithTwoAssets(), {
        idempotencyKey: '11111111-1111-4111-8111-111111111111',
        attemptId: '22222222-2222-4222-8222-222222222222',
        storage,
      })
    ),
  ).rejects.toSatisfy((caught: unknown) =>
    caught instanceof Error && caught.message.includes('Simulated second object write failure.')
  );

  expect(writes.length).toStrictEqual(2);
  expect(deletes).toStrictEqual([writes[0]]);
});

testCase('concurrent import attempts stage assets under disjoint object keys', async () => {
  const writes: string[] = [];
  const deletes: string[] = [];
  const storage: ObjectWriteLifecycle = {
    putObject(input) {
      writes.push(input.key);
      return Promise.resolve();
    },
    deleteObject(key) {
      deletes.push(key);
      return Promise.resolve();
    },
  };
  const parsed = importResultWithTwoAssets();
  const first = await stageImportAssets(CONTEXT, parsed, {
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
    attemptId: '22222222-2222-4222-8222-222222222222',
    storage,
  });
  const second = await stageImportAssets(CONTEXT, parsed, {
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
    attemptId: '33333333-3333-4333-8333-333333333333',
    storage,
  });

  expect(writes.length).toStrictEqual(4);
  expect(first.get('assets/a.png')?.path).not.toStrictEqual(second.get('assets/a.png')?.path);
  expect(first.get('assets/b.png')?.path).not.toStrictEqual(second.get('assets/b.png')?.path);
  await cleanupStagedImportAssets(
    { idempotencyKey: '11111111-1111-4111-8111-111111111111', storage },
    second,
  );
  expect(deletes.sort()).toStrictEqual([...second.values()].map((upload) => upload.path).sort());
  expect(deletes.some((key) => [...first.values()].some((upload) => upload.path === key)))
    .toStrictEqual(false);
});

testCase(
  'import compensation removes every staged object and preserves the operation failure',
  async () => {
    const deletes: string[] = [];
    const storage: ObjectWriteLifecycle = {
      putObject() {
        return Promise.resolve();
      },
      deleteObject(key) {
        deletes.push(key);
        return Promise.resolve();
      },
    };
    const cause = new Error('Simulated import commit failure.');

    try {
      await throwAfterImportAssetCleanup(
        { idempotencyKey: 'import-cleanup-success', storage },
        stagedAssets('uploads/tenant-import-compensation/asset-a'),
        cause,
      );
      throw new Error('Expected import compensation to rethrow the operation failure.');
    } catch (caught: unknown) {
      expect(caught).toBe(cause);
    }

    expect(deletes).toStrictEqual(['uploads/tenant-import-compensation/asset-a']);
  },
);

testCase('import compensation reports every object that still requires cleanup', async () => {
  const deletes: string[] = [];
  const storage: ObjectWriteLifecycle = {
    putObject() {
      return Promise.resolve();
    },
    deleteObject(key) {
      deletes.push(key);
      return key.endsWith('asset-a')
        ? Promise.reject(new Error('Simulated cleanup failure.'))
        : Promise.resolve();
    },
  };
  const cause = new Error('Simulated import commit failure.');
  const staged = new Map(stagedAssets('uploads/tenant-import-compensation/asset-a'));
  const firstAsset = staged.get('assets/a.png');
  if (!firstAsset) throw new Error('Expected the first staged asset fixture.');
  staged.set('assets/b.png', {
    ...firstAsset,
    id: 'asset-b',
    path: 'uploads/tenant-import-compensation/asset-b',
    url: '/uploads/asset-b',
  });

  const failure = await (async () => {
    const caught: unknown = await Promise.resolve().then(() =>
      throwAfterImportAssetCleanup(
        { idempotencyKey: 'import-cleanup-failure', storage },
        staged,
        cause,
      )
    ).then(() => expect.unreachable('Expected a rejection.'), (cause: unknown) => cause);
    if (!(caught instanceof ImportAssetCleanupRequiredError)) {
      expect.unreachable('Expected ImportAssetCleanupRequiredError');
    }
    return caught;
  })();

  expect(deletes.sort()).toStrictEqual([
    'uploads/tenant-import-compensation/asset-a',
    'uploads/tenant-import-compensation/asset-b',
  ]);
  expect(failure.cause).toBe(cause);
  expect(failure.idempotencyKey).toStrictEqual('import-cleanup-failure');
  expect(failure.objectKeys).toStrictEqual([
    'uploads/tenant-import-compensation/asset-a',
    'uploads/tenant-import-compensation/asset-b',
  ]);
  expect(failure.cleanupFailures.length).toStrictEqual(1);
  expect(failure.cleanupFailures[0]?.objectKey).toStrictEqual(deletes[0]);
  if (!(failure.cleanupFailures[0]?.cause instanceof Error)) {
    expect.unreachable('Expected failure.cleanupFailures[0]?.cause instanceof Error');
  }
});

function stagedAssets(objectKey: string): StagedImportAssets {
  return new Map([[
    'assets/a.png',
    {
      id: 'asset-a',
      name: 'a.png',
      type: 'image/png',
      size: 1,
      path: objectKey,
      url: '/uploads/asset-a',
      createdAt: '2026-08-15T00:00:00.000Z',
      sourceSha256: 'a'.repeat(64),
    },
  ]]);
}

function importResultWithTwoAssets(): ImportResult {
  return {
    title: 'Asset import',
    organizationGroups: [],
    parts: [{
      id: 'part-1',
      title: 'Part 1',
      placements: [{ href: 'items/question.xml' }],
    }],
    items: [{
      href: 'items/question.xml',
      identifier: 'question-1',
      title: 'Question',
      xml:
        '<qti-assessment-item><img src="../assets/a.png"><img src="../assets/b.png"></qti-assessment-item>',
      draft: {
        type: 'single_select',
        itemLanguage: IMPORTED_LANGUAGE,
        title: 'Question',
        bodyHtml: '<p>Question</p>',
        choices: [{ id: 'A', text: 'A' }, { id: 'B', text: 'B' }],
        correctId: 'A',
      },
    }],
    assets: [
      { path: 'assets/a.png', name: 'a.png', data: new Uint8Array([1]), mime: 'image/png' },
      { path: 'assets/b.png', name: 'b.png', data: new Uint8Array([2]), mime: 'image/png' },
    ],
  };
}
