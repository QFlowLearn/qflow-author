import { expect, test as testCase } from 'vitest';

import { Ajv } from 'ajv';
import { classificationOutputSchema } from '../lib/services/bank_enrichment_output_schema.ts';
import { enrichmentDefinitionFixture } from './bank_enrichment_fixture.ts';
import { parseEnrichmentClassification } from '../lib/services/bank_enrichment_contract.ts';
import { classificationRequest } from '../lib/services/bank_enrichment_classifier.ts';
import { prepareEnrichmentQuestion } from '../lib/services/bank_enrichment_input.ts';

testCase(
  'classification request schema rejects invented or mismatched revisions and missing batch items',
  () => {
    const definition = enrichmentDefinitionFixture();
    const questions = [0, 1].map((index) => {
      const prepared = prepareEnrichmentQuestion(
        `a555ee34-f123-4123-8fed-09876543210${index}`,
        `b555ee34-f123-4123-8fed-09876543210${index}`,
        {
          type: 'single_select',
          title: 'Cells',
          promptHtml: '<p>Which structure contains DNA?</p>',
          choices: [{ id: 'a', text: 'Nucleus' }, { id: 'b', text: 'Membrane' }],
          correctId: 'a',
        },
      );
      if (!(prepared.ok)) expect.unreachable('Expected prepared.ok');
      return prepared.value;
    });
    const request = classificationRequest(definition, questions);
    if (!request) expect.unreachable('Expected request');
    const validate = new Ajv().compile(request.schema);
    const assigned = (value: string) => ({ state: 'assigned', valueIds: [value] });
    const items = questions.map((question) => ({
      questionId: question.questionId,
      revisionId: question.revisionId,
      classification: {
        subject: assigned('life'),
        topic: assigned('cells'),
        difficulty: assigned('easy'),
      },
      rationale: 'Direct recall.',
    }));
    if (!(validate({ items }))) expect.unreachable('Expected validate({ items })');
    if (validate({ items: [{ ...items[0], revisionId: 'mistyped-revision' }, items[1]] })) {
      expect.unreachable(
        "Expected !validate({ items: [{ ...items[0], revisionId: 'mistyped-revision' }, items[1]] })",
      );
    }
    if (validate({ items: [{ ...items[0], revisionId: items[1].revisionId }, items[1]] })) {
      expect.unreachable(
        'Expected !validate({ items: [{ ...items[0], revisionId: items[1].revisionId }, items[1]] })',
      );
    }
    if (validate({ items: [{ ...items[0], questionId: 'unrequested-question' }, items[1]] })) {
      expect.unreachable(
        "Expected !validate({ items: [{ ...items[0], questionId: 'unrequested-question' }, items[1]] })",
      );
    }
    if (validate({ items: [items[0]] })) {
      expect.unreachable('Expected !validate({ items: [items[0]] })');
    }
    if (validate({ items: [...items, items[0]] })) {
      expect.unreachable('Expected !validate({ items: [...items, items[0]] })');
    }
    if (!(validate({ items: [...items].reverse() }))) {
      expect.unreachable('Expected validate({ items: [...items].reverse() })');
    }
  },
);

testCase('provider schema enforces the same subject/topic hierarchy as the domain parser', () => {
  const definition = {
    ...enrichmentDefinitionFixture(),
    subjects: [
      { id: 'life', label: 'Life science', definition: 'Living systems' },
      { id: 'physical', label: 'Physical science', definition: 'Matter and energy' },
      { id: 'general', label: 'General science', definition: 'Unspecified science' },
    ],
    topics: [
      { id: 'cells', subjectId: 'life', label: 'Cells', definition: 'Cell structures' },
      { id: 'energy', subjectId: 'physical', label: 'Energy', definition: 'Energy transfer' },
    ],
  };
  const validate = new Ajv().compile(classificationOutputSchema(definition, [{
    questionId: 'a555ee34-f123-4123-8fed-098765432100',
    revisionId: 'b555ee34-f123-4123-8fed-098765432100',
  }]));
  const assigned = (id: string) => ({ state: 'assigned', valueIds: [id] });
  const unassigned = { state: 'unassigned', reason: 'outside_scheme' };
  const cases = [
    { subject: assigned('life'), topic: assigned('cells'), accepted: true },
    { subject: assigned('physical'), topic: assigned('energy'), accepted: true },
    { subject: assigned('life'), topic: assigned('energy'), accepted: false },
    { subject: assigned('physical'), topic: assigned('cells'), accepted: false },
    { subject: assigned('general'), topic: unassigned, accepted: true },
    { subject: assigned('general'), topic: assigned('cells'), accepted: false },
    { subject: assigned('life'), topic: unassigned, accepted: true },
    { subject: unassigned, topic: unassigned, accepted: true },
    { subject: unassigned, topic: assigned('cells'), accepted: false },
    { subject: assigned('invented'), topic: unassigned, accepted: false },
  ];
  for (const { subject, topic, accepted } of cases) {
    const classification = { subject, topic, difficulty: assigned('easy') };
    const response = {
      items: [{
        questionId: 'a555ee34-f123-4123-8fed-098765432100',
        revisionId: 'b555ee34-f123-4123-8fed-098765432100',
        classification,
        rationale: 'Direct recall.',
      }],
    };
    expect(parseEnrichmentClassification(classification, definition) !== null).toStrictEqual(
      accepted,
    );
    expect(validate(response), JSON.stringify(classification)).toStrictEqual(accepted);
  }
  if (validate({ items: [] })) expect.unreachable('Expected !validate({ items: [] })');
});
