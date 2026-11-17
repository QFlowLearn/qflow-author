import { expect, test as testCase } from 'vitest';

import {
  enrichmentCostMicros,
  loadEnrichmentAIConfig,
  parseEnrichmentAIConfig,
} from '../lib/ai/bank_enrichment_config.ts';
import {
  createEnrichmentAIProvider,
  enrichmentRequestInputBound,
  parseEnrichmentAIReceipt,
} from '../lib/ai/bank_enrichment_provider.ts';
import {
  classificationRequest,
  parseClassificationOutput,
  parseProposalOutput,
  proposalRequest,
} from '../lib/services/bank_enrichment_classifier.ts';
import { prepareEnrichmentQuestion } from '../lib/services/bank_enrichment_input.ts';
import { enrichmentDefinitionFixture } from './bank_enrichment_fixture.ts';
import type { EnrichmentClassification } from '../lib/services/bank_enrichment_contract.ts';
import { parseStoredEnrichmentSample } from '../lib/services/bank_enrichment_preview_codec.ts';

const definition = enrichmentDefinitionFixture();
const questionId = 'a555ee34-f123-4123-8fed-098765432100';
const revisionId = 'b555ee34-f123-4123-8fed-098765432100';
const body = {
  type: 'single_select',
  title: 'Cells',
  promptHtml: '<p>Which structure contains DNA?</p>',
  choices: [{ id: 'a', text: 'Nucleus' }, { id: 'b', html: '<p>Membrane</p>' }],
  correctId: 'a',
};
const prepared = prepareEnrichmentQuestion(questionId, revisionId, body);
if (!prepared.ok) throw new Error('Invalid classifier fixture.');
const questions = [prepared.value];
const assignment: EnrichmentClassification = {
  subject: { state: 'assigned', valueIds: ['life'] },
  topic: { state: 'assigned', valueIds: ['cells'] },
  difficulty: { state: 'assigned', valueIds: ['easy'] },
};
const item = {
  questionId,
  revisionId,
  classification: assignment,
  rationale: 'Recall of a cell structure.',
};

testCase(
  'instructor examples include canonical content and reject missing or mismatched revisions',
  () => {
    const withExample = {
      ...definition,
      examples: [{ questionId, revisionId, classification: assignment }],
    };
    expect(classificationRequest(withExample, questions)).toStrictEqual(null);
    expect(classificationRequest(withExample, questions, [{
      ...prepared.value,
      revisionId: crypto.randomUUID(),
    }])).toStrictEqual(null);
    const request = classificationRequest(withExample, questions, questions);
    if (!request) expect.unreachable('Expected request');
    const sent = JSON.parse(request.data);
    expect(sent.examples).toStrictEqual([{ question: prepared.value, classification: assignment }]);
    expect(Object.keys(sent.definition).sort()).toStrictEqual([
      'audience',
      'difficulty',
      'instructions',
      'name',
      'subjects',
      'topics',
    ]);
  },
);

testCase(
  'classifier rejects results that contradict a saved example for the exact revision',
  () => {
    const withExample = {
      ...definition,
      examples: [{ questionId, revisionId, classification: assignment }],
    };
    expect(parseClassificationOutput(JSON.stringify({ items: [item] }), withExample, questions))
      .toStrictEqual([item]);
    const unassigned = { state: 'unassigned', reason: 'unsupported_content' };
    const rejected = {
      ...item,
      classification: { subject: unassigned, topic: unassigned, difficulty: unassigned },
      rationale: 'Unsupported content',
    };
    expect(parseClassificationOutput(JSON.stringify({ items: [rejected] }), withExample, questions))
      .toStrictEqual(null);
    // Teaching examples pin revisions; a changed question can need a different classification.
    const nextRevisionId = 'c555ee34-f123-4123-8fed-098765432100';
    if (
      !(parseClassificationOutput(
        JSON.stringify({ items: [{ ...rejected, revisionId: nextRevisionId }] }),
        withExample,
        [{ ...prepared.value, revisionId: nextRevisionId }],
      ))
    ) {
      expect.unreachable(
        'Expected parseClassificationOutput( JSON.stringify({ items: [{ ...rejected, revisionId: nextRevisio',
      );
    }
  },
);

