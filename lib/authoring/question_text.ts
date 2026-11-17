import type { ItemLanguage } from '../types/item_language.ts';
import type { Draft } from '../types/draft.ts';
import { xmlEscape } from '../xml.ts';
import { createPlaceholderHtml } from '../text_entry_placeholders.ts';

/** Only editor structures supported by text-assisted authoring. */
export const TEXT_QUESTION_TYPES = ['single_select', 'multi_select', 'text_entry'] as const;
export type TextQuestionType = typeof TEXT_QUESTION_TYPES[number];
/** Content-free, session-only history, newest last. */
export type QuestionStructure = { readonly type: TextQuestionType; readonly choiceCount: number };
export type TextQuestionFinding = 'answer_missing' | 'answer_conflict' | 'choices_ambiguous';
export type ParsedQuestionText = {
  readonly source: string;
  readonly stem: string;
  readonly type: TextQuestionType | null;
  readonly choices: readonly { readonly label: string; readonly text: string }[];
  readonly answers: readonly string[];
  readonly findings: readonly TextQuestionFinding[];
};
export const QUESTION_TEXT_MAX_LENGTH = 12000;

/** Refine a supported type at the browser and HTTP boundaries. */
export function isTextQuestionType(value: unknown): value is TextQuestionType {
  return value === 'single_select' || value === 'multi_select' || value === 'text_entry';
}

/** Conservative explicit syntax recognition. Unrecognized lines remain in the stem/options. */
export function parseQuestionText(source: string): ParsedQuestionText {
  let text = source.replace(/\r\n?/g, '\n').trim();
  let type: TextQuestionType | null = null;
  const prefixes: readonly [RegExp, TextQuestionType][] = [
    [
      /^(?:multiple response|multiple select|select all that apply)(?=$|[:\s-])[:\s-]*/i,
      'multi_select',
    ],
    [/^(?:MR|MS)(?=$|[:\s-])[:\s-]*/, 'multi_select'],
    [/^(?:multiple choice|single choice)(?=$|[:\s-])[:\s-]*/i, 'single_select'],
    [/^(?:MCQ|MC)(?=$|[:\s-])[:\s-]*/, 'single_select'],
    [/^(?:short answer|text entry)(?=$|[:\s-])[:\s-]*/i, 'text_entry'],
    [/^SA(?=$|[:\s-])[:\s-]*/, 'text_entry'],
  ];
  for (const [pattern, candidate] of prefixes) {
    if (!pattern.test(text)) continue;
    type = candidate;
    // Preserve meaningful instructions such as "Select all that apply" in the question.
    if (!/^select all that apply\b/i.test(text)) text = text.replace(pattern, '');
    break;
  }
  if (!type && /\bselect all (?:that apply|correct answers)\b/i.test(text)) type = 'multi_select';
  const stem: string[] = [], answers: string[] = [];
  const choices: { label: string; text: string }[] = [];
  for (const line of text.split('\n')) {
    const answer = line.match(/^\s*(?:correct answers?|answer(?: key)?)\s*:\s*(.*)$/i);
    if (answer) {
      answers.push(answer[1].trim());
      continue;
    }
    // Answer markers start a terminal block. Continuations must never enter the stem/options.
    if (answers.length) {
      answers[answers.length - 1] += `\n${line}`;
      continue;
    }
    const choice = line.match(/^\s*([A-Z]|\d{1,2})[.)]\s+(.*)$/i);
    if (choice && stem.some((part) => part.trim())) {
      choices.push({ label: choice[1].toUpperCase(), text: choice[2] });
    } else if (choices.length) {
      choices[choices.length - 1].text += `\n${line}`;
    } else stem.push(line);
  }
  for (let index = 0; index < answers.length; index++) answers[index] = answers[index].trim();
  const duplicate = new Set(choices.map((c) => c.label)).size !== choices.length;
  const coherent = choices.length >= 2 && choices.length <= 26 && !duplicate &&
    (choices.every((choice, index) => choice.label === String.fromCharCode(65 + index)) ||
      choices.every((choice, index) => choice.label === String(index + 1)));
  const findings: TextQuestionFinding[] = [];
  if (choices.length && !coherent) findings.push('choices_ambiguous');
  if (!answers.length || !answers[0]) findings.push('answer_missing');
  if (answers.length > 1) findings.push('answer_conflict');
  if (!type && coherent) type = 'single_select';
  return { source, stem: stem.join('\n').trim(), type, choices, answers, findings };
}

