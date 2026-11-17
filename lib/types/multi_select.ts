import type { AnswerFeedback } from '../answer_feedback.ts';
import { choiceLabel, choiceLabelOptionsFromVocabulary } from '../choice_labels.ts';
import type { ItemLanguage } from './item_language.ts';
import type { QtiInteractionVocabulary } from '../shared_vocabulary.ts';
import {
  type Qti3ChoiceAuthoringItem,
  toQti3ChoiceAuthoringItem as toSharedQti3ChoiceAuthoringItem,
} from './qti3_writer_adapter.ts';

export type Choice = { id: string; text?: string; html?: string; fixed?: boolean; label?: string };
export type MultiSelectDraft = {
  readonly answerFeedback?: AnswerFeedback;
  title: string;
  promptHtml?: string;
  bodyHtml?: string;
  choices: Choice[];
  correctIds: string[];
  maximumScore?: number;
  responseIdentifier?: string;
  minChoices?: number;
  maxChoices?: number;
  shuffle?: boolean;
  sharedVocabulary?: QtiInteractionVocabulary;
};

export type BuildOptions = {
  identifier?: string;
  lang: ItemLanguage;
  scoring?: 'match_correct' | 'map_response';
  sharedVocabulary?: QtiInteractionVocabulary;
};

export function toMultiSelectQti3AuthoringItem(
  draft: MultiSelectDraft,
  opts: BuildOptions,
): Qti3ChoiceAuthoringItem {
  const identifier = opts.identifier ?? `item-${crypto.randomUUID()}`;
  const correctIds = Array.isArray(draft.correctIds) ? draft.correctIds : [];
  const maxChoices = draft.maxChoices != null ? draft.maxChoices : (draft.choices?.length ?? 0);
  return toSharedQti3ChoiceAuthoringItem({
    identifier,
    title: draft.title || 'Untitled',
    lang: opts.lang,
    bodyHtml: draft.bodyHtml,
    promptHtml: draft.promptHtml,
    responseCardinality: 'multiple',
    responseIdentifier: draft.responseIdentifier,
    maximumScore: draft.maximumScore,
    answerFeedback: draft.answerFeedback,
    choices: draft.choices || [],
    correctResponse: correctIds,
    shuffle: draft.shuffle,
    minChoices: draft.minChoices,
    maxChoices,
    scoring: opts.scoring ?? 'match_correct',
    draftSharedVocabulary: draft.sharedVocabulary,
    optionSharedVocabulary: opts.sharedVocabulary,
  });
}
export function validateMultiSelect(d: MultiSelectDraft): string[] {
  const errs: string[] = [];
  if (!d.title?.trim()) errs.push('Title is required.');
  const bodyText = (d.bodyHtml ?? '').replace(/<[^>]*>/g, '').trim();
  if (!bodyText) errs.push('Body is required.');
  if (!Array.isArray(d.choices) || d.choices.length < 2) {
    errs.push('At least two choices required.');
  }
  const emptyChoices = (d.choices ?? [])
    .filter((c) => !(c.html ?? c.text ?? '').trim())
    .map((c) => c.id);
  if (emptyChoices.length) {
    errs.push(`Choices must not be empty: ${emptyChoices.join(', ')}.`);
  }
  const validCorrect = (d.correctIds ?? []).filter((id) =>
    (d.choices ?? []).some((c) => c.id === id)
  );
  if (validCorrect.length === 0) errs.push('Select at least one correct choice.');
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

export function defaultsMultiSelect(): MultiSelectDraft {
  return {
    title: 'New Multi Select',
    promptHtml: 'Choose all that apply…',
    bodyHtml: '<p>Describe the task.</p>',
    choices: [
      { id: 'A', text: 'Option A' },
      { id: 'B', text: 'Option B' },
      { id: 'C', text: 'Option C' },
    ],
    correctIds: ['A'],
  };
}