testCase('accepted near-limit question projections survive persisted preview replay', () => {
  let accepted = 0;
  let oversized = 0;
  for (const length of [15_800, 16_000, 16_200, 16_350]) {
    const input = prepareEnrichmentQuestion(questionId, revisionId, {
      ...body,
      promptHtml: `<p>${'x'.repeat(length)}</p>`,
    });
    if (!input.ok) {
      expect(input.code).toStrictEqual('input_too_large');
      oversized++;
      continue;
    }
    accepted++;
    const sample = {
      snapshotId: crypto.randomUUID(),
      seed: crypto.randomUUID(),
      scopeCount: 1,
      selectedCount: 1,
      questions: [input.value],
      excluded: [],
    };
    expect(parseStoredEnrichmentSample(JSON.parse(JSON.stringify(sample)))).toStrictEqual(sample);
  }
  if (!(accepted > 0 && oversized > 0)) {
    expect.unreachable('Expected accepted > 0 && oversized > 0');
  }
});

testCase(
  'classifier preserves canonical answers and markup, and rejects unsupported or incomplete inputs',
  () => {
    expect(prepared.value.correctId).toStrictEqual('a');
    expect(prepared.value.promptHtml).toStrictEqual(body.promptHtml);
    for (
      const patch of [{ correctId: '' }, { correctId: 'missing' }, {
        choices: [body.choices[0], body.choices[0]],
      }, { promptHtml: '<p> </p>' }]
    ) {
      expect(prepareEnrichmentQuestion(questionId, revisionId, { ...body, ...patch }))
        .toStrictEqual({
          ok: false,
          code: 'invalid_question',
        });
    }
    for (
      const promptHtml of [
        '<p><img src="diagram.png"/></p>',
        '<math><mi>x</mi></math>',
        '<p style="background-image:url(foo.png)">Read figure</p>',
        '<iframe src="figure"/>',
      ]
    ) {
      expect(prepareEnrichmentQuestion(questionId, revisionId, { ...body, promptHtml }))
        .toStrictEqual({
          ok: false,
          code: 'unsupported_content',
        });
    }
    expect(prepareEnrichmentQuestion(questionId, revisionId, { ...body, type: 'hotspot' }))
      .toStrictEqual({
        ok: false,
        code: 'unsupported_content',
      });
    expect(
      prepareEnrichmentQuestion(questionId, revisionId, { ...body, promptHtml: 'x'.repeat(17000) }),
    ).toStrictEqual({ ok: false, code: 'input_too_large' });
  },
);

testCase('classifier accepts exact revision results and explicit unassigned outcomes only', () => {
  expect(parseClassificationOutput(JSON.stringify({ items: [item] }), definition, questions))
    .toStrictEqual([item]);
  const unassigned = { state: 'unassigned', reason: 'outside_scheme' };
  if (
    !(parseClassificationOutput(
      JSON.stringify({
        items: [{
          ...item,
          classification: { subject: unassigned, topic: unassigned, difficulty: unassigned },
        }],
      }),
      definition,
      questions,
    ))
  ) {
    expect.unreachable(
      'Expected parseClassificationOutput( JSON.stringify({ items: [{ ...item, classification: { subject: ',
    );
  }
  for (
    const values of [
      [],
      [item, item],
      [{ ...item, questionId: crypto.randomUUID() }],
      [{ ...item, revisionId: crypto.randomUUID() }],
      [{
        ...item,
        classification: { ...assignment, topic: { state: 'assigned', valueIds: ['energy'] } },
      }],
      [{
        ...item,
        classification: {
          ...assignment,
          difficulty: { state: 'assigned', valueIds: ['invented'] },
        },
      }],
      [{ ...item, rationale: 'x'.repeat(321) }],
      [{ ...item, extra: true }],
    ]
  ) {
    expect(parseClassificationOutput(JSON.stringify({ items: values }), definition, questions))
      .toStrictEqual(null);
  }
  expect(parseClassificationOutput('```json\n{}\n```', definition, questions)).toStrictEqual(null);
  expect(parseClassificationOutput(
    JSON.stringify({ items: [item], unknown: true }),
    definition,
    questions,
  )).toStrictEqual(null);
});

