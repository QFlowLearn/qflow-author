export type FieldKey =
  | 'title'
  | 'body'
  | 'prompt'
  | 'choices'
  | 'correct'
  | 'maximumScore'
  | 'minChoices'
  | 'maxChoices'
  | 'matchSources'
  | 'matchTargets'
  | 'matchPairs'
  | 'order'
  | 'textEntry'
  | 'general';

export type FieldIssue = { field: FieldKey; message: string };

const FIELD_KEYS: readonly FieldKey[] = [
  'title',
  'body',
  'prompt',
  'choices',
  'correct',
  'maximumScore',
  'minChoices',
  'maxChoices',
  'matchSources',
  'matchTargets',
  'matchPairs',
  'order',
  'textEntry',
  'general',
];

const patterns: Array<{ test: RegExp; field: FieldKey }> = [
  { test: /title|label|rubric/i, field: 'title' },
  { test: /body|item body|stimulus/i, field: 'body' },
  { test: /prompt|stem|qti-prompt|rubric-block/i, field: 'prompt' },
  { test: /simple[_-]?choice|choice interaction|choice-response|option/i, field: 'choices' },
  { test: /correct|response|value/i, field: 'correct' },
  { test: /minchoices|min-choices|minSelections/i, field: 'minChoices' },
  { test: /maxchoices|max-choices|maxSelections/i, field: 'maxChoices' },
  { test: /source|match-set|row/i, field: 'matchSources' },
  { test: /target|column/i, field: 'matchTargets' },
  { test: /pair|association|mapping/i, field: 'matchPairs' },
  { test: /order|sequence|permutation/i, field: 'order' },
  { test: /text[- ]?entry|blank/i, field: 'textEntry' },
];

function inferFieldFromMessage(message: string): FieldKey {
  for (const { test, field } of patterns) {
    if (test.test(message)) return field;
  }
  return 'general';
}

/** Parses one exact editor field key received across a protocol boundary. */
export function parseFieldKey(value: unknown): FieldKey | null {
  return FIELD_KEYS.find((candidate) => candidate === value) ?? null;
}

/** Parses field issues received from an HTTP response into the editor's closed vocabulary. */
export function parseFieldIssues(value: unknown): FieldIssue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((input) => {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) return [];
    const message = Reflect.get(input, 'message');
    if (typeof message !== 'string') return [];
    return [{
      field: parseFieldKey(Reflect.get(input, 'field')) ?? 'general',
      message,
    }];
  });
}

export function toFieldIssues(errors: Array<{ message: string }>): FieldIssue[] {
  return errors
    .map((err) => err?.message?.trim())
    .filter((msg): msg is string => Boolean(msg))
    .map((msg) => ({ field: inferFieldFromMessage(msg), message: msg }));
}
