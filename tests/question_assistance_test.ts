import { expect, test as testCase } from 'vitest';

import {
  classifyQuestionStructure,
  loadClefAuthoringConfig,
} from '../lib/ai/clef_authoring_provider.ts';
import { handleQuestionAuthoring } from '../lib/http/question_assistance.ts';
import { parseQuestionAssistanceInput } from '../lib/authoring/question_assistance.ts';
import type { ClefBinding } from '../lib/ai/clef_organization_provider.ts';

const config = { gatewayId: 'authoring-test', modelVersion: 'clef' };
const input = { explicitType: null, text: 'Name the planet we live on.', recent: [] };
const completed = (choice: string, confidence = 0.95) => ({
  model: config.modelVersion,
  answers: Object.fromEntries(
    Object.entries({
      structure: choice,
      count: 'unspecified',
      shuffle: 'unspecified',
      complete: 'no',
      part_0: 'stem',
    }).map(([key, choice]) => [key, { type: 'choice', choice, confidence }]),
  ),
});
testCase(
  'Clef authoring uses the real choice contract and accepts only bounded decisions',
  async () => {
    const binding: ClefBinding = {
      run(model, body, options) {
        expect(model).toStrictEqual('@cf/cloudflare/clef');
        expect(body.model).toStrictEqual('clef');
        expect(options.gateway.collectLog).toStrictEqual(false);
        expect(options.gateway.skipCache).toStrictEqual(true);
        if (!(body.questions)) expect.unreachable('Expected body.questions');
        return Promise.resolve(completed('text_entry'));
      },
    };
    expect(await classifyQuestionStructure(binding, config, input, new AbortController().signal))
      .toStrictEqual({
        ok: true,
        value: {
          composition: {
            type: 'text_entry',
            stem: input.text,
            choices: [],
            answers: [],
            choiceCount: 4,
            shuffle: null,
            complete: false,
          },
        },
      });
    for (
      const [choice, confidence, expected] of [
        ['text_entry', 0.2, { ok: true, value: { composition: null } }],
        ['uncertain', 1, { ok: true, value: { composition: null } }],
        ['essay', 1, { ok: true, value: { composition: null } }],
      ] as const
    ) {
      expect(
        await classifyQuestionStructure(
          { run: () => Promise.resolve(completed(choice, confidence)) },
          config,
          input,
          new AbortController().signal,
        ),
      ).toStrictEqual(expected);
    }
    expect(loadClefAuthoringConfig(() => undefined)).toStrictEqual(null);
  },
);
testCase('provider exceptions and cancellation never expose source text', async () => {
  const binding: ClefBinding = { run: () => Promise.reject(new Error('private question text')) };
  expect(await classifyQuestionStructure(binding, config, input, new AbortController().signal))
    .toStrictEqual({ ok: false, code: 'unavailable' });
  const abort = new AbortController();
  abort.abort();
  expect(await classifyQuestionStructure(binding, config, input, abort.signal)).toStrictEqual({
    ok: false,
    code: 'aborted',
  });
});