/** Construct a canonical draft without importing sample content or default answer keys. */
export function prepareQuestionText(
  parsed: ParsedQuestionText,
  type: TextQuestionType,
  choiceCount: number,
  itemLanguage: ItemLanguage,
): { readonly draft: Draft; readonly findings: readonly TextQuestionFinding[] } {
  const findings = [...parsed.findings];
  const usableChoices = !findings.includes('choices_ambiguous');
  const stem = usableChoices
    ? parsed.stem
    : [parsed.stem, ...parsed.choices.map((c) => `${c.label}. ${c.text}`)].join('\n');
  const common: Draft = {
    itemLanguage,
    type,
    title: parsed.stem.slice(0, 120),
    promptHtml: '',
    bodyHtml: paragraphs(stem),
    correctId: '',
    correctIds: [],
    choices: [],
    textEntries: [],
  };
  if (type === 'text_entry') {
    // An explicit conversion keeps all alternatives as question content, without guessing a key.
    const content = parsed.choices.length && usableChoices
      ? `${stem}\n${parsed.choices.map((c) => `${c.label}. ${c.text}`).join('\n')}`
      : stem;
    const answer = parsed.answers.length === 1 && !parsed.choices.length ? parsed.answers[0] : '';
    if (!answer && !findings.includes('answer_missing')) findings.push('answer_conflict');
    return {
      draft: {
        ...common,
        bodyHtml: paragraphs(content) +
          `<p>${createPlaceholderHtml({ id: 'RESPONSE', label: 'Answer' })}</p>`,
        textEntries: [{
          id: 'RESPONSE',
          label: 'Answer',
          answers: answer ? [{ id: 'answer-1', value: answer, score: 1 }] : [],
        }],
      },
      findings,
    };
  }
  const choices = usableChoices && parsed.choices.length
    ? parsed.choices.map((c, index) => ({
      id: String.fromCharCode(65 + index),
      text: c.text.trim(),
      label: c.label,
    }))
    : Array.from(
      { length: Math.max(2, Math.min(10, choiceCount)) },
      (_, i) => ({ id: String.fromCharCode(65 + i), text: '', label: String.fromCharCode(65 + i) }),
    );
  const key = parsed.answers.length === 1 ? parsed.answers[0] : '';
  const labels = key
    ? key.split(/\s*[,;]\s*|\s+and\s+/i).map((v) => v.trim().replace(/[.)]$/, '').toUpperCase())
    : [];
  const matches = labels.map((label) => choices.find((c) => c.label === label)?.id);
  const valid = labels.length > 0 && matches.every((id) => id !== undefined) &&
    new Set(labels).size === labels.length && usableChoices &&
    (type === 'multi_select' || labels.length === 1);
  const ids = valid ? matches.filter((id): id is string => id !== undefined) : [];
  if (key && !valid && !findings.includes('answer_conflict')) findings.push('answer_conflict');
  return {
    draft: {
      ...common,
      choices,
      correctId: type === 'single_select' ? ids[0] ?? '' : '',
      correctIds: type === 'multi_select' ? ids : [],
      minChoices: 0,
      maxChoices: type === 'single_select' ? 1 : choices.length,
    },
    findings,
  };
}
function paragraphs(text: string): string {
  return text.split(/\n\s*\n/).map((part) => `<p>${xmlEscape(part).replaceAll('\n', '<br/>')}</p>`)
    .join('');
}

/** Extract only reusable structure, never previous content, keys, or scoring. */
export function questionStructure(draft: Draft): QuestionStructure | null {
  return isTextQuestionType(draft.type)
    ? { type: draft.type, choiceCount: Math.min(10, Math.max(2, draft.choices?.length ?? 4)) }
    : null;
}
