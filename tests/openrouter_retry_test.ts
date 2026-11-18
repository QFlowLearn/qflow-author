import { expect, test as testCase } from 'vitest';

import {
  computeRetryDelayMs,
  createOpenRouterClient,
  isRetryableOpenRouterStatus,
  loadOpenRouterConfig,
  type OpenRouterChatCompletionsRequest,
  OpenRouterRequestError,
  postChatCompletionsWithRetry,
} from '../lib/ai/openrouter.ts';

function makeClient(
  responses: Array<Response | Error>,
  callLog: Array<OpenRouterChatCompletionsRequest>,
) {
  let idx = 0;
  const config = loadOpenRouterConfig((key) =>
    ({
      OPENROUTER_API_KEY: 'or-test',
      OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
      OPENROUTER_MODEL_FAST: 'openrouter/fast',
      OPENROUTER_MODEL_THOROUGH: 'openrouter/thorough',
      OPENROUTER_SITE_URL: 'https://qflow.test',
      OPENROUTER_APP_NAME: 'QFlowLearn',
    })[key]
  );

  return createOpenRouterClient(config, (_input, init) => {
    const bodyText = init && 'body' in init ? String(init.body ?? '{}') : '{}';
    const body = JSON.parse(bodyText) as Record<string, unknown>;
    callLog.push({
      mode: body.model === config.models.fast ? 'fast' : 'thorough',
      messages: (body.messages ?? []) as OpenRouterChatCompletionsRequest['messages'],
      max_tokens: body.max_tokens as number | undefined,
      temperature: body.temperature as number | undefined,
      stream: body.stream as boolean | undefined,
    });

    const next = responses[Math.min(idx, responses.length - 1)];
    idx += 1;
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  });
}

testCase('postChatCompletionsWithRetry retries 429 and succeeds', async () => {
  const calls: OpenRouterChatCompletionsRequest[] = [];
  const failures: unknown[] = [];
  const client = makeClient(
    [
      new Response('rate limited', { status: 429 }),
      new Response(
        JSON.stringify({
          model: 'openrouter/fast',
          choices: [{ message: { content: '[]' } }],
        }),
        { status: 200 },
      ),
    ],
    calls,
  );

  const payload = await postChatCompletionsWithRetry(
    client,
    {
      mode: 'fast',
      messages: [{ role: 'user', content: 'Generate.' }],
    },
    {
      retryPolicy: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1 },
      sleep: () => Promise.resolve(),
      onAttemptFailure: (failure) => failures.push(failure),
    },
  );

  expect(calls.length).toStrictEqual(2);
  expect(failures.length).toStrictEqual(1);
  expect((payload as { model: string }).model).toStrictEqual('openrouter/fast');
});

testCase('postChatCompletionsWithRetry fails fast on non-retryable status', async () => {
  const calls: OpenRouterChatCompletionsRequest[] = [];
  const client = makeClient([new Response('bad request', { status: 400 })], calls);

  const err = await (async () => {
    const caught: unknown = await Promise.resolve().then(() =>
      postChatCompletionsWithRetry(
        client,
        { mode: 'fast', messages: [{ role: 'user', content: 'Generate.' }] },
        {
          retryPolicy: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1 },
          sleep: () => Promise.resolve(),
        },
      )
    ).then(() => expect.unreachable('Expected a rejection.'), (cause: unknown) => cause);
    if (!(caught instanceof OpenRouterRequestError)) {
      expect.unreachable('Expected OpenRouterRequestError');
    }
    return caught;
  })();

  expect(calls.length).toStrictEqual(1);
  expect(err.failure.retryable).toStrictEqual(false);
  expect(err.failure.status).toStrictEqual(400);
  expect(err.failure.failureClass).toStrictEqual('http');
});

testCase('postChatCompletionsWithRetry retries thrown network errors', async () => {
  const calls: OpenRouterChatCompletionsRequest[] = [];
  const failures: unknown[] = [];
  const client = makeClient(
    [
      new Error('connect timeout'),
      new Error('connect timeout'),
      new Response(
        JSON.stringify({
          model: 'openrouter/thorough',
          choices: [{ message: { content: '[]' } }],
        }),
        { status: 200 },
      ),
    ],
    calls,
  );

  const payload = await postChatCompletionsWithRetry(
    client,
    {
      mode: 'thorough',
      messages: [{ role: 'user', content: 'Generate.' }],
    },
    {
      retryPolicy: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1 },
      sleep: () => Promise.resolve(),
      onAttemptFailure: (failure) => failures.push(failure),
    },
  );

  expect(calls.length).toStrictEqual(3);
  expect(failures.length).toStrictEqual(2);
  expect((payload as { model: string }).model).toStrictEqual('openrouter/thorough');
});

testCase('retry helpers mark only 429/5xx as retryable', () => {
  expect(isRetryableOpenRouterStatus(400)).toStrictEqual(false);
  expect(isRetryableOpenRouterStatus(429)).toStrictEqual(true);
  expect(isRetryableOpenRouterStatus(503)).toStrictEqual(true);
  expect(computeRetryDelayMs(1, { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000 }))
    .toStrictEqual(100);
  expect(computeRetryDelayMs(2, { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000 }))
    .toStrictEqual(200);
});

testCase('OpenRouter retries propagate caller cancellation to the active request', async () => {
  const config = loadOpenRouterConfig((key) =>
    ({
      OPENROUTER_API_KEY: 'or-test',
      OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
      OPENROUTER_SITE_URL: 'https://qflow.test',
      OPENROUTER_APP_NAME: 'QFlowLearn',
    })[key]
  );
  let receivedSignal: AbortSignal | null = null;
  const client = createOpenRouterClient(config, (_input, init) => {
    receivedSignal = init?.signal ?? null;
    return new Promise<Response>((_resolve, reject) => {
      const stop = () =>
        reject(
          receivedSignal?.reason instanceof Error
            ? receivedSignal?.reason
            : new DOMException('OpenRouter request aborted.', 'AbortError'),
        );
      if (receivedSignal?.aborted) {
        stop();
        return;
      }
      receivedSignal?.addEventListener('abort', stop, { once: true });
    });
  });
  const controller = new AbortController();
  const request = postChatCompletionsWithRetry(
    client,
    { mode: 'fast', messages: [{ role: 'user', content: 'Generate.' }] },
    { signal: controller.signal },
  );

  controller.abort(new DOMException('Test cancellation.', 'AbortError'));
  await expect(Promise.resolve().then(() => request)).rejects.toSatisfy((caught: unknown) =>
    caught instanceof DOMException && caught.message.includes('Test cancellation.')
  );
  expect(receivedSignal).toStrictEqual(controller.signal);
});
