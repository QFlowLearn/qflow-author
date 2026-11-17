import { assertValidQtiIdentifier } from '../qti_identifiers.ts';
import type { ItemLanguage } from './item_language.ts';
import { sanitizeInlineHtml } from '../sanitize.ts';
import {
  type QtiInteractionVocabulary,
  qtiStateFromInteractionVocabulary,
} from '../shared_vocabulary.ts';
import {
  type Qti3OrderAuthoringItem,
  sanitizedQti3BodyFragment,
  sanitizedQti3InlineFragment,
  trustedQti3Fragment,
} from './qti3_writer_adapter.ts';

export type OrderChoice = { id: string; text?: string; html?: string };
export type OrderDraft = {
  title: string;
  promptHtml?: string;
  bodyHtml?: string;
  choices: OrderChoice[]; // display order
  correctOrder?: string[]; // identifiers in correct order; defaults to current order
  minChoices?: number;
  maxChoices?: number;
  shuffle?: boolean;
  minChoicesMessage?: string;
  maxChoicesMessage?: string;
  choiceVisibility?: 'visible' | 'hide';
  sharedVocabulary?: QtiInteractionVocabulary;
};

export type BuildOptions = { identifier?: string; lang: ItemLanguage };

export function toQti3OrderAuthoringItem(
  draft: OrderDraft,
  opts: BuildOptions,
): Qti3OrderAuthoringItem {
  const identifier = opts.identifier ?? `item-${crypto.randomUUID()}`;
  return {
    interactionType: 'order',
    identifier,
    title: draft.title || 'Untitled',
    lang: opts.lang,
    bodyHtml: sanitizedQti3BodyFragment(draft.bodyHtml),
    promptHtml: sanitizedQti3InlineFragment(draft.promptHtml),
    choices: (draft.choices || []).map((choice) => ({
      identifier: assertValidQtiIdentifier(choice.id, 'Order choice identifier'),
      text: choice.text,
      contentHtml: choice.html && choice.html.trim() !== ''
        ? trustedQti3Fragment(sanitizeInlineHtml(choice.html))
        : undefined,
    })),
    correctOrder: draft.correctOrder,
    minChoices: draft.minChoices,
    maxChoices: draft.maxChoices,
    shuffle: draft.shuffle,
    minChoicesMessage: draft.minChoicesMessage,
    maxChoicesMessage: draft.maxChoicesMessage,
    choiceVisibility: draft.choiceVisibility,
    sharedVocabulary: draft.sharedVocabulary
      ? qtiStateFromInteractionVocabulary(draft.sharedVocabulary)
      : undefined,
  };
}

export function defaultsOrder(): OrderDraft {
  return {
    title: 'Ordering',
    promptHtml: 'Reorder the items.',
    bodyHtml: '<p>Arrange these items.</p>',
    choices: [{ id: 'A', text: 'First' }, { id: 'B', text: 'Second' }, { id: 'C', text: 'Third' }],
  };
}

export function validateOrder(d: OrderDraft): string[] {
  const errs: string[] = [];
  const bodyText = (d.bodyHtml ?? '').replace(/<[^>]*>/g, '').trim();
  if (!d.title?.trim()) errs.push('Title is required.');
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
  if (d.correctOrder && d.correctOrder.some((id) => !(d.choices || []).some((c) => c.id === id))) {
    errs.push('Correct order references unknown choice.');
  }
  if (d.minChoices != null && (!Number.isFinite(d.minChoices) || d.minChoices < 0)) {
    errs.push('Minimum choices must be 0 or greater.');
  }
  if (d.maxChoices != null && (!Number.isFinite(d.maxChoices) || d.maxChoices < 0)) {
    errs.push('Maximum choices must be 0 or greater.');
  }
  if (
    d.minChoices != null &&
    d.maxChoices != null &&
    d.maxChoices > 0 &&
    d.minChoices > d.maxChoices
  ) {
    errs.push('Minimum choices must be less than or equal to maximum choices.');
  }
  if (
    d.sharedVocabulary?.orientation &&
    !['horizontal', 'vertical'].includes(d.sharedVocabulary.orientation)
  ) {
    errs.push('Orientation must be horizontal or vertical.');
  }
  return errs;
}
