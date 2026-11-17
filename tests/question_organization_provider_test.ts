import { expect, test as testCase } from 'vitest';

import {
  clefTeachingExamplesFit,
  createClefOrganizationProvider,
  loadClefOrganizationConfig,
  parseClefOrganizationConfig,
  parseClefTopicDecision,
} from '../lib/ai/clef_organization_provider.ts';
import { enrichmentDefinitionFixture } from './bank_enrichment_fixture.ts';
import { prepareEnrichmentQuestion } from '../lib/services/bank_enrichment_input.ts';

const config = {
  promptVersion: 'question-organization-v1' as const,
  gatewayId: 'organization-test',
  modelVersion: 'clef',
  inputMicrosPerMillion: 240000,
  budgetMicros: 1000000,
};
export function clefResponse() {
  return {
    model: 'clef',
    answers: {
      topic: {
        type: 'choice',
        choice: 'cells',
        confidence: 0.9,
        probabilities: { cells: 0.9, energy: 0.05, __no_match__: 0.05 },
      },
    },
    usage: { input_tokens: 700, output_tokens: 20 },
  };
}
testCase(
  'Clef adapter sends a bounded topic decision through the configured gateway and preserves its distribution',
  async () => {
    const source = prepareEnrichmentQuestion(crypto.randomUUID(), crypto.randomUUID(), {
      type: 'single_select',
      title: 'Cells',
      bodyHtml: '<p>Where is DNA?</p>',
      choices: [{ id: 'a', text: 'Nucleus' }, { id: 'b', text: 'Membrane' }],
      correctId: 'a',
    });
    if (!(source.ok)) expect.unreachable('Expected source.ok');
    const requests: unknown[] = [];
    const provider = createClefOrganizationProvider({
      run(model, input, options) {
        requests.push({ model, input, options });
        expect(model).toStrictEqual('@cf/cloudflare/clef');
        expect(input.model).toStrictEqual('clef');
        expect(options.gateway).toStrictEqual({
          id: 'organization-test',
          skipCache: true,
          collectLog: false,
        });
        expect(Object.keys(input.questions as object)).toStrictEqual([source.value.questionId]);
        return Promise.resolve({
          ...clefResponse(),
          answers: Object.fromEntries(
            Object.keys(input.questions as object).map((id) => [id, clefResponse().answers.topic]),
          ),
        });
      },
    }, config);
    const result = await provider(
      [source.value],
      enrichmentDefinitionFixture(),
      [],
      { signal: new AbortController().signal },
    );
    if (!(result.ok)) expect.unreachable('Expected result.ok');
    expect(result.value[0].receipt.topicId).toStrictEqual('cells');
    expect(result.value[0].receipt.model).toStrictEqual('clef');
    expect(result.value[0].chargedMicros).toStrictEqual(168);
    expect(result.value[0].receipt.probabilities).toStrictEqual({
      cells: 0.9,
      energy: 0.05,
      __no_match__: 0.05,
    });
    expect(requests.length).toStrictEqual(1);
    const cancelled = AbortSignal.abort();
    expect(await provider([source.value], enrichmentDefinitionFixture(), [], { signal: cancelled }))
      .toStrictEqual({
        ok: false,
        code: 'aborted',
      });
    expect(requests.length).toStrictEqual(1);
  },
);
testCase(
  'Clef boundary rejects model drift, incomplete distributions and malformed configuration',
  () => {
    expect(parseClefOrganizationConfig({ ...config, gatewayId: '' })).toStrictEqual(null);
    expect(loadClefOrganizationConfig(() => undefined)).toStrictEqual(null);
    expect(parseClefTopicDecision(
      { ...clefResponse(), model: 'different' },
      ['cells', 'energy'],
      config.modelVersion,
    )).toStrictEqual(null);
    const invalid = clefResponse();
    invalid.answers.topic.probabilities.energy = 0.5;
    expect(parseClefTopicDecision(invalid, ['cells', 'energy'], config.modelVersion)).toStrictEqual(
      null,
    );
    expect(
      parseClefTopicDecision(clefResponse(), ['cells', 'energy', 'missing'], config.modelVersion),
    ).toStrictEqual(null);
  },
);

