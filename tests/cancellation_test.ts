import { expect, test as testCase } from 'vitest';
import { sleepWithSignal } from '../lib/cancellation.ts';

testCase('sleep resolves after its timer elapses', async () => {
  await expect(sleepWithSignal(0)).resolves.toBeUndefined();
});

testCase('sleep preserves an Error cancellation reason before and during its timer', async () => {
  const reason = new Error('Caller cancelled');
  const alreadyAborted = new AbortController();
  alreadyAborted.abort(reason);
  await expect(sleepWithSignal(60_000, { signal: alreadyAborted.signal })).rejects.toBe(reason);
  const controller = new AbortController();
  const sleeping = sleepWithSignal(60_000, { signal: controller.signal });
  controller.abort(reason);
  await expect(sleeping).rejects.toBe(reason);
});

testCase(
  'sleep rejects with an AbortError when the caller supplies a non-Error reason',
  async () => {
    const controller = new AbortController();
    const sleeping = sleepWithSignal(60_000, { signal: controller.signal });
    controller.abort('Caller cancelled');
    await expect(sleeping).rejects.toBeInstanceOf(DOMException);
    await expect(sleeping).rejects.toMatchObject({ name: 'AbortError' });
  },
);
