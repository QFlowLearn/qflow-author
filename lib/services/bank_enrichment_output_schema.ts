import type { EnrichmentDefinition } from './bank_enrichment_contract.ts';
import type { EnrichmentQuestion } from './bank_enrichment_input.ts';

const text = { type: 'string' };
const id = { type: 'string', pattern: '^[a-z][a-z0-9_-]{0,63}$' };
const category = object({
  id,
  label: { type: 'string', maxLength: 80 },
  definition: { type: 'string', maxLength: 1000 },
});

/** Constrain the exact batch size and source pairs before decoding; the parser also rejects duplicates. */
export function classificationOutputSchema(
  definition: EnrichmentDefinition,
  questions: readonly Pick<EnrichmentQuestion, 'questionId' | 'revisionId'>[],
): Readonly<Record<string, unknown>> {
  return {
    ...object({
      items: {
        type: 'array',
        minItems: questions.length,
        maxItems: questions.length,
        items: {
          anyOf: questions.map((question) =>
            object({
              questionId: { type: 'string', enum: [question.questionId] },
              revisionId: { type: 'string', enum: [question.revisionId] },
              classification: { $ref: '#/$defs/classification' },
              rationale: { type: 'string', maxLength: 320 },
            })
          ),
        },
      },
    }),
    // Share the vocabulary once instead of repeating its schema for every question.
    $defs: { classification: classificationSchema(definition) },
  };
}
/** Vocabulary proposal schema is deliberately limited to the three MVP dimensions. */
export function proposalOutputSchema(): Readonly<Record<string, unknown>> {
  return object({
    definition: object({
      name: { type: 'string', maxLength: 160 },
      instructions: { type: 'string', maxLength: 4000 },
      subjects: { type: 'array', minItems: 1, maxItems: 15, items: category },
      topics: {
        type: 'array',
        minItems: 1,
        maxItems: 60,
        items: object({ ...category.properties, subjectId: id }),
      },
      difficulty: { type: 'array', minItems: 3, maxItems: 3, items: category },
    }),
    items: { type: 'array', minItems: 1, maxItems: 10, items: itemSchema() },
  });
}
function itemSchema() {
  return object({
    questionId: text,
    revisionId: text,
    classification: object({
      subject: valueSchema(1),
      topic: valueSchema(3),
      difficulty: valueSchema(1),
    }),
    rationale: { type: 'string', maxLength: 320 },
  });
}
function valueSchema(maxItems: number, ids?: readonly string[]) {
  return {
    anyOf: [assignedSchema(maxItems, ids), unassignedSchema()],
  };
}
function classificationSchema(definition: EnrichmentDefinition) {
  const difficulty = valueSchema(1, definition.difficulty.map((value) => value.id));
  return {
    anyOf: [
      ...definition.subjects.map((subject) => {
        const topics = definition.topics.filter((topic) => topic.subjectId === subject.id)
          .map((topic) => topic.id);
        return object({
          subject: assignedSchema(1, [subject.id]),
          topic: topics.length ? valueSchema(3, topics) : unassignedSchema(),
          difficulty,
        });
      }),
      object({ subject: unassignedSchema(), topic: unassignedSchema(), difficulty }),
    ],
  };
}
function assignedSchema(maxItems: number, ids?: readonly string[]) {
  return object({
    state: { type: 'string', enum: ['assigned'] },
    valueIds: {
      type: 'array',
      minItems: 1,
      maxItems,
      uniqueItems: true,
      items: ids ? { type: 'string', enum: ids } : id,
    },
  });
}
function unassignedSchema() {
  return object({
    state: { type: 'string', enum: ['unassigned'] },
    reason: {
      type: 'string',
      enum: ['outside_scheme', 'insufficient_context', 'unsupported_content'],
    },
  });
}
function object<T extends Record<string, unknown>>(properties: T) {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}