testCase(
  'proposal binds examples and audience to the requested sample, not model-invented scope',
  () => {
    const { name, instructions, subjects, topics, difficulty } = definition;
    const raw = { definition: { name, instructions, subjects, topics, difficulty }, items: [item] };
    const proposal = parseProposalOutput(JSON.stringify(raw), 'Grade 8', questions);
    if (!proposal) expect.unreachable('Expected proposal');
    expect(proposal.definition.audience).toStrictEqual('Grade 8');
    expect(proposal.examples[0].revisionId).toStrictEqual(revisionId);
    expect(proposal.definition.examples).toStrictEqual([]);
    expect(parseProposalOutput(
      JSON.stringify({ ...raw, items: [{ ...item, revisionId: crypto.randomUUID() }] }),
      'Grade 8',
      questions,
    )).toStrictEqual(null);
    expect(parseProposalOutput(
      JSON.stringify({ ...raw, definition: { ...raw.definition, standards: [] } }),
      'Grade 8',
      questions,
    )).toStrictEqual(null);
    expect(classificationRequest(definition, [])).toStrictEqual(null);
    expect(classificationRequest(definition, [...questions, ...questions])).toStrictEqual(null);
    expect(proposalRequest('', questions)).toStrictEqual(null);
    const request = classificationRequest(definition, questions);
    if (!request) expect.unreachable('Expected request');
    if (!(enrichmentRequestInputBound(request))) {
      expect.unreachable('Expected enrichmentRequestInputBound(request)');
    }
    expect(enrichmentRequestInputBound({ ...request, data: 'x'.repeat(200000) })).toStrictEqual(
      null,
    );
  },
);

testCase(
  'provider requires explicit configuration, validates receipts and observes cancellation before dispatch',
  async () => {
    expect(loadEnrichmentAIConfig(() => undefined)).toStrictEqual(null);
    const env: Record<string, string> = {
      QFLOW_ENRICHMENT_PROVIDER: 'cloudflare',
      QFLOW_ENRICHMENT_MODEL: '@cf/moonshotai/kimi-k2.6',
      QFLOW_ENRICHMENT_INPUT_MICROS_PER_MILLION: '950000',
      QFLOW_ENRICHMENT_OUTPUT_MICROS_PER_MILLION: '4000000',
      QFLOW_ENRICHMENT_PREVIEW_BUDGET_MICROS: '1000000',
      QFLOW_ENRICHMENT_RUN_BUDGET_MICROS: '25000000',
    };
    const config = loadEnrichmentAIConfig((key) => env[key]);
    if (!config) expect.unreachable('Expected config');
    const wire = {
      id: 'provider-id',
      model: 'kimi-k2.6',
      usage: { prompt_tokens: 500, completion_tokens: 100 },
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ items: [item] }) } }],
    };
    if (!(parseEnrichmentAIReceipt(wire).ok)) {
      expect.unreachable('Expected parseEnrichmentAIReceipt(wire).ok');
    }
    const partial = parseEnrichmentAIReceipt({
      ...wire,
      choices: [{ finish_reason: 'length', message: { content: '{}' } }],
    });
    if (partial.ok) expect.unreachable('Expected !partial.ok');
    expect(partial.usage?.outputTokens).toStrictEqual(100);
    expect(parseEnrichmentAIReceipt({ response: '{}' }).ok).toStrictEqual(false);
    expect(
      parseEnrichmentAIReceipt({ ...wire, usage: { prompt_tokens: -1, completion_tokens: 2 } }).ok,
    ).toStrictEqual(false);
    const controller = new AbortController();
    controller.abort();
    const request = classificationRequest(definition, questions);
    if (!request) expect.unreachable('Expected request');
    const provider = createEnrichmentAIProvider({
      run: () => {
        throw new Error('Cancelled request must not dispatch.');
      },
    }, config);
    expect(await provider(request, { signal: controller.signal })).toStrictEqual({
      ok: false,
      code: 'aborted',
      usage: null,
    });

    const dispatched: Record<string, unknown>[] = [];
    const liveContract = createEnrichmentAIProvider({
      run: (model, input) => {
        expect(model).toStrictEqual(config.model);
        dispatched.push(input);
        return Promise.resolve(wire);
      },
    }, config);
    if (!((await liveContract(request)).ok)) {
      expect.unreachable('Expected (await liveContract(request)).ok');
    }
    expect(dispatched.length).toStrictEqual(1);
    expect(dispatched[0].response_format).toStrictEqual({
      type: 'json_schema',
      json_schema: { name: 'bank_enrichment', strict: true, schema: request.schema },
    });
    expect(dispatched[0].chat_template_kwargs).toStrictEqual({ thinking: false });
    expect(dispatched[0].max_completion_tokens).toStrictEqual(8192);
  },
);

