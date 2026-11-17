/** Free-form author labels, independent of vocabulary-based topic assignments. */
export type TagsByItem = Readonly<Record<string, readonly string[]>>;

/** Parse the canonical draft field without coercing malformed labels into text. */
export function parseQuestionTags(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((tag): tag is string => typeof tag === 'string')) {
    throw new Error('Question tags must be strings.');
  }
  return [...new Set(value.map((tag) => tag.trim()).filter(Boolean))];
}
