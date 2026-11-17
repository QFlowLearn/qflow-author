import { isValidQtiIdentifier } from '../qti_identifiers.ts';
import type { ItemLanguage } from './item_language.ts';
import {
  type Qti3EndAttemptAuthoringItem,
  sanitizedQti3BodyFragment,
  sanitizedQti3InlineFragment,
} from './qti3_writer_adapter.ts';

export type EndAttemptDraft = {
  title: string;
  promptHtml?: string;
  bodyHtml?: string;
  responseIdentifier?: string;
  endAttemptTitle?: string;
  endAttemptCountAttempt?: boolean;
};

export type BuildOptions = { identifier?: string; lang: ItemLanguage };

export function defaultsEndAttempt(): EndAttemptDraft {
  return {
    title: 'End Attempt',
    promptHtml: 'Use the button to end the attempt.',
    bodyHtml: '<p>Provide any additional instructions for the candidate.</p>',
    responseIdentifier: 'END_ATTEMPT',
    endAttemptTitle: 'End Attempt',
  };
}

export function validateEndAttempt(draft: EndAttemptDraft): string[] {
  const errs: string[] = [];
  if (!draft.title?.trim()) errs.push('Title is required.');
  const bodyText = (draft.bodyHtml ?? '').replace(/<[^>]*>/g, '').trim();
  if (!bodyText) errs.push('Body is required.');

  const responseId = (draft.responseIdentifier ?? 'END_ATTEMPT').trim();
  if (!isValidQtiIdentifier(responseId)) {
    errs.push('Response identifier must be a valid QTI identifier.');
  }
  if (!(draft.endAttemptTitle ?? '').trim()) {
    errs.push('Button label is required.');
  }

  return errs;
}

export function toQti3EndAttemptAuthoringItem(
  draft: EndAttemptDraft,
  opts: BuildOptions,
): Qti3EndAttemptAuthoringItem {
  return {
    interactionType: 'endAttempt',
    identifier: opts.identifier ?? `item-${crypto.randomUUID()}`,
    title: draft.title || 'Untitled',
    lang: opts.lang,
    promptHtml: sanitizedQti3InlineFragment(draft.promptHtml),
    bodyHtml: sanitizedQti3BodyFragment(draft.bodyHtml),
    responseIdentifier: draft.responseIdentifier ?? 'END_ATTEMPT',
    buttonTitle: (draft.endAttemptTitle ?? '').trim(),
    countAttempt: draft.endAttemptCountAttempt,
  };
}