testCase(
  'DeepSeek configuration preserves the selected model and prices without replacing frozen Kimi jobs',
  async () => {
    const config = parseEnrichmentAIConfig({
      provider: 'cloudflare',
      model: '@cf/deepseek-ai/deepseek-v4-flash-0731',
      promptVersion: 'bank-enrichment-v1',
      inputMicrosPerMillion: 440000,
      outputMicrosPerMillion: 1320000,
      previewBudgetMicros: 1000000,
      runBudgetMicros: 25000000,
    });
    if (!config) expect.unreachable('Expected config');
    expect(parseEnrichmentAIConfig(JSON.parse(JSON.stringify(config)))).toStrictEqual(config);
    expect(enrichmentCostMicros(config, 1000, 100)).toStrictEqual(572);
    expect(parseEnrichmentAIConfig({ ...config, model: '@cf/deepseek-ai/unknown' })).toStrictEqual(
      null,
    );
    const frozen = {
      ...config,
      model: '@cf/moonshotai/kimi-k2.6',
      inputMicrosPerMillion: 950000,
      outputMicrosPerMillion: 4000000,
    };
    expect(parseEnrichmentAIConfig(frozen)).toStrictEqual(frozen);
    expect(enrichmentCostMicros(frozen, 1000, 100)).toStrictEqual(1350);
    const request = classificationRequest(definition, questions);
    if (!request) expect.unreachable('Expected request');
    const provider = createEnrichmentAIProvider({
      run: (model) => {
        expect(model).toStrictEqual('@cf/deepseek-ai/deepseek-v4-flash-0731');
        return Promise.resolve({
          id: 'deepseek-request',
          model: 'deepseek-v4-flash-0731',
          usage: { prompt_tokens: 1000, completion_tokens: 100 },
          choices: [{
            finish_reason: 'stop',
            message: { content: JSON.stringify({ items: [item] }) },
          }],
        });
      },
    }, config);
    const receipt = await provider(request);
    if (!(receipt.ok)) expect.unreachable('Expected receipt.ok');
    expect(receipt.usage.model).toStrictEqual('deepseek-v4-flash-0731');
    if (!(parseClassificationOutput(receipt.content, definition, questions))) {
      expect.unreachable(
        'Expected parseClassificationOutput(receipt.content, definition, questions)',
      );
    }
  },
);

testCase(
  'topic teaching leaves unreviewed difficulty unconstrained and still rejects a contradictory topic',
  () => {
    const withExample = {
      ...definition,
      examples: [{ questionId, revisionId, classification: { ...assignment, difficulty: null } }],
    };
    const changedDifficulty = {
      ...item,
      classification: {
        ...assignment,
        difficulty: { state: 'assigned' as const, valueIds: ['hard'] },
      },
    };
    expect(parseClassificationOutput(
      JSON.stringify({ items: [changedDifficulty] }),
      withExample,
      questions,
    )).toStrictEqual([changedDifficulty]);
    const changedTopic = {
      ...item,
      classification: {
        ...assignment,
        subject: { state: 'assigned' as const, valueIds: ['physical'] },
        topic: { state: 'assigned' as const, valueIds: ['energy'] },
      },
    };
    expect(
      parseClassificationOutput(JSON.stringify({ items: [changedTopic] }), withExample, questions),
    ).toStrictEqual(null);
  },
);
