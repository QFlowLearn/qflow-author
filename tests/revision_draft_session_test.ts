import { expect, test as testCase } from 'vitest';

import { createRevisionDraftSessionQueue } from '../lib/client/revision_draft_session.ts';

testCase('revision draft publish waits for queued autosaves in order', async () => {
  const events: string[] = [];
  let releaseFirstSave: (() => void) | undefined;
  const firstSave = new Promise<void>((resolve) => {
    releaseFirstSave = resolve;
  });
  let saveNumber = 0;
  const queue = createRevisionDraftSessionQueue(async () => {
    saveNumber += 1;
    events.push(`save-${saveNumber}-started`);
    if (saveNumber === 1) await firstSave;
    events.push(`save-${saveNumber}-finished`);
  }, (message) => events.push(`error:${message}`));

  queue.enqueueAutosave();
  queue.enqueueAutosave();
  const publishBarrier = queue.beginPublish().then(() => events.push('publish-ready'));
  await Promise.resolve();
  await Promise.resolve();
  expect(events).toStrictEqual(['save-1-started']);

  releaseFirstSave?.();
  await publishBarrier;
  expect(events).toStrictEqual([
    'save-1-started',
    'save-1-finished',
    'save-2-started',
    'save-2-finished',
    'publish-ready',
  ]);
});

testCase('failed revision publish queues the latest editor state again', async () => {
  const savedVersions: number[] = [];
  let currentVersion = 1;
  let finalSaveResolved: (() => void) | undefined;
  const finalSave = new Promise<void>((resolve) => {
    finalSaveResolved = resolve;
  });
  const queue = createRevisionDraftSessionQueue(() => {
    savedVersions.push(currentVersion);
    if (currentVersion === 2) finalSaveResolved?.();
    return Promise.resolve();
  }, () => undefined);

  queue.enqueueAutosave();
  await queue.beginPublish();
  currentVersion = 2;
  queue.finishPublish(false);
  await finalSave;

  expect(savedVersions).toStrictEqual([1, 2]);
});
