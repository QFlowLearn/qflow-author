import type { AnswerFeedback } from '../answer_feedback.ts';
import { choiceLabel, choiceLabelOptionsFromVocabulary } from '../choice_labels.ts';
import type { ItemLanguage } from './item_language.ts';
import type { QtiInteractionVocabulary } from '../shared_vocabulary.ts';
import {
  type Qti3ChoiceAuthoringItem,
  toQti3ChoiceAuthoringItem as toSharedQti3ChoiceAuthoringItem,
} from './qti3_writer_adapter.ts';

export type Choice = { id: string; text?: string; html?: string; fixed?: boolean; label?: string };
export type SingleSelectDraft = {
  readonly answerFeedback?: AnswerFeedback;
  title: string;
  promptHtml?: string;
  bodyHtml?: string;
  choices: Choice[];
  correctId: string;
  maximumScore?: number;
  responseIdentifier?: string;
  shuffle?: boolean;
  minChoices?: number;
  required?: boolean;
  answerMasking?: boolean;
  sharedVocabulary?: QtiInteractionVocabulary;
};

export type BuildOptions = {
  identifier?: string;
  lang: ItemLanguage;
  scoring?: 'match_correct' | 'map_response';
  minChoices?: number;
  required?: boolean;
  answerMasking?: boolean;
  classes?: string[];
  sharedVocabulary?: QtiInteractionVocabulary;
};

export function toSingleSelectQti3AuthoringItem(
  draft: SingleSelectDraft,
  opts: BuildOptions,
): Qti3ChoiceAuthoringItem {
  const identifier = opts.identifier ?? `item-${crypto.randomUUID()}`;
  const correct = draft.correctId;
  const answerMasking = opts.answerMasking ?? draft.answerMasking ?? false;
  const required = opts.required ?? draft.required;
  const minChoices = opts.minChoices ??
    draft.minChoices ??
    (required ? 1 : undefined);
  return toSharedQti3ChoiceAuthoringItem({
    identifier,
    title: draft.title || 'Untitled',
    lang: opts.lang,
    bodyHtml: draft.bodyHtml,
    promptHtml: draft.promptHtml,
    responseCardinality: 'single',
    responseIdentifier: draft.responseIdentifier,
    maximumScore: draft.maximumScore,
    answerFeedback: draft.answerFeedback,
    choices: draft.choices || [],
    correctResponse: [correct],
    shuffle: draft.shuffle,
    minChoices,
    maxChoices: 1,
    scoring: opts.scoring ?? 'match_correct',
    choiceVisibility: answerMasking ? 'hide' : 'visible',
    classNames: opts.classes ?? [],
    draftSharedVocabulary: draft.sharedVocabulary,
    optionSharedVocabulary: opts.sharedVocabulary,
  });
}

export function validateSingleSelect(d: SingleSelectDraft): string[] {
  const errs: string[] = [];
  if (!d.title?.trim()) errs.push('Title is required.');
  const bodyText = (d.bodyHtml ?? '').replace(/<[^>]*>/g, '').trim();
  const promptText = (d.promptHtml ?? '').replace(/<[^>]*>/g, '').trim();
  if (!bodyText && !promptText) errs.push('Body is required.');
  if (!Array.isArray(d.choices) || d.choices.length < 2) {
    errs.push('At least two choices required.');
  }
  const emptyChoices = (d.choices ?? [])
    .filter((c) => !(c.html ?? c.text ?? '').trim())
    .map((c) => c.id);
  if (emptyChoices.length) {
    errs.push(`Choices must not be empty: ${emptyChoices.join(', ')}.`);
  }
  if (!(d.choices ?? []).some((c) => c.id === d.correctId)) {
    errs.push('Correct choice must match one option.');
  }
  if (
    d.sharedVocabulary?.orientation &&
    !['horizontal', 'vertical'].includes(d.sharedVocabulary.orientation)
  ) {
    errs.push('Choice orientation must be horizontal or vertical.');
  }
  const labelOptions = choiceLabelOptionsFromVocabulary(d.sharedVocabulary);
  const seen = new Set<string>();
  const dupes = new Set<string>();
  (d.choices ?? []).forEach((choice, idx) => {
    const label = choiceLabel(choice, idx, labelOptions).trim();
    if (!label) return;
    const key = label.toLowerCase();
    if (seen.has(key)) dupes.add(label);
    else seen.add(key);
  });
  if (dupes.size) errs.push(`Choice labels must be unique: ${Array.from(dupes).join(', ')}`);
  return errs;
}

export function defaultsSingleSelect(): SingleSelectDraft {
  return {
    title: 'New Single Select',
    promptHtml: 'Your question here…',
    bodyHtml: '<p>Provide the question context.</p>',
    choices: [
      { id: 'A', text: 'Option A' },
      { id: 'B', text: 'Option B' },
    ],
    correctId: 'A',
    required: true,
  };
}
