import { expect, test as testCase } from 'vitest';

import { QuestionCompletionSession } from '../islands/item_editor/question_completion_session.ts';
import type {
  QuestionCompletion,
  QuestionComposition,
} from '../lib/authoring/question_composition.ts';
const question: QuestionComposition = {
  type: 'single_select',
  stem: 'Which planet?',
  choices: ['Mars'],
  answers: [],
  choiceCount: 2,
  shuffle: true,
  complete: true,
};
const suggestion: QuestionCompletion = { additionalChoices: ['Earth'], answers: ['Earth'] };
testCase('an in-progress completion is reused for presentation changes, then cached', async () => {
  const pending = Promise.withResolvers<QuestionCompletion | null>();
  let calls = 0;
  const session = new QuestionCompletionSession(() => {
    calls++;
    return pending.promise;
  });
  const first = session.complete(question);
  const second = session.complete({ ...question, shuffle: false });
  expect(calls).toStrictEqual(1);
  pending.resolve(suggestion);
  expect(await first).toStrictEqual(suggestion);
  expect(await second).toStrictEqual(suggestion);
  expect(await session.complete(question)).toStrictEqual(suggestion);
  expect(calls).toStrictEqual(1);
  session.cancel();
});
testCase('a different question or editor disposal cancels obsolete generation', async () => {
  const requests: Array<
    { signal: AbortSignal; resolve: (value: QuestionCompletion | null) => void }
  > = [];
  const session = new QuestionCompletionSession((_question, { signal }) => {
    const pending = Promise.withResolvers<QuestionCompletion | null>();
    requests.push({ signal, resolve: pending.resolve });
    return pending.promise;
  });
  const first = session.complete(question);
  const second = session.complete({ ...question, stem: 'Another planet?' });
  if (!(requests[0].signal.aborted)) expect.unreachable('Expected requests[0].signal.aborted');
  expect(requests[1].signal.aborted).toStrictEqual(false);
  // Even an adapter that settles after cancellation cannot replace the current cache.
  requests[0].resolve(suggestion);
  expect(await first).toStrictEqual(null);
  expect(session.complete({ ...question, stem: 'Another planet?' })).toStrictEqual(second);
  session.cancel();
  if (!(requests[1].signal.aborted)) expect.unreachable('Expected requests[1].signal.aborted');
  requests[1].resolve(null);
  await second;
});
testCase('failed completions are released for an explicit retry', async () => {
  let calls = 0;
  const session = new QuestionCompletionSession(() =>
    ++calls === 1 ? Promise.reject(new Error('unavailable')) : Promise.resolve(suggestion)
  );
  expect(await session.complete(question)).toStrictEqual(null);
  expect(await session.complete(question)).toStrictEqual(suggestion);
  expect(calls).toStrictEqual(2);
  session.cancel();
});
