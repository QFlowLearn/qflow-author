import { expect, test as testCase } from 'vitest';

import {
  buildOpenRouterHeaders,
  createOpenRouterClient,
  loadOpenRouterConfig,
  OPENROUTER_DEFAULT_APP_NAME,
  OPENROUTER_DEFAULT_BASE_URL,
  OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_DEFAULT_SITE_URL,
  OPENROUTER_REQUIRED_ENV_KEYS,
  OpenRouterConfigError,
  type OpenRouterEnvReader,
} from '../lib/ai/openrouter.ts';

function envReader(env: Record<string, string>): OpenRouterEnvReader {
  return (key) => env[key];
}

function validEnv(): Record<string, string> {
  return {
    OPENROUTER_API_KEY: 'or-test-key',
    OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1/',
    OPENROUTER_MODEL_FAST: 'openrouter/model-fast',
    OPENROUTER_MODEL_THOROUGH: 'openrouter/model-thorough',
    OPENROUTER_SITE_URL: 'https://qflowlearn.test',
    OPENROUTER_APP_NAME: 'QFlowLearn',
  };
}

testCase('loadOpenRouterConfig validates required env keys and maps models by mode', () => {
  const config = loadOpenRouterConfig(envReader(validEnv()));

  expect(config.apiKey).toStrictEqual('or-test-key');
  expect(config.baseUrl).toStrictEqual('https://openrouter.ai/api/v1');
  expect(config.siteUrl).toStrictEqual('https://qflowlearn.test/');
  expect(config.appName).toStrictEqual('QFlowLearn');
  expect(config.models.fast).toStrictEqual('openrouter/model-fast');
  expect(config.models.thorough).toStrictEqual('openrouter/model-thorough');
});

testCase('loadOpenRouterConfig applies free-model defaults for optional env keys', () => {
  const config = loadOpenRouterConfig(envReader({
    OPENROUTER_API_KEY: 'or-test-key',
  }));

  expect(config.apiKey).toStrictEqual('or-test-key');
  expect(config.baseUrl).toStrictEqual(OPENROUTER_DEFAULT_BASE_URL);
  expect(config.siteUrl).toStrictEqual(`${OPENROUTER_DEFAULT_SITE_URL}/`);
  expect(config.appName).toStrictEqual(OPENROUTER_DEFAULT_APP_NAME);
  expect(config.models.fast).toStrictEqual(OPENROUTER_DEFAULT_MODEL);
  expect(config.models.thorough).toStrictEqual(OPENROUTER_DEFAULT_MODEL);
});

testCase('loadOpenRouterConfig returns a clear error when required env vars are missing', () => {
  const err = (() => {
    try {
      (() => loadOpenRouterConfig(() => undefined))();
    } catch (caught: unknown) {
      if (!(caught instanceof OpenRouterConfigError)) {
        expect.unreachable('Expected OpenRouterConfigError');
      }
      return caught;
    }
    return expect.unreachable('Expected an exception.');
  })();

  for (const key of OPENROUTER_REQUIRED_ENV_KEYS) {
    expect(err.message.includes(key)).toStrictEqual(true);
  }
  expect(err.message.startsWith('Missing required OpenRouter env var(s):')).toStrictEqual(true);
});

testCase('buildOpenRouterHeaders includes authenticated OpenRouter headers', () => {
  const config = loadOpenRouterConfig(envReader(validEnv()));
  const headers = buildOpenRouterHeaders(config);

  expect(headers.get('authorization')).toStrictEqual('Bearer or-test-key');
  expect(headers.get('http-referer')).toStrictEqual('https://qflowlearn.test/');
  expect(headers.get('x-title')).toStrictEqual('QFlowLearn');
  expect(headers.get('content-type')).toStrictEqual('application/json');
});

testCase('createOpenRouterClient.postChatCompletions maps mode to configured model', async () => {
  const config = loadOpenRouterConfig(envReader(validEnv()));
  let calledUrl = '';
  let calledInit: RequestInit | undefined;

  const fetchImpl: typeof fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    calledUrl = String(input);
    calledInit = init;
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };

  const client = createOpenRouterClient(config, fetchImpl);
  await client.postChatCompletions({
    mode: 'fast',
    messages: [{ role: 'user', content: 'Generate 3 questions' }],
  });

  expect(calledUrl).toStrictEqual('https://openrouter.ai/api/v1/chat/completions');
  expect(calledInit?.method).toStrictEqual('POST');
  expect(calledInit?.body).toStrictEqual(JSON.stringify({
    model: config.models.fast,
    messages: [{ role: 'user', content: 'Generate 3 questions' }],
    max_tokens: undefined,
    temperature: undefined,
    stream: undefined,
    reasoning: undefined,
    include_reasoning: undefined,
    plugins: undefined,
  }));

  const headers = new Headers(calledInit?.headers);
  expect(headers.get('authorization')).toStrictEqual('Bearer or-test-key');
  expect(headers.get('http-referer')).toStrictEqual('https://qflowlearn.test/');
  expect(headers.get('x-title')).toStrictEqual('QFlowLearn');
  expect(headers.get('content-type')).toStrictEqual('application/json');
});

testCase(
  'createOpenRouterClient.postChatCompletions passes PDF file content and plugins',
  async () => {
    const config = loadOpenRouterConfig(envReader(validEnv()));
    let calledInit: RequestInit | undefined;

    const fetchImpl: typeof fetch = (_input: RequestInfo | URL, init?: RequestInit) => {
      calledInit = init;
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    };

    const client = createOpenRouterClient(config, fetchImpl);
    await client.postChatCompletions({
      mode: 'fast',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Generate from the attached file.' },
          {
            type: 'file',
            file: {
              filename: 'reading.pdf',
              file_data: 'data:application/pdf;base64,JVBERi0xLjc=',
            },
          },
        ],
      }],
      plugins: [{ id: 'file-parser', pdf: { engine: 'cloudflare-ai' } }],
    });

    expect(calledInit?.body).toStrictEqual(JSON.stringify({
      model: config.models.fast,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Generate from the attached file.' },
          {
            type: 'file',
            file: {
              filename: 'reading.pdf',
              file_data: 'data:application/pdf;base64,JVBERi0xLjc=',
            },
          },
        ],
      }],
      max_tokens: undefined,
      temperature: undefined,
      stream: undefined,
      reasoning: undefined,
      include_reasoning: undefined,
      plugins: [{ id: 'file-parser', pdf: { engine: 'cloudflare-ai' } }],
    }));
  },
);
