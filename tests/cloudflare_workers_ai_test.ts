import { expect, test as testCase } from 'vitest';

import {
  CLOUDFLARE_WORKERS_AI_DEFAULT_MODEL,
  type CloudflareWorkersAiBinding,
  CloudflareWorkersAiError,
  convertCloudflareFileToMarkdown,
  createCloudflareWorkersAiClient,
  mapCloudflareMarkdownResult,
  mapCloudflareWorkersAiResponse,
} from '../lib/ai/cloudflare_workers.ts';

testCase('createCloudflareWorkersAiClient defaults to Kimi 2.6 and maps chat output', async () => {
  const calls: Array<{ model: string; input: Record<string, unknown> }> = [];
  const binding: CloudflareWorkersAiBinding = {
    run(model, input) {
      calls.push({ model, input });
      return Promise.resolve({
        model,
        choices: [{ message: { content: '[{"type":"single_select","title":"Q1"}]' } }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      });
    },
  };

  const client = createCloudflareWorkersAiClient(binding, () => undefined);
  const parserInput = await client.runChatCompletion({
    mode: 'fast',
    messages: [{ role: 'user', content: 'Generate questions.' }],
    max_tokens: 128,
    temperature: 0.2,
  });

  expect(client.model).toStrictEqual(CLOUDFLARE_WORKERS_AI_DEFAULT_MODEL);
  expect(calls[0].model).toStrictEqual('@cf/moonshotai/kimi-k2.6');
  expect(calls[0].input.stream).toStrictEqual(false);
  expect(parserInput.source).toStrictEqual('cloudflare_workers_ai');
  expect(parserInput.model).toStrictEqual('@cf/moonshotai/kimi-k2.6');
  expect(parserInput.content).toStrictEqual('[{"type":"single_select","title":"Q1"}]');
  expect(parserInput.usage.totalTokens).toStrictEqual(30);
});

testCase('createCloudflareWorkersAiClient allows configured model override', () => {
  const binding: CloudflareWorkersAiBinding = {
    run() {
      return Promise.resolve({ response: '[]' });
    },
  };
  const client = createCloudflareWorkersAiClient(
    binding,
    (key) => key === 'QFLOW_CLOUDFLARE_AI_MODEL' ? '@cf/example/model' : undefined,
  );
  expect(client.model).toStrictEqual('@cf/example/model');
});

testCase('mapCloudflareWorkersAiResponse supports simple response payloads', () => {
  const parserInput = mapCloudflareWorkersAiResponse(
    {
      response: '[{"type":"text_entry","title":"Q2"}]',
      usage: { promptTokens: 5, completionTokens: 6, totalTokens: 11 },
    },
    'thorough',
    '@cf/moonshotai/kimi-k2.6',
  );

  expect(parserInput.source).toStrictEqual('cloudflare_workers_ai');
  expect(parserInput.mode).toStrictEqual('thorough');
  expect(parserInput.content).toStrictEqual('[{"type":"text_entry","title":"Q2"}]');
  expect(parserInput.usage.promptTokens).toStrictEqual(5);
});

testCase('mapCloudflareMarkdownResult maps conversion data and rejects errors', () => {
  expect(mapCloudflareMarkdownResult({
    name: 'source.pdf',
    format: 'markdown',
    data: '# Source\n\nContent',
  })).toStrictEqual('# Source\n\nContent');
  expect(() =>
    mapCloudflareMarkdownResult({
      name: 'source.pdf',
      format: 'error',
      error: 'Unsupported file',
    })
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof CloudflareWorkersAiError && caught.message.includes('Unsupported file')
    ),
  );
});

testCase('convertCloudflareFileToMarkdown uses Workers AI markdown conversion', async () => {
  const seen: unknown[] = [];
  const converter = Object.assign(
    (input: unknown) => {
      seen.push(input);
      return Promise.resolve({ format: 'markdown', data: 'Converted PDF text' });
    },
    {},
  ) as CloudflareWorkersAiBinding['toMarkdown'];
  const binding: CloudflareWorkersAiBinding = {
    run() {
      return Promise.resolve({ response: '[]' });
    },
    toMarkdown: converter,
  };

  const markdown = await convertCloudflareFileToMarkdown(binding, {
    name: 'source.pdf',
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'application/pdf' }),
  });

  expect(markdown).toStrictEqual('Converted PDF text');
  expect((seen[0] as { name: string }).name).toStrictEqual('source.pdf');
});

testCase('convertCloudflareFileToMarkdown reports missing conversion as config error', async () => {
  const binding: CloudflareWorkersAiBinding = {
    run() {
      return Promise.resolve({ response: '[]' });
    },
  };

  try {
    await convertCloudflareFileToMarkdown(binding, {
      name: 'source.pdf',
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'application/pdf' }),
    });
    throw new Error('Expected markdown conversion to fail.');
  } catch (err) {
    if (!(err instanceof CloudflareWorkersAiError)) throw err;
    expect(err.code).toStrictEqual('provider_config');
  }
});

testCase('mapCloudflareMarkdownResult classifies conversion failures', () => {
  try {
    mapCloudflareMarkdownResult({ format: 'error', error: 'bad pdf' });
    throw new Error('Expected markdown conversion result to fail.');
  } catch (err) {
    if (!(err instanceof CloudflareWorkersAiError)) throw err;
    expect(err.code).toStrictEqual('source_conversion');
  }
});