testCase(
  'authoring requires full Clef configuration and rejects model drift or wrapped responses',
  async () => {
    const environment: Record<string, string> = {
      QFLOW_AUTHORING_GATEWAY_ID: config.gatewayId,
      QFLOW_AUTHORING_MODEL_VERSION: 'clef',
    };
    expect(loadClefAuthoringConfig((key) => environment[key])).toStrictEqual(config);
    for (const modelVersion of ['unsupported-model', 'clef-flash']) {
      environment.QFLOW_AUTHORING_MODEL_VERSION = modelVersion;
      expect(loadClefAuthoringConfig((key) => environment[key])).toStrictEqual(null);
    }
    const response = completed('text_entry');
    for (
      const raw of [
        { ...response, model: 'clef-flash' },
        { state: 'Completed', result: response },
      ]
    ) {
      expect(
        await classifyQuestionStructure(
          { run: () => Promise.resolve(raw) },
          config,
          input,
          new AbortController().signal,
        ),
      ).toStrictEqual({ ok: false, code: 'invalid_response' });
    }
  },
);
testCase(
  'HTTP authorization, size, input validation and limits precede classification',
  async () => {
    let calls = 0;
    const classify = () => {
      calls++;
      return Promise.resolve({ ok: true as const, value: { type: 'text_entry' as const } });
    };
    const common = { parse: parseQuestionAssistanceInput, timeoutMs: 10000 };
    const request = (body: unknown) =>
      new Request('https://qflow.test/api/assessments/a/question-assistance', {
        ...{ duplex: 'half' },
        method: 'POST',
        body: JSON.stringify(body),
      });
    expect(
      (await handleQuestionAuthoring(request(input), {
        ...common,
        authorize: () => Promise.resolve(false),
        execute: classify,
      })).status,
    ).toStrictEqual(404);
    expect(
      (await handleQuestionAuthoring(request({ ...input, text: 'a'.repeat(53000) }), {
        ...common,
        authorize: () => Promise.resolve(true),
        execute: classify,
      })).status,
    ).toStrictEqual(413);
    expect(
      (await handleQuestionAuthoring(
        request({ ...input, recent: [{ type: 'text_entry', choiceCount: 4, key: 'answer' }] }),
        { ...common, authorize: () => Promise.resolve(true), execute: classify },
      )).status,
    ).toStrictEqual(400);
    expect(calls).toStrictEqual(0);
    const success = await handleQuestionAuthoring(request(input), {
      ...common,
      authorize: () => Promise.resolve(true),
      execute: classify,
    });
    expect(success.status).toStrictEqual(200);
    expect(success.headers.get('Cache-Control')).toStrictEqual('no-store');
    expect(await success.json()).toStrictEqual({ type: 'text_entry' });
    expect(calls).toStrictEqual(1);
    expect(
      (await handleQuestionAuthoring(request(input), {
        ...common,
        authorize: () => Promise.resolve(true),
        execute: () => Promise.resolve({ ok: false, code: 'limited' }),
      })).status,
    ).toStrictEqual(429);
  },
);

testCase(
  'Clef span decisions preserve supplied alternatives and explicit type wins low-confidence inference',
  async () => {
    const roles = {
      structure: 'single_select',
      count: '4',
      shuffle: 'on',
      complete: 'yes',
      part_0: 'command',
      part_1: 'stem',
      part_2: 'choice',
      part_3: 'choice',
      part_4: 'command',
      part_5: 'command',
    };
    const answers = Object.fromEntries(
      Object.entries(roles).map((
        [key, choice],
      ) => [key, { type: 'choice', choice, confidence: key === 'structure' ? 0.1 : 0.99 }]),
    );
    const binding: ClefBinding = {
      run: () => Promise.resolve({ model: config.modelVersion, answers }),
    };
    const text =
      'MC 4 options, Who was the second president, Thomas Jefferson, George Washington, you do the rest, randomize.';
    expect(
      await classifyQuestionStructure(binding, config, {
        text,
        recent: [],
        explicitType: 'multi_select',
      }, new AbortController().signal),
    ).toStrictEqual({
      ok: true,
      value: {
        composition: {
          type: 'multi_select',
          stem: 'Who was the second president',
          choices: ['Thomas Jefferson', 'George Washington'],
          answers: [],
          choiceCount: 4,
          shuffle: true,
          complete: true,
        },
      },
    });
    expect(
      await classifyQuestionStructure(
        binding,
        config,
        { text, recent: [], explicitType: null },
        new AbortController().signal,
      ),
    ).toStrictEqual({ ok: true, value: { composition: null } });
  },
);

testCase('Clef interpretation rejoins stem punctuation from original source slices', async () => {
  const text = 'MC 2 options, At noon, Mr. Smith asked “Who, exactly?”\nWhy?, Alice, Bob';
  const roles = {
    structure: 'single_select',
    count: '2',
    shuffle: 'unspecified',
    complete: 'no',
    part_0: 'command',
    part_1: 'stem',
    part_2: 'stem',
    part_3: 'stem',
    part_4: 'choice',
    part_5: 'choice',
  };
  const answers = Object.fromEntries(
    Object.entries(roles).map((
      [key, choice],
    ) => [key, { type: 'choice', choice, confidence: 0.99 }]),
  );
  const result = await classifyQuestionStructure(
    {
      run: () => Promise.resolve({ model: config.modelVersion, answers }),
    },
    config,
    { text, recent: [], explicitType: null },
    new AbortController().signal,
  );
  if (!(result.ok)) expect.unreachable('Expected result.ok');
  expect(result.value.composition?.stem).toStrictEqual(
    'At noon, Mr. Smith asked “Who, exactly?”\nWhy?',
  );
  expect(result.value.composition?.choices).toStrictEqual(['Alice', 'Bob']);
});
