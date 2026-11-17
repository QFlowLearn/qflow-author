import { isTextQuestionType, prepareQuestionText, type TextQuestionType } from './question_text.ts';
import type { ItemLanguage } from '../types/item_language.ts';

/** Source-derived question fields. Completion is an explicit author request, not an inferred key. */
export type QuestionComposition = {
  readonly type: TextQuestionType;
  readonly stem: string;
  readonly choices: readonly string[];
  readonly answers: readonly string[];
  readonly choiceCount: number;
  readonly shuffle: boolean | null;
  readonly complete: boolean;
};
/** Only newly proposed content; supplied question text and choices cannot be rewritten. */
export type QuestionCompletion = {
  readonly additionalChoices: readonly string[];
  readonly answers: readonly string[];
};
/** Parse a complete interpretation at the HTTP boundary. */
export function parseQuestionComposition(raw: unknown): QuestionComposition | null {
  if (
    !record(raw) ||
    Object.keys(raw).sort().join(',') !==
      'answers,choiceCount,choices,complete,shuffle,stem,type' ||
    !isTextQuestionType(raw.type) || typeof raw.stem !== 'string' || !raw.stem.trim() ||
    raw.stem.length > 8000 ||
    !strings(raw.choices, 10) || !strings(raw.answers, 10) ||
    typeof raw.choiceCount !== 'number' || !Number.isInteger(raw.choiceCount) ||
    raw.choiceCount < 2 || raw.choiceCount > 10 ||
    raw.choices.length > raw.choiceCount || typeof raw.complete !== 'boolean' ||
    !(raw.shuffle === null || typeof raw.shuffle === 'boolean') ||
    (raw.type === 'text_entry' && raw.choices.length > 0) ||
    (raw.type !== 'multi_select' && raw.answers.length > 1) ||
    new Set(raw.answers).size !== raw.answers.length
  ) return null;
  const choices = raw.choices;
  if (raw.type !== 'text_entry' && raw.answers.some((answer) => !choices.includes(answer))) {
    return null;
  }
  return {
    type: raw.type,
    stem: raw.stem,
    choices: [...raw.choices],
    answers: [...raw.answers],
    choiceCount: raw.choiceCount,
    shuffle: raw.shuffle,
    complete: raw.complete,
  };
}
/** Accept exactly the missing options and a key naming actual options, preserving supplied keys. */
export function parseQuestionCompletion(
  raw: unknown,
  question: QuestionComposition,
): QuestionCompletion | null {
  if (
    !record(raw) || Object.keys(raw).sort().join(',') !== 'additionalChoices,answers' ||
    !strings(raw.additionalChoices, 10) || !strings(raw.answers, 10)
  ) return null;
  const required = question.type === 'text_entry'
    ? 0
    : question.choiceCount - question.choices.length;
  const choices = [...question.choices, ...raw.additionalChoices];
  if (
    raw.additionalChoices.length !== required || raw.answers.length === 0 ||
    new Set(raw.answers).size !== raw.answers.length ||
    (question.type !== 'multi_select' && raw.answers.length !== 1) ||
    (question.type !== 'text_entry' && raw.answers.some((answer) => !choices.includes(answer))) ||
    new Set(choices.map((choice) => choice.trim().toLocaleLowerCase())).size !== choices.length ||
    (question.answers.length > 0 &&
      JSON.stringify(raw.answers) !== JSON.stringify(question.answers))
  ) return null;
  return { additionalChoices: [...raw.additionalChoices], answers: [...raw.answers] };
}
/** Prepare canonical fields and empty rows immediately, without waiting for generated suggestions. */
export function prepareQuestionComposition(
  question: QuestionComposition,
  language: ItemLanguage,
  completion?: QuestionCompletion,
) {
  const values = [...question.choices, ...(completion?.additionalChoices ?? [])];
  const answers = completion?.answers ?? question.answers;
  const choices = question.type === 'text_entry' ? [] : Array.from(
    { length: question.choiceCount },
    (_, index) => ({ label: String.fromCharCode(65 + index), text: values[index] ?? '' }),
  );
  const prepared = prepareQuestionText(
    {
      source: '',
      stem: question.stem,
      type: question.type,
      choices,
      answers: answers.length
        ? [
          question.type === 'text_entry'
            ? answers[0]
            : answers.map((answer) => String.fromCharCode(65 + values.indexOf(answer))).join(', '),
        ]
        : [],
      findings: answers.length ? [] : ['answer_missing'],
    },
    question.type,
    question.choiceCount,
    language,
  );
  return {
    ...prepared,
    draft: {
      ...prepared.draft,
      ...(question.shuffle === null ? {} : { shuffle: question.shuffle }),
    },
  };
}
/** One completion is reusable when only presentation commands change. */
export function questionCompletionKey(question: QuestionComposition): string {
  return JSON.stringify([
    question.type,
    question.stem,
    question.choices,
    question.answers,
    question.choiceCount,
  ]);
}
/** Natural prose and commands require interpretation even when the type was explicitly selected. */
export function needsQuestionComposition(source: string): boolean {
  return (!/\n\s*(?:A[.)]|1[.)])\s+/i.test(source) &&
    /[,;]/.test(source.split(/\n\s*(?:answer|correct answer)/i)[0])) ||
    /\b(?:\d+|two|three|four|five|six|seven|eight|nine|ten)\s+(?:options|choices)\b|\b(?:randomi[sz]e|shuffle|you do the rest|fill in the rest|complete the (?:question|options))\b/i
      .test(source);
}
function strings(raw: unknown, max: number): raw is string[] {
  return Array.isArray(raw) && raw.length <= max &&
    raw.every((value) =>
      typeof value === 'string' && Boolean(value.trim()) && value.length <= 2000
    );
}
function record(raw: unknown): raw is Record<string, unknown> {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw);
}
