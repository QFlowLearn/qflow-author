/** Review areas authors can evaluate without content being changed for them. */
export type QuestionReviewCategory =
  | 'ambiguity'
  | 'clueing'
  | 'duplicate_options'
  | 'answer_key'
  | 'alignment'
  | 'accessibility';

/** One visible review suggestion. Suggestions never mutate question content. */
export type QuestionReviewSuggestion = {
  readonly source: 'ai' | 'deterministic';
  readonly code: string;
  readonly category: QuestionReviewCategory;
  readonly message: string;
};

const QUESTION_REVIEW_CATEGORIES: readonly QuestionReviewCategory[] = [
  'ambiguity',
  'clueing',
  'duplicate_options',
  'answer_key',
  'alignment',
  'accessibility',
];

/** Parse stored review suggestions without repairing or accepting unknown fields. */
export function parseQuestionReviewSuggestions(value: unknown): QuestionReviewSuggestion[] {
  if (!Array.isArray(value)) throw new Error('Question review suggestions must be an array.');
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Question review suggestion ${index + 1} must be an object.`);
    }
    const record = entry as Record<string, unknown>;
    const expected = ['source', 'code', 'category', 'message'];
    const unknown = Object.keys(record).filter((key) => !expected.includes(key));
    const missing = expected.filter((key) => !Object.hasOwn(record, key));
    if (unknown.length || missing.length) {
      throw new Error(
        `Question review suggestion ${index + 1} has invalid fields. Missing: ${
          missing.join(', ') || 'none'
        }; unknown: ${unknown.join(', ') || 'none'}.`,
      );
    }
    if (record.source !== 'ai' && record.source !== 'deterministic') {
      throw new Error(`Question review suggestion ${index + 1} source is invalid.`);
    }
    const category = QUESTION_REVIEW_CATEGORIES.find((candidate) => candidate === record.category);
    if (!category) throw new Error(`Question review suggestion ${index + 1} category is invalid.`);
    if (typeof record.code !== 'string' || !record.code.trim()) {
      throw new Error(`Question review suggestion ${index + 1} code is required.`);
    }
    if (typeof record.message !== 'string' || !record.message.trim()) {
      throw new Error(`Question review suggestion ${index + 1} message is required.`);
    }
    return {
      source: record.source,
      code: record.code.trim(),
      category,
      message: record.message.trim(),
    };
  });
}
