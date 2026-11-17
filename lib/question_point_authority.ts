/** Editing authority projected from the exact source revision, never persisted in its draft. */
export type QuestionPointEditingAuthority =
  | { readonly _tag: 'Generated' }
  | { readonly _tag: 'SourceOnly' }
  | { readonly _tag: 'SourceEditable'; readonly maximumScore: number | undefined };

/** Parse the closed revision-response authority; absence is not permission to replace scoring. */
export function parseQuestionPointEditingAuthority(input: unknown): QuestionPointEditingAuthority {
  if (
    !input || typeof input !== 'object' || Array.isArray(input) || !Object.hasOwn(input, '_tag')
  ) {
    throw new Error('Question point editing authority is missing or invalid.');
  }
  const tag = Reflect.get(input, '_tag');
  const keys = Object.keys(input);
  if ((tag === 'Generated' || tag === 'SourceOnly') && keys.length === 1) return { _tag: tag };
  const maximumScore = Reflect.get(input, 'maximumScore');
  if (
    tag === 'SourceEditable' && keys.every((key) => key === '_tag' || key === 'maximumScore') &&
    (maximumScore === undefined || typeof maximumScore === 'number' &&
        Number.isFinite(maximumScore) && maximumScore >= 0)
  ) {
    return { _tag: 'SourceEditable', maximumScore };
  }
  throw new Error('Question point editing authority is invalid.');
}