testCase(
  'automatic example budget leaves room for a near-limit question in the actual Clef request',
  async () => {
    const content = (length: number) =>
      prepareEnrichmentQuestion(
        crypto.randomUUID(),
        crypto.randomUUID(),
        {
          type: 'single_select',
          title: 'Cells',
          promptHtml: `<p>${'é'.repeat(length)}</p>`,
          choices: [{ id: 'a', text: 'Nucleus' }, { id: 'b', text: 'Membrane' }],
          correctId: 'a',
        },
      );
    const question = content(7900), example = content(1500);
    if (!(question.ok && example.ok)) expect.unreachable('Expected question.ok && example.ok');
    if (!(new TextEncoder().encode(JSON.stringify(question.value)).length > 16_000)) {
      expect.unreachable(
        'Expected new TextEncoder().encode(JSON.stringify(question.value)).length > 16_000',
      );
    }
    const definition = enrichmentDefinitionFixture();
    const examples = Array.from(
      { length: 20 },
      () => ({ question: example.value, topicId: 'cells' }),
    );
    if (clefTeachingExamplesFit(definition, examples)) {
      expect.unreachable('Expected !clefTeachingExamplesFit(definition, examples)');
    }
    while (!clefTeachingExamplesFit(definition, examples)) examples.pop();
    if (!(examples.length > 0 && examples.length < 20)) {
      expect.unreachable('Expected examples.length > 0 && examples.length < 20');
    }
    let calls = 0;
    const provider = createClefOrganizationProvider({
      run(_model, input) {
        calls++;
        if (!(new TextEncoder().encode(JSON.stringify(input)).length + 4096 <= 32_000)) {
          expect.unreachable(
            'Expected new TextEncoder().encode(JSON.stringify(input)).length + 4096 <= 32_000',
          );
        }
        return Promise.resolve({
          ...clefResponse(),
          answers: Object.fromEntries(
            Object.keys(input.questions as object).map((id) => [id, clefResponse().answers.topic]),
          ),
        });
      },
    }, config);
    const result = await provider([question.value], definition, examples, {
      signal: AbortSignal.timeout(1000),
    });
    if (!(result.ok)) expect.unreachable('Expected result.ok');
    expect(calls).toStrictEqual(1);
  },
);

testCase(
  'Clef adapter rejects incomplete and wrapped responses even when they contain an answer',
  async () => {
    const question = prepareEnrichmentQuestion(crypto.randomUUID(), crypto.randomUUID(), {
      type: 'single_select',
      title: 'Cells',
      promptHtml: '<p>Where is DNA?</p>',
      choices: [{ id: 'a', text: 'Nucleus' }, { id: 'b', text: 'Membrane' }],
      correctId: 'a',
    });
    if (!(question.ok)) expect.unreachable('Expected question.ok');
    for (
      const raw of [{
        state: 'Completed',
        result: clefResponse(),
      }, {
        state: 'Running',
        result: clefResponse(),
      }, {
        state: 'Completed',
      }]
    ) {
      const provider = createClefOrganizationProvider({ run: () => Promise.resolve(raw) }, config);
      expect(
        await provider([question.value], enrichmentDefinitionFixture(), [], {
          signal: AbortSignal.timeout(1000),
        }),
      ).toStrictEqual({ ok: false, code: 'invalid_response' });
    }
  },
);

testCase('only full Clef can be configured for organization inference', async () => {
  const environment: Record<string, string> = {
    QFLOW_ORGANIZATION_GATEWAY_ID: config.gatewayId,
    QFLOW_ORGANIZATION_MODEL_VERSION: 'clef',
    QFLOW_ORGANIZATION_INPUT_MICROS_PER_MILLION: '240000',
    QFLOW_ORGANIZATION_RUN_BUDGET_MICROS: String(config.budgetMicros),
  };
  expect(loadClefOrganizationConfig((key) => environment[key])).toStrictEqual(config);
  for (const modelVersion of ['unsupported-model', 'clef-flash']) {
    environment.QFLOW_ORGANIZATION_MODEL_VERSION = modelVersion;
    expect(loadClefOrganizationConfig((key) => environment[key])).toStrictEqual(null);
    expect(parseClefOrganizationConfig({ ...config, modelVersion })).toStrictEqual(null);
    let calls = 0;
    const provider = createClefOrganizationProvider(
      {
        run() {
          calls++;
          return Promise.resolve(null);
        },
      },
      { ...config, modelVersion },
    );
    expect(
      await provider([], enrichmentDefinitionFixture(), [], {
        signal: new AbortController().signal,
      }),
    ).toStrictEqual({ ok: false, code: 'provider_failed' });
    expect(calls).toStrictEqual(0);
  }
});
